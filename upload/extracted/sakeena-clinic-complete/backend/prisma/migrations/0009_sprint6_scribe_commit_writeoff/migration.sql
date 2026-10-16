-- Sprint 6 closure: additive enum values + one nullable plain-ref column (RPS-2).
-- 1) ScribeSessionStatus.COMMITTED — set atomically when a scribe session is
--    committed (Encounter + Medications created in the same transaction).
-- 2) AuditAction.INVOICE_WRITE_OFF — dedicated audit action for the
--    doctor-only invoice write-off endpoint (BE-303 write-off).
-- 3) scribe_sessions.queue_entry_ref — plain indexed String ref (DB-02, NO FK)
--    to the queue entry that seeded the session; lets commit set
--    Encounter.queueEntryRef. Nullable, no clinical relation.
-- ALTER TYPE ... ADD VALUE is non-transactional-safe for immediate use in the
-- same statement, but these values are only referenced by later app writes, so
-- a plain ADD VALUE is correct. IF NOT EXISTS guards re-runs.
ALTER TYPE "ScribeSessionStatus" ADD VALUE IF NOT EXISTS 'COMMITTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INVOICE_WRITE_OFF';
ALTER TABLE "scribe_sessions" ADD COLUMN IF NOT EXISTS "queue_entry_ref" TEXT;
