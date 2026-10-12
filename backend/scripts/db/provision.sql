-- ============================================================================
-- Database role provisioning (Appendix A companion) — Clinic-back / RPS-2
--
-- canon.sql (prisma/migrations/0001_init/canon.sql) authorizes exactly the 3
-- load-bearing statements (2 partial unique indexes + the immutability REVOKE),
-- but those 3 statements alone do NOT provision the runtime role: without base
-- grants clinic_app cannot even SELECT. This script is the complete, repeatable
-- provisioning path referenced by DATABASE_SCHEMA_SPEC.md §14 / PROJECT_CONVENTIONS.md.
--
-- Run as the MIGRATION role (schema owner) AFTER `prisma migrate deploy`, on
-- the application database:
--   npx prisma db execute --url "$MIGRATION_DB_URL" --file scripts/db/provision.sql
--
-- Roles expected (create with createuser/SQL before this script):
--   clinic_migrate  — owner, runs migrations + this provisioning (no runtime use)
--   clinic_app      — runtime role used by Prisma (DATABASE_URL/APP_DB_ROLE)
--
-- After this script:
--   clinic_app has SELECT/INSERT/UPDATE/DELETE on all current+future tables and
--   USAGE on sequences, but NOT: UPDATE/DELETE on receipts + audit_events
--   (append-only, DB-enforced), and NO DDL rights (no CREATE on the schema —
--   enforced by §2b on every supported PostgreSQL version).
-- ============================================================================

-- 1) Schema usage + base table privileges (current tables).
GRANT USAGE ON SCHEMA public TO clinic_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO clinic_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO clinic_app;

-- 2) Future tables (new migrations) inherit the same base grants automatically.
ALTER DEFAULT PRIVILEGES FOR ROLE clinic_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clinic_app;
ALTER DEFAULT PRIVILEGES FOR ROLE clinic_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO clinic_app;

-- 2b) DDL denial on EVERY supported PostgreSQL version (R10): PostgreSQL 15+
-- already denies CREATE on schema public to PUBLIC, but on older servers the
-- historical default grants it. Revoking explicitly makes the "no DDL rights"
-- guarantee version-independent (verify-runtime-role.mjs asserts it via the
-- CREATE TABLE deny probe). On clusters older than 15 the schema public is
-- owned by the bootstrap superuser, so run this script AS THE SUPERUSER there;
-- on 15+ the schema owner (clinic_migrate / pg_database_owner) suffices.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM clinic_app;

-- 3) Appendix A canon.sql — the 3 normative statements (idempotent re-run safe;
--    the REVOKE is a no-op error-safe retraction, keep last).
CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_single_consult ON queue_entries (shift_id) WHERE status = 'IN_CONSULTATION';
CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_one_open_per_patient ON queue_entries (shift_id, patient_id) WHERE status IN ('WAITING','IN_CONSULTATION','SKIPPED');
REVOKE UPDATE, DELETE ON receipts, audit_events FROM clinic_app;
