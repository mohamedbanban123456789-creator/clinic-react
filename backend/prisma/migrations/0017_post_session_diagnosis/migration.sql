-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'ENCOUNTER_AI_DIAGNOSIS';

-- AlterTable
ALTER TABLE "encounters" ADD COLUMN "diagnosis_notes" TEXT;
