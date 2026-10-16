-- Appendix A Canon SQL — exactly 3 statements (normative, RPS-2).
-- Applied via privileged migration role; runtime role clinic_app never holds DDL after.
-- 1) One IN_CONSULTATION per shift. 2) One open entry per patient per shift.
-- 3) Runtime grant immutability for receipts + audit_events.
CREATE UNIQUE INDEX uq_queue_single_consult ON queue_entries (shift_id) WHERE status = 'IN_CONSULTATION';
CREATE UNIQUE INDEX uq_queue_one_open_per_patient ON queue_entries (shift_id, patient_id) WHERE status IN ('WAITING','IN_CONSULTATION','SKIPPED');
REVOKE UPDATE, DELETE ON receipts, audit_events FROM clinic_app;
