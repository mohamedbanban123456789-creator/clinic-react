/**
 * BE-702 supervision DTOs (DOCTOR-only oversight surface).
 *
 * Every route under `/api/v1/supervision` requires `requireRole('DOCTOR')`
 * BEFORE any resource lookup, so these payloads never reach a SECRETARY and
 * carry no `SecretSafe<T>` brand (the global sanitizer only gates SECRETARY
 * 2xx bodies). Shapes are still allowlisted by construction: each service
 * function picks explicit scalar fields — no Prisma row is returned verbatim,
 * and no clinical body (SOAP/MSE/transcript/ciphertext) is ever included.
 * Cross-boundary correlation uses plain string ids only (DB-02).
 */

export type SupervisionShiftStatus = 'OPEN' | 'CLOSED';
export type SupervisionShiftResult = 'BALANCED' | 'SURPLUS' | 'DEFICIT';

// ---------------------------------------------------------------------------
// GET /supervision/front-desk-activity — queue + cash feed
// ---------------------------------------------------------------------------

export interface FrontDeskActivityItem {
  readonly action: string;
  readonly kind: 'QUEUE' | 'CASH' | 'SHIFT';
  readonly entityType: string;
  readonly entityId: string;
  readonly actorUserId: string;
  readonly actorRole: 'DOCTOR' | 'SECRETARY';
  readonly createdAt: string;
  readonly reason: string | null;
}

