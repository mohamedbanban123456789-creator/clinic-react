-- Decision 5: canonical follow-up type/window vocabulary.
-- 1) follow_up_tasks.follow_up_type / follow_up_window — the structured
--    descriptor (canonical values GENERAL / NEXT_VISIT, see
--    intercom.validators.ts followUpSchema) persisted on their own columns
--    instead of being flattened into `note`. All pre-existing rows were
--    created by the single shipped creation path (intercom.store
--    createFollowUp → GENERAL / NEXT_VISIT), so the defaults ARE the correct
--    backfill for legacy data.
-- 2) AuditAction.FOLLOWUP_UPDATE — dedicated audit action for
--    PATCH /followups/:id (previously reused FOLLOWUP_CREATE).
-- Plain ADD VALUE is correct (the value is only referenced by later app
-- writes); IF NOT EXISTS guards re-runs, matching 0009/0010.
ALTER TABLE "follow_up_tasks" ADD COLUMN IF NOT EXISTS "follow_up_type" TEXT NOT NULL DEFAULT 'GENERAL';
ALTER TABLE "follow_up_tasks" ADD COLUMN IF NOT EXISTS "follow_up_window" TEXT NOT NULL DEFAULT 'NEXT_VISIT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'FOLLOWUP_UPDATE';
