-- SUPERSEDED by 0001_init: the baseline migration.sql now contains the COMPLETE
-- final schema (all tables, columns, enums, and the two canon partial-unique
-- indexes) generated from prisma/schema.prisma. This incremental patch predates
-- that baseline and is retained only to preserve the migration history chain.
-- Applying it against the regenerated baseline would error (columns/tables it
-- ALTERs or ADDs already exist). It is therefore a deliberate no-op.
-- The third canon statement (REVOKE) is applied manually under the owner role.
SELECT 1;
