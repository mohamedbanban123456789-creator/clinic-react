-- Single-OPEN-shift clinic-wide invariant (companion to the app-level pre-check
-- in shift.service openShift, and to the canon queue partial uniques in 0001).
-- The app pre-check ("SHIFT_ALREADY_OPEN") is a friendly 409 only; two concurrent
-- opens with DIFFERENT businessDate values both pass it (businessDate @unique is
-- per-date). This partial unique index is the race authority: at most one OPEN
-- shift clinic-wide, enforced by PostgreSQL.
-- Idempotent (IF NOT EXISTS) like 0009; safe to re-run.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_shifts_single_open" ON "shifts" ("status") WHERE "status" = 'OPEN';
