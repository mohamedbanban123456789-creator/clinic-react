-- RPS-2 baseline migration (regenerated from prisma/schema.prisma via
-- `prisma migrate diff --from-empty --to-schema-datamodel`). This is the
-- authoritative DDL that provisions a fresh PostgreSQL database. The two
-- canon partial-unique indexes from Appendix A are appended below so the
-- queue race-authority constraints exist after `prisma migrate deploy`.
-- The third canon statement (REVOKE UPDATE, DELETE on receipts/audit_events
-- from clinic_app) is NOT here: it is a privileged owner-role grant change and
-- must be applied manually under the migration/owner role (see canon.sql).
-- No fourth canon statement is introduced (C-11 preserved).
-- CreateEnum
CREATE TYPE "Role" AS ENUM ('DOCTOR', 'SECRETARY');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('WAITING', 'IN_CONSULTATION', 'COMPLETED', 'SKIPPED', 'NO_SHOW', 'ABANDONED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'COMPLIMENTARY', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "ReceiptType" AS ENUM ('CHARGE', 'REVERSAL');

-- CreateEnum
CREATE TYPE "PettyDirection" AS ENUM ('EXPENSE', 'INJECTION');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ShiftResult" AS ENUM ('BALANCED', 'SURPLUS', 'DEFICIT');

-- CreateEnum
CREATE TYPE "IntercomType" AS ENUM ('DOCTOR_COMPLIMENTARY', 'DOCTOR_NEXT', 'DOCTOR_FOLLOWUP', 'SEC_DISRUPTION', 'SEC_PHARMACY_LAB', 'SEC_CORRECTION_REQUEST', 'CUSTOM_TEXT');

-- CreateEnum
CREATE TYPE "EncounterSource" AS ENUM ('MANUAL', 'SCRIBE');

-- CreateEnum
CREATE TYPE "EncounterStatus" AS ENUM ('DRAFT', 'SIGNED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "MedicationStatus" AS ENUM ('ACTIVE', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "ScribeMode" AS ENUM ('AMBIENT_LIVE', 'DICTATION_60S');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ScribeSessionStatus" AS ENUM ('UPLOADED', 'TRANSCRIBING', 'TRANSCRIBED', 'COMMITTED', 'FAILED', 'WITHDRAWN', 'PURGED');

-- CreateEnum
CREATE TYPE "ScribeDraftStatus" AS ENUM ('DRAFT', 'EDITED', 'SIGNED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('COMPLETE', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('LOGIN', 'LOGIN_LOCKOUT', 'LOGOUT', 'REFRESH', 'USER_CREATE', 'USER_DEACTIVATE', 'USER_ACTIVATE', 'PASSWORD_CHANGE', 'PATIENT_CREATE', 'PATIENT_UPDATE', 'PATIENT_SEARCH', 'PATIENT_FLAGGED_DUPLICATE', 'QUEUE_CHECKIN', 'QUEUE_CALL', 'QUEUE_SKIP', 'QUEUE_REQUEUE', 'QUEUE_COMPLETE', 'QUEUE_UNDO_COMPLETE', 'QUEUE_COMPLETE_UNDO', 'QUEUE_OUT_OF_ORDER_CALL', 'QUEUE_NO_SHOW', 'QUEUE_ABANDON', 'FORCED_CALLNEXT', 'CHECKIN_DEBT_ACK', 'QUEUE_REORDER', 'EMERGENCY_FLAG', 'EMERGENCY_UNFLAG', 'CHECKOUT', 'INVOICE_PAY', 'INVOICE_WRITE_OFF', 'COMPLIMENTARY', 'WRITE_OFF', 'REVERSAL', 'PETTY_CREATE', 'SHIFT_OPEN', 'SHIFT_CLOSE', 'INTERCOM_SEND', 'FOLLOWUP_CREATE', 'ENCOUNTER_CREATE', 'ENCOUNTER_UPDATE', 'ENCOUNTER_SIGN', 'ENCOUNTER_DISCARD', 'ENCOUNTER_ADDENDUM', 'CHART_READ', 'MEDICATION_CREATE', 'MEDICATION_DISCONTINUE', 'MEDICATION_ADJUST', 'VAULT_ACCESS', 'SCRIBE_UPLOAD', 'SCRIBE_TRANSCRIBE', 'CONSENT_WITHDRAWN', 'AUDIO_PURGED', 'IDEMPOTENT_REPLAY', 'FLOOR_VIOLATION', 'DISCREPANCY_FLAG', 'DISCOUNT_FLOOR_BLOCKED', 'RECEIPT_REVERSAL', 'SHIFT_ACK', 'INTEGRITY_CHECK_FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'SECRETARY',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT,
    "last_login_at" TIMESTAMP(3),
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "password_must_change" BOOLEAN NOT NULL DEFAULT false,
    "last_password_change_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_token_families" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "token_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "rotated_from_id" TEXT,
    "is_revoked" BOOLEAN NOT NULL DEFAULT false,
    "reuse_detected" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "refresh_token_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "standard_fee_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "avg_consult_duration_min" INTEGER NOT NULL,
    "opening_float_minor" INTEGER NOT NULL DEFAULT 0,
    "secretary_max_discount_minor" INTEGER NOT NULL,
    "secretary_max_discount_pct" INTEGER NOT NULL,
    "audio_retention_days" INTEGER NOT NULL DEFAULT 30,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "full_name_norm" TEXT NOT NULL,
    "date_of_birth" TIMESTAMP(3) NOT NULL,
    "phone" TEXT,
    "phone_norm" TEXT,
    "national_id" TEXT,
    "national_id_norm" TEXT,
    "guardian_phone" TEXT,
    "guardian_phone_norm" TEXT,
    "emergency_contact_name" TEXT,
    "emergency_contact_phone" TEXT,
    "emergency_contact_relation" TEXT,
    "physical_address" TEXT,
    "admin_notes" VARCHAR(500),
    "registration_status" "RegistrationStatus" NOT NULL DEFAULT 'COMPLETE',
    "duplicate_of_patient_id" TEXT,
    "outstanding_balance_minor" INTEGER NOT NULL DEFAULT 0,
    "last_visit_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" TEXT NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "opening_float_minor" INTEGER NOT NULL DEFAULT 0,
    "opening_carry_forward_minor" INTEGER NOT NULL DEFAULT 0,
    "opening_discrepancy_minor" INTEGER NOT NULL DEFAULT 0,
    "queue_version" INTEGER NOT NULL DEFAULT 0,
    "expected_cash_minor" INTEGER,
    "actual_counted_minor" INTEGER,
    "difference_minor" INTEGER,
    "result" "ShiftResult",
    "integrity_check_passed" BOOLEAN,
    "opened_by_user_id" TEXT NOT NULL,
    "closed_by_user_id" TEXT,
    "closed_at" TIMESTAMP(3),
    "reviewed_by_user_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "close_idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_entries" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "shift_id" TEXT NOT NULL,
    "status" "QueueStatus" NOT NULL DEFAULT 'WAITING',
    "is_emergency" BOOLEAN NOT NULL DEFAULT false,
    "emergency_reason" TEXT,
    "position" INTEGER NOT NULL,
    "checked_in_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "called_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "reorder_count" INTEGER NOT NULL DEFAULT 0,
    "clinical_encounter_ref" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "undo_window_until" TIMESTAMP(3),
    "emergency_flagged_at" TIMESTAMP(3),
    "emergency_reason_code" TEXT,
    "emergency_flagged_by_user_id" TEXT,
    "previous_position" INTEGER,
    "skipped_at" TIMESTAMP(3),
    "no_show_at" TIMESTAMP(3),
    "no_show_reason_code" TEXT,
    "abandon_at" TIMESTAMP(3),
    "abandon_reason_code" TEXT,
    "abandon_billable" BOOLEAN,
    "out_of_order_reason_code" TEXT,
    "debt_ack_at" TIMESTAMP(3),
    "debt_ack_by_user_id" TEXT,

    CONSTRAINT "queue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "queue_entry_id" TEXT NOT NULL,
    "shift_id" TEXT NOT NULL,
    "queue_entry_ref_plain" TEXT,
    "standard_fee_minor" INTEGER NOT NULL,
    "final_fee_minor" INTEGER NOT NULL,
    "discount_minor" INTEGER NOT NULL DEFAULT 0,
    "discount_reason" TEXT,
    "is_complimentary" BOOLEAN NOT NULL DEFAULT false,
    "complimentary_authorized_by_user_id" TEXT,
    "collected_minor" INTEGER NOT NULL DEFAULT 0,
    "write_off_minor" INTEGER NOT NULL DEFAULT 0,
    "write_off_reason" TEXT,
    "outstanding_minor" INTEGER NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UNPAID',
    "source" TEXT NOT NULL DEFAULT 'CHECKIN_AUTO',
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" TEXT NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "shift_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "type" "ReceiptType" NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "reversal_of_receipt_id" TEXT,
    "reason" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "petty_expenses" (
    "id" TEXT NOT NULL,
    "shift_id" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "direction" "PettyDirection" NOT NULL DEFAULT 'EXPENSE',
    "receipt_ref" TEXT,
    "actor_user_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "petty_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intercom_messages" (
    "id" TEXT NOT NULL,
    "from_user_id" TEXT NOT NULL,
    "from_role" "Role" NOT NULL,
    "message_type" "IntercomType" NOT NULL,
    "body_text" VARCHAR(1000),
    "related_queue_entry_id" TEXT,
    "related_invoice_id" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intercom_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up_tasks" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "requested_by_user_id" TEXT NOT NULL,
    "note" VARCHAR(500) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "source_message_id" TEXT,

    CONSTRAINT "follow_up_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encounters" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "queue_entry_ref" TEXT,
    "source" "EncounterSource" NOT NULL DEFAULT 'MANUAL',
    "visit_date" TIMESTAMP(3),
    "encounter_type" TEXT,
    "soap_subjective" TEXT,
    "soap_objective" TEXT,
    "soap_assessment" TEXT,
    "soap_plan" TEXT,
    "mse_appearance" TEXT NOT NULL DEFAULT 'NOT_PERFORMED',
    "mse_behavior" TEXT NOT NULL DEFAULT 'NOT_PERFORMED',
    "mse_speech_coherence" TEXT NOT NULL DEFAULT 'NOT_PERFORMED',
    "mse_mood_affect" TEXT NOT NULL DEFAULT 'NOT_PERFORMED',
    "diagnoses" JSONB NOT NULL DEFAULT '[]',
    "status" "EncounterStatus" NOT NULL DEFAULT 'DRAFT',
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "final_content_hash" TEXT,
    "signed_by_user_id" TEXT,
    "signed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "addendum_count" INTEGER NOT NULL DEFAULT 0,
    "origin_scribe_draft_ref" TEXT,

    CONSTRAINT "encounters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encounter_addenda" (
    "id" TEXT NOT NULL,
    "encounter_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "encounter_addenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medications" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "encounter_ref" TEXT,
    "drug_name" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "status" "MedicationStatus" NOT NULL DEFAULT 'ACTIVE',
    "cessation_reason" TEXT,
    "cessation_note" TEXT,
    "superseded_by_medication_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stopped_at" TIMESTAMP(3),
    "prescribed_by_user_id" TEXT NOT NULL,

    CONSTRAINT "medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "therapy_notes" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "encounter_ref" TEXT,
    "ciphertext" TEXT,
    "wrapped_dek" TEXT,
    "nonce" TEXT,
    "key_id" TEXT NOT NULL,
    "note_date" TIMESTAMP(3),
    "seq" INTEGER NOT NULL DEFAULT 1,
    "supersedes_note_id" TEXT,
    "shredded_at" TIMESTAMP(3),
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "therapy_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scribe_sessions" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "encounter_ref" TEXT,
    "queue_entry_ref" TEXT,
    "mode" "ScribeMode" NOT NULL,
    "audio_reference" TEXT,
    "duration_sec" INTEGER,
    "consent_status" "ConsentStatus" NOT NULL DEFAULT 'GRANTED',
    "consented_at" TIMESTAMP(3) NOT NULL,
    "withdrawn_at" TIMESTAMP(3),
    "withdrawal_reason" TEXT,
    "status" "ScribeSessionStatus" NOT NULL DEFAULT 'UPLOADED',
    "audio_retention_until" TIMESTAMP(3),
    "transcript_reference" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stopped_at" TIMESTAMP(3),

    CONSTRAINT "scribe_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scribe_drafts" (
    "id" TEXT NOT NULL,
    "scribe_session_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "mse_snapshot" JSONB NOT NULL,
    "transcript_reference" TEXT,
    "soap_draft_s" TEXT NOT NULL,
    "soap_draft_o" TEXT NOT NULL,
    "soap_draft_a" TEXT NOT NULL,
    "soap_draft_p" TEXT NOT NULL,
    "confidence_score" DOUBLE PRECISION,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ScribeDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signed_encounter_ref" TEXT,

    CONSTRAINT "scribe_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "actor_role" "Role" NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before_state" JSONB,
    "after_state" JSONB,
    "reason_text" TEXT,
    "request_id" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_identifier_key" ON "users"("identifier");

-- CreateIndex
CREATE INDEX "users_role_is_active_idx" ON "users"("role", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_families_token_id_key" ON "refresh_token_families"("token_id");

-- CreateIndex
CREATE INDEX "refresh_token_families_user_id_is_revoked_idx" ON "refresh_token_families"("user_id", "is_revoked");

-- CreateIndex
CREATE INDEX "refresh_token_families_expires_at_idx" ON "refresh_token_families"("expires_at");

-- CreateIndex
CREATE INDEX "refresh_token_families_family_id_idx" ON "refresh_token_families"("family_id");

-- CreateIndex
CREATE INDEX "patients_phone_norm_idx" ON "patients"("phone_norm");

-- CreateIndex
CREATE INDEX "patients_national_id_norm_idx" ON "patients"("national_id_norm");

-- CreateIndex
CREATE INDEX "patients_full_name_norm_idx" ON "patients"("full_name_norm");

-- CreateIndex
CREATE INDEX "patients_guardian_phone_norm_idx" ON "patients"("guardian_phone_norm");

-- CreateIndex
CREATE INDEX "patients_duplicate_of_patient_id_idx" ON "patients"("duplicate_of_patient_id");

-- CreateIndex
CREATE INDEX "patients_registration_status_idx" ON "patients"("registration_status");

-- CreateIndex
CREATE INDEX "patients_last_visit_at_idx" ON "patients"("last_visit_at");

-- CreateIndex
CREATE UNIQUE INDEX "patients_national_id_norm_key" ON "patients"("national_id_norm");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_business_date_key" ON "shifts"("business_date");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_close_idempotency_key_key" ON "shifts"("close_idempotency_key");

-- CreateIndex
CREATE INDEX "shifts_status_idx" ON "shifts"("status");

-- CreateIndex
CREATE INDEX "shifts_queue_version_idx" ON "shifts"("queue_version");

-- CreateIndex
CREATE INDEX "queue_entries_shift_id_status_position_idx" ON "queue_entries"("shift_id", "status", "position");

-- CreateIndex
CREATE INDEX "queue_entries_patient_id_checked_in_at_idx" ON "queue_entries"("patient_id", "checked_in_at");

-- CreateIndex
CREATE INDEX "queue_entries_clinical_encounter_ref_idx" ON "queue_entries"("clinical_encounter_ref");

-- CreateIndex
CREATE INDEX "queue_entries_shift_id_emergency_flagged_at_idx" ON "queue_entries"("shift_id", "emergency_flagged_at");

-- CreateIndex
CREATE UNIQUE INDEX "queue_entries_shift_id_idempotency_key_key" ON "queue_entries"("shift_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_queue_entry_id_key" ON "invoices"("queue_entry_id");

-- CreateIndex
CREATE INDEX "invoices_shift_id_status_idx" ON "invoices"("shift_id", "status");

-- CreateIndex
CREATE INDEX "invoices_patient_id_status_idx" ON "invoices"("patient_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_shift_id_idempotency_key_key" ON "invoices"("shift_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "receipts_invoice_id_created_at_idx" ON "receipts"("invoice_id", "created_at");

-- CreateIndex
CREATE INDEX "receipts_shift_id_created_at_idx" ON "receipts"("shift_id", "created_at");

-- CreateIndex
CREATE INDEX "receipts_patient_id_created_at_idx" ON "receipts"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "receipts_reversal_of_receipt_id_idx" ON "receipts"("reversal_of_receipt_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_shift_id_idempotency_key_key" ON "receipts"("shift_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "petty_expenses_shift_id_created_at_idx" ON "petty_expenses"("shift_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "petty_expenses_shift_id_idempotency_key_key" ON "petty_expenses"("shift_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "intercom_messages_created_at_idx" ON "intercom_messages"("created_at");

-- CreateIndex
CREATE INDEX "intercom_messages_related_queue_entry_id_created_at_idx" ON "intercom_messages"("related_queue_entry_id", "created_at");

-- CreateIndex
CREATE INDEX "follow_up_tasks_patient_id_status_idx" ON "follow_up_tasks"("patient_id", "status");

-- CreateIndex
CREATE INDEX "encounters_patient_id_signed_at_idx" ON "encounters"("patient_id", "signed_at");

-- CreateIndex
CREATE INDEX "encounters_status_idx" ON "encounters"("status");

-- CreateIndex
CREATE INDEX "encounters_source_idx" ON "encounters"("source");

-- CreateIndex
CREATE INDEX "encounters_queue_entry_ref_idx" ON "encounters"("queue_entry_ref");

-- CreateIndex
CREATE INDEX "encounters_origin_scribe_draft_ref_idx" ON "encounters"("origin_scribe_draft_ref");

-- CreateIndex
CREATE INDEX "encounter_addenda_encounter_id_version_idx" ON "encounter_addenda"("encounter_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "encounter_addenda_encounter_id_version_key" ON "encounter_addenda"("encounter_id", "version");

-- CreateIndex
CREATE INDEX "medications_patient_id_status_started_at_idx" ON "medications"("patient_id", "status", "started_at");

-- CreateIndex
CREATE INDEX "medications_drug_name_idx" ON "medications"("drug_name");

-- CreateIndex
CREATE INDEX "medications_encounter_ref_idx" ON "medications"("encounter_ref");

-- CreateIndex
CREATE INDEX "therapy_notes_patient_id_created_at_idx" ON "therapy_notes"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "scribe_sessions_patient_id_created_at_idx" ON "scribe_sessions"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "scribe_sessions_status_idx" ON "scribe_sessions"("status");

-- CreateIndex
CREATE INDEX "scribe_sessions_audio_retention_until_idx" ON "scribe_sessions"("audio_retention_until");

-- CreateIndex
CREATE INDEX "scribe_drafts_scribe_session_id_version_idx" ON "scribe_drafts"("scribe_session_id", "version");

-- CreateIndex
CREATE INDEX "scribe_drafts_patient_id_created_at_idx" ON "scribe_drafts"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "scribe_drafts_signed_encounter_ref_idx" ON "scribe_drafts"("signed_encounter_ref");

-- CreateIndex
CREATE UNIQUE INDEX "audit_events_request_id_key" ON "audit_events"("request_id");

-- CreateIndex
CREATE INDEX "audit_events_created_at_idx" ON "audit_events"("created_at");

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_created_at_idx" ON "audit_events"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_actor_user_id_created_at_idx" ON "audit_events"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_scope_actor_user_id_key_key" ON "idempotency_records"("scope", "actor_user_id", "key");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token_families" ADD CONSTRAINT "refresh_token_families_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_opened_by_user_id_fkey" FOREIGN KEY ("opened_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_closed_by_user_id_fkey" FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_queue_entry_id_fkey" FOREIGN KEY ("queue_entry_id") REFERENCES "queue_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_complimentary_authorized_by_user_id_fkey" FOREIGN KEY ("complimentary_authorized_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petty_expenses" ADD CONSTRAINT "petty_expenses_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petty_expenses" ADD CONSTRAINT "petty_expenses_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercom_messages" ADD CONSTRAINT "intercom_messages_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercom_messages" ADD CONSTRAINT "intercom_messages_related_queue_entry_id_fkey" FOREIGN KEY ("related_queue_entry_id") REFERENCES "queue_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercom_messages" ADD CONSTRAINT "intercom_messages_related_invoice_id_fkey" FOREIGN KEY ("related_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_source_message_id_fkey" FOREIGN KEY ("source_message_id") REFERENCES "intercom_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_signed_by_user_id_fkey" FOREIGN KEY ("signed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounter_addenda" ADD CONSTRAINT "encounter_addenda_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounter_addenda" ADD CONSTRAINT "encounter_addenda_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medications" ADD CONSTRAINT "medications_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medications" ADD CONSTRAINT "medications_prescribed_by_user_id_fkey" FOREIGN KEY ("prescribed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_notes" ADD CONSTRAINT "therapy_notes_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_notes" ADD CONSTRAINT "therapy_notes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scribe_sessions" ADD CONSTRAINT "scribe_sessions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scribe_sessions" ADD CONSTRAINT "scribe_sessions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scribe_drafts" ADD CONSTRAINT "scribe_drafts_scribe_session_id_fkey" FOREIGN KEY ("scribe_session_id") REFERENCES "scribe_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scribe_drafts" ADD CONSTRAINT "scribe_drafts_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Appendix A canon partial-unique indexes (2 of the 3 canon statements; the
-- REVOKE remains a manual privileged step). These are the race authority for
-- the queue engine and are required by BE-202/BE-306.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_single_consult ON queue_entries (shift_id) WHERE status = 'IN_CONSULTATION';
CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_one_open_per_patient ON queue_entries (shift_id, patient_id) WHERE status IN ('WAITING','IN_CONSULTATION','SKIPPED');