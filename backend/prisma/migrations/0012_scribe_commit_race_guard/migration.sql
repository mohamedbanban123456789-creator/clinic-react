-- R1 (post-review remediation): one signed SCRIBE encounter per scribe session.
--
-- encounters.origin_scribe_draft_ref holds the originating SCRIBE SESSION id.
-- It previously carried only a plain index, so a concurrent commit race could
-- (in principle) create two SIGNED encounters for one session. The service now
-- claims the session status with a conditional UPDATE inside the commit
-- transaction; this unique index is the durable DB-level authority behind that
-- claim (Postgres unique indexes treat NULLs as distinct, so MANUAL encounters
 -- — where the column is NULL — are unaffected).
--
-- PREFLIGHT (fail-closed, never deletes clinical records): if historical data
-- already violates the invariant (i.e. the race fired on a legacy deployment),
-- the migration REFUSES to apply and names the conflicting session refs.
-- Remediation is a manual clinical review of those encounters — an operator
-- decision, not an automatic data mutation.
DO $$
DECLARE
  duplicate_refs text;
BEGIN
  SELECT string_agg(ref, ', ' ORDER BY ref)
    INTO duplicate_refs
    FROM (
      SELECT origin_scribe_draft_ref AS ref
      FROM encounters
      WHERE origin_scribe_draft_ref IS NOT NULL
      GROUP BY origin_scribe_draft_ref
      HAVING count(*) > 1
    ) flagged;
  IF duplicate_refs IS NOT NULL THEN
    RAISE EXCEPTION
      'migration 0012 preflight: sessions with multiple signed encounters found (origin_scribe_draft_ref: %). Manual clinical review required before applying the uniqueness invariant — no records were modified.',
      duplicate_refs;
  END IF;
END $$;

-- Replace the plain lookup index with the unique one (schema parity: the
-- @@index([originScribeDraftRef]) is superseded by @unique in the datamodel,
-- so a post-migration `prisma migrate diff` reports no difference).
DROP INDEX IF EXISTS "encounters_origin_scribe_draft_ref_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "encounters_origin_scribe_draft_ref_key"
  ON "encounters"("origin_scribe_draft_ref");
