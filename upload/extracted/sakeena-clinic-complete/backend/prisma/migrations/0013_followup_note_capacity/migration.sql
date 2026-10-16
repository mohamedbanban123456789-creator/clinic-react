-- R11 (post-review remediation): the follow-up note IS the doctor's actionable
-- instruction (Decision 5). Capacity previously matched VarChar(500) while the
-- intercom text budget (and the composer validation) allows 1000, so longer
-- instructions were silently truncated at persistence. Widen the column to
-- match the canonical 1000 budget.
--
-- Widening VARCHAR is a metadata-only change in PostgreSQL (no table rewrite,
-- no data change, safe to re-run via the guarded form below). All existing
-- rows are preserved verbatim.
ALTER TABLE "follow_up_tasks" ALTER COLUMN "note" TYPE VARCHAR(1000);
