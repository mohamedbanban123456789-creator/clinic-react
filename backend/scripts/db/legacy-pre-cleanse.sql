-- ============================================================================
-- Legacy pre-cleanse for migration 0010 (single-OPEN-shift invariant)
-- Runbook: scripts/db/legacy-pre-cleanse.sql — see DATABASE_SCHEMA_SPEC.md §16.
--
-- WHY: migration 0010 creates the clinic-wide partial unique index
--      uq_shifts_single_open ON shifts(status) WHERE status='OPEN'.
--      A legacy database carrying TWO OR MORE OPEN shifts (the historical
--      race the migration closes) makes that CREATE UNIQUE INDEX fail —
--      by design (fail-closed). This procedure reconciles the legacy state
--      SAFELY and WITHOUT INVENTING FINANCIAL DATA before re-running 0010.
--
-- POLICY (data-preserving, no fabricated money):
--   - Keep exactly ONE shift OPEN: the NEWEST by (business_date, created_at) —
--     the one the clinic is actually working in.
--   - Archive every older OPEN shift as CLOSED **unreconciled**: money fields
--     (expected/actual/difference/result) stay NULL, integrity_check_passed
--     stays NULL, and a review_note records exactly what happened and that a
--     supervisor must reconcile it. NOTHING is deleted; no amount is invented.
--   - EDIT THE OPERATOR USER ID BELOW before running (auditable actor).
--
-- RUN (as the migration/owner role, against the application database):
--   npx prisma db execute --url "$MIGRATION_DB_URL" --file scripts/db/legacy-pre-cleanse.sql
--   npx prisma migrate deploy          # now 0010 applies
--   npx prisma db execute --url "$MIGRATION_DB_URL" --file scripts/db/provision.sql
--
-- IDEMPOTENT: re-running on a clean state (0-1 OPEN shifts) is a no-op.
-- ============================================================================

DO $$
DECLARE
  operator_id text := 'EDIT-ME-operator-user-id';  -- ← EDIT BEFORE RUNNING
  open_count integer;
  archived integer;
BEGIN
  SELECT count(*) INTO open_count FROM shifts WHERE status = 'OPEN';

  IF open_count <= 1 THEN
    RAISE NOTICE 'pre-cleanse: % OPEN shift(s) — nothing to do (migration 0010 can apply).', open_count;
    RETURN;
  END IF;

  IF operator_id LIKE 'EDIT-ME%' THEN
    RAISE EXCEPTION 'pre-cleanse: edit operator_id before running (auditable actor required)';
  END IF;

  -- Archive every OPEN shift EXCEPT the newest (business_date DESC, created_at DESC, id DESC tiebreak).
  WITH ranked AS (
    SELECT id, row_number() OVER (
             PARTITION BY status
             ORDER BY business_date DESC, created_at DESC, id DESC
           ) AS rn
    FROM shifts
    WHERE status = 'OPEN'
  )
  UPDATE shifts s
     SET status = 'CLOSED',
         closed_at = now(),
         closed_by_user_id = operator_id,
         review_note = coalesce(s.review_note || ' | ', '')
                       || 'legacy multi-OPEN pre-cleanse (migration 0010): archived UNRECONCILED — '
                       || 'cash position must be manually reconciled by supervision.',
         integrity_check_passed = NULL,
         result = NULL
   WHERE s.id IN (SELECT id FROM ranked WHERE rn > 1);

  GET DIAGNOSTICS archived = ROW_COUNT;
  RAISE NOTICE 'pre-cleanse: archived % stale OPEN shift(s) as CLOSED/unreconciled; newest left OPEN.', archived;

  -- Final guard: exactly one OPEN shift must remain.
  SELECT count(*) INTO open_count FROM shifts WHERE status = 'OPEN';
  IF open_count <> 1 THEN
    RAISE EXCEPTION 'pre-cleanse: expected exactly 1 OPEN shift after archiving, found %', open_count;
  END IF;
END $$;