export interface FrontDeskActivityDto {
  readonly shiftId: string;
  readonly businessDate: string;
  readonly queueVersion: number;
  readonly totalEvents: number;
  readonly data: readonly FrontDeskActivityItem[];
  readonly nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// GET /supervision/cash-summary — full financial audit view for a shift
// ---------------------------------------------------------------------------

export interface CashSummaryByMethod {
  readonly CASH: number;
  readonly OTHER: number;
}

export interface CashSummaryAuditCoverage {
  readonly expectedAuditedEntities: number;
  readonly auditedEntities: number;
  readonly missing: number;
}

export interface CashSummaryDto {
  readonly shiftId: string;
  readonly businessDate: string;
  readonly status: SupervisionShiftStatus;
  readonly queueVersion: number;
  readonly grossCollectedMinor: number;
  readonly cashCollectedMinor: number;
  readonly otherCollectedMinor: number;
  readonly reversalsMinor: number;
  readonly pettyExpenseMinor: number;
  readonly pettyInjectionMinor: number;
  readonly netCashMinor: number;
  readonly byMethod: CashSummaryByMethod;
  readonly expectedCashMinor: number | null;
  readonly actualCountedMinor: number | null;
  readonly differenceMinor: number | null;
  readonly result: SupervisionShiftResult | null;
  readonly reconciliationPassed: boolean;
  readonly invariantFailures: readonly string[];
  readonly auditCoverage: CashSummaryAuditCoverage;
  readonly reviewedByUserId: string | null;
  readonly reviewedAt: string | null;
  readonly reviewNote: string | null;
}

// ---------------------------------------------------------------------------
// GET /supervision/shifts — doctor async review queue
// ---------------------------------------------------------------------------

export interface SupervisionShiftItem {
  readonly shiftId: string;
  readonly businessDate: string;
  readonly status: SupervisionShiftStatus;
  readonly expectedCashMinor: number | null;
  readonly actualCountedMinor: number | null;
  readonly differenceMinor: number | null;
  readonly result: SupervisionShiftResult | null;
  readonly reviewedByUserId: string | null;
  readonly reviewedAt: string | null;
  readonly reviewNote: string | null;
  readonly closedAt: string | null;
}

export interface SupervisionShiftsDto {
  readonly data: readonly SupervisionShiftItem[];
  readonly nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// GET /supervision/unsigned-notes — clinical safety monitor
// ---------------------------------------------------------------------------

export interface UnsignedCompletedVisit {
  readonly queueEntryId: string;
  readonly patientId: string;
  readonly displayName: string;
  readonly status: string;
  readonly completedAt: string | null;
  readonly hasSignedEncounter: boolean;
  readonly isDeferred?: boolean;
  readonly deferredReason?: string | null;
  readonly deferredAt?: string | null;
}

export interface StaleUnsignedDraft {
  readonly draftKind: 'ENCOUNTER' | 'SCRIBE';
  readonly draftId: string;
  readonly patientId: string;
  readonly status: string;
  readonly createdAt: string;
  readonly ageHours: number;
  readonly stale: boolean;
}

export interface UnsignedNotesDto {
  readonly shiftId: string | null;
  readonly completedWithoutSigned: readonly UnsignedCompletedVisit[];
  readonly staleDrafts: readonly StaleUnsignedDraft[];
  readonly deferralCount: number;
}

// ---------------------------------------------------------------------------
// GET /supervision/discounts — per-secretary discount audit feed
// ---------------------------------------------------------------------------

export interface DiscountItem {
  readonly invoiceId: string;
  readonly queueEntryId: string;
  readonly patientId: string;
  readonly standardFeeMinor: number;
  readonly finalFeeMinor: number;
  readonly discountMinor: number;
  readonly discountReason: string | null;
  readonly isComplimentary: boolean;
  readonly createdByUserId: string;
  readonly authorName: string;
  readonly authorRole: 'DOCTOR' | 'SECRETARY';
  readonly createdAt: string;
}

export interface DiscountsDto {
  readonly shiftId: string;
  readonly count: number;
  readonly totalDiscountMinor: number;
  readonly data: readonly DiscountItem[];
}

// ---------------------------------------------------------------------------
// GET /supervision/noncash — non-cash receipt reconciliation
// ---------------------------------------------------------------------------

export interface NonCashReference {
  readonly receiptId: string;
  readonly invoiceId: string;
  readonly amountMinor: number;
  readonly type: 'CHARGE' | 'REVERSAL';
  readonly externalReference: string | null;
  readonly createdAt: string;
}

export interface NonCashMethodGroup {
  readonly method: string;
  readonly count: number;
  readonly totalMinor: number;
  readonly references: readonly NonCashReference[];
}

export interface NonCashDto {
  readonly shiftId: string;
  readonly businessDate: string;
  readonly count: number;
  readonly totalMinor: number;
  readonly byMethod: readonly NonCashMethodGroup[];
}

// ---------------------------------------------------------------------------
// GET /supervision/exceptions — operational discrepancies
// ---------------------------------------------------------------------------

export interface ExceptionCompletedWithoutInvoice {
  readonly queueEntryId: string;
  readonly patientId: string;
  readonly status: string;
  readonly completedAt: string | null;
}

export interface ExceptionEmergency {
  readonly queueEntryId: string;
  readonly patientId: string;
  readonly reasonCode: string | null;
  readonly flaggedAt: string | null;
  readonly flaggedByUserId: string | null;
}

export interface ExceptionsDto {
  readonly shiftId: string;
  readonly businessDate: string;
  readonly completedWithoutInvoice: readonly ExceptionCompletedWithoutInvoice[];
  readonly unacknowledgedEmergencies: readonly ExceptionEmergency[];
  readonly openingFloatDiscrepancyMinor: number;
  readonly openingCarryForwardMinor: number;
  readonly shiftVarianceMinor: number | null;
  readonly shiftResult: SupervisionShiftResult | null;
  readonly forcedClose: boolean;
}

// ---------------------------------------------------------------------------
// GET /supervision/discrepancies (RPS-2 BE-702 INV-1..10 gate view)
// ---------------------------------------------------------------------------

export interface InvViolation {
  readonly inv: string;
  readonly detail: string;
  readonly entities: readonly string[];
}

export interface DiscrepanciesDto {
  readonly shiftId: string;
  readonly invViolations: readonly InvViolation[];
  readonly missingAudit: readonly InvViolation[];
  readonly staleQueue: boolean;
}

// ---------------------------------------------------------------------------
// GET /supervision/shift-readiness (close-readiness probe)
// ---------------------------------------------------------------------------

export interface ShiftReadinessOpenEntry {
  readonly queueEntryId: string;
  readonly status: string;
  readonly position: number;
}

export interface ShiftReadinessDto {
  readonly shiftId: string;
  readonly canClose: boolean;
  readonly blockers: readonly string[];
  readonly queueVersion: number;
  readonly openEntries: readonly ShiftReadinessOpenEntry[];
}
