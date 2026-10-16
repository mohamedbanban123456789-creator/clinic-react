/**
 * Typed DTO layer — mirrors the actual backend contracts 1:1.
 * Money fields are integer minor units; timestamps are ISO-8601 UTC strings.
 */

import type {
  IntercomType,
  InvoiceStatus,
  PaymentMethodDto,
  QueueStatus,
} from "@/lib/constants"

export interface ApiErrorDetail {
  field?: string
  issue: string
  expected?: string
}

export interface ApiErrorShape {
  code: string
  message: string
  details: ApiErrorDetail[]
}

/* ---------------------------- Auth ---------------------------- */

export type Gender = "MALE" | "FEMALE"

export interface UserDto {
  id: string
  name: string
  role: "DOCTOR" | "SECRETARY"
  gender?: Gender
}

export interface MeDto extends UserDto {
  lastLoginAt: string | null
  passwordMustChange: boolean
  gender?: Gender
}

export interface LoginResponse {
  accessToken: string
  user: UserDto
  mustChangePassword: boolean
}

export interface RefreshResponse {
  accessToken: string
}

/* ---------------------------- Settings ---------------------------- */

export interface ClinicSettingsDto {
  standardFeeMinor: number
  currency: string
  avgConsultDurationMin: number
  openingFloatMinor: number
  secretaryMaxDiscountMinor: number
  secretaryMaxDiscountPct: number
  audioRetentionDays: number
}

/* ---------------------------- Users ---------------------------- */

export interface UserListItemDto {
  id: string
  name: string
  identifier: string
  role: "DOCTOR" | "SECRETARY"
  gender?: Gender
  isActive: boolean
}

/* ---------------------------- Patients ---------------------------- */

export interface PatientDto {
  id: string
  fullName: string
  dateOfBirth: string
  phone: string | null
  nationalId: string | null
  guardianPhone: string | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
  emergencyContactRelation: string | null
  physicalAddress: string | null
  adminNotes: string | null
  registrationStatus: "COMPLETE" | "INCOMPLETE"
  outstandingBalanceMinor: number
  lastVisitAt: string | null
  createdAt: string
}

export interface PatientDetailDto extends PatientDto {
  pastVisitTimestamps: string[]
}

export interface PatientSearchCandidateDto {
  id: string
  fullName: string
  dateOfBirth: string
  phone: string | null
  phoneLast4: string | null
  nationalIdLast4: string | null
  lastVisitAt: string | null
  hasDebtAlert: boolean
  registrationStatus: "COMPLETE" | "INCOMPLETE"
}

/* ---------------------------- Queue ---------------------------- */

export interface DebtAlertDto {
  outstandingMinor: number
  oldestInvoiceDate: string | null
}

export interface QueueEntryDto {
  entryId: string
  patientId: string
  displayName: string
  status: QueueStatus
  position: number
  isEmergency: boolean
  emergencyReasonCode: string | null
  checkedInAt: string
  calledAt: string | null
  completedAt: string | null
  skippedAt: string | null
  noShowAt: string | null
  abandonAt: string | null
  estimatedWaitMin: number
  debtAckAt: string | null
  debtAlert: DebtAlertDto | null
  queueVersion: number
}

export interface QueueListDto {
  shiftId: string | null
  queueVersion: number
  estimatedWaitMin: number
  entries: QueueEntryDto[]
}

export interface WaitTimesDto {
  avgConsultDurationMin: number
  items: {
    entryId: string
    precedingCount: number
    estimatedWaitMin: number
  }[]
}

/* ---------------------------- Billing ---------------------------- */

export interface InvoiceListItemDto {
  invoiceId: string
  patientId: string
  queueEntryId: string
  standardFeeMinor: number
  finalFeeMinor: number
  discountMinor: number
  discountReason: string | null
  status: InvoiceStatus
  collectedMinor: number
  writeOffMinor: number
  outstandingMinor: number
  createdAt: string
}

export interface ReceiptDto {
  receiptId: string
  invoiceId: string
  patientId: string
  shiftId: string
  type: "CHARGE" | "REVERSAL"
  amountMinor: number
  method: PaymentMethodDto
  reversalOfReceiptId: string | null
  reason: string | null
  createdAt: string
}

export interface CheckoutDto {
  invoiceId: string
  queueEntryId: string
  patientId: string
  receiptId: string | null
  receiptType: "CHARGE" | null
  status: InvoiceStatus
  standardFeeMinor: number
  finalFeeMinor: number
  discountMinor: number
  discountReason: string | null
  collectedMinor: number
  outstandingMinor: number
  isComplimentary: boolean
  method: PaymentMethodDto | null
  createdAt: string
}

export interface PayInvoiceDto {
  invoiceId: string
  receiptId: string
  receiptType: "CHARGE"
  status: InvoiceStatus
  finalFeeMinor: number
  collectedMinor: number
  outstandingMinor: number
  amountMinor: number
  method: PaymentMethodDto | null
}

export interface SettleDto {
  patientId: string
  amountMinor: number
  appliedMinor: number
  remainingMinor: number
  outstandingMinor: number
  method: PaymentMethodDto
  lines: {
    invoiceId: string
    receiptId: string
    amountMinor: number
    status: InvoiceStatus
  }[]
}

export interface BalanceDto {
  patientId: string
  outstandingMinor: number
  lines: {
    invoiceId: string
    date: string
    dueMinor: number
    collectedMinor: number
    writeOffMinor: number
  }[]
}

/* ---------------------------- Shifts ---------------------------- */

export interface ShiftViewDto {
  shiftId: string
  businessDate: string
  status: "OPEN" | "CLOSED"
  openingFloatMinor: number
  openingCarryForwardMinor: number
  openingDiscrepancyMinor: number
  queueVersion: number
  expectedCashMinor: number | null
  actualCountedMinor: number | null
  differenceMinor: number | null
  result: "BALANCED" | "SURPLUS" | "DEFICIT" | null
  integrityCheckPassed: boolean | null
  openedByUserId: string
  closedAt: string | null
  reviewedByUserId: string | null
  reviewedAt: string | null
  reviewNote: string | null
}

export interface PettyExpenseDto {
  pettyId: string
  shiftId: string
  direction: "EXPENSE" | "INJECTION"
  amountMinor: number
  category: string
  description: string
  receiptRef: string | null
  createdByUserId: string
  createdAt: string
}

export interface ShiftSummaryDto {
  shiftId: string
  businessDate: string
  status: "OPEN" | "CLOSED"
  queueVersion: number
  totalServed: number
  grossCollectedMinor: number | null
  cashCollectedMinor: number | null
  byMethod: { CASH: number; OTHER: number } | null
  reversalsMinor: number | null
  pettyTotalMinor: number | null
  pettyExpenseMinor: number | null
  pettyInjectionMinor: number | null
  discountTotalMinor: number | null
  discountCount: number | null
  writeOffTotalMinor: number | null
  complimentaryCount: number | null
  newDebtTotalMinor: number | null
  expectedCashMinor: number | null
  actualCountedMinor: number | null
  differenceMinor: number | null
  result: "BALANCED" | "SURPLUS" | "DEFICIT" | null
  integrityCheckPassed: boolean | null
  reviewedByUserId: string | null
  reviewedAt: string | null
  reviewNote: string | null
}

export interface CloseShiftDto {
  shiftId: string
  status: "CLOSED"
  expectedCashMinor: number
  actualCountedMinor: number
  differenceMinor: number
  result: "BALANCED" | "SURPLUS" | "DEFICIT"
  integrityCheckPassed: boolean
  queueVersion: number
}

/* ---------------------------- Intercom ---------------------------- */

export interface IntercomMessageDto {
  id: string
  fromUserId: string
  fromRole: "DOCTOR" | "SECRETARY"
  type: IntercomType
  text: string | null
  relatedQueueEntryId: string | null
  createdAt: string
}

export interface FollowUpDto {
  id: string
  patientId: string
  requestedByUserId: string
  note: string
  followUpType: "GENERAL"
  window: "NEXT_VISIT"
  status: "REQUESTED" | "SCHEDULED" | "DONE" | "CANCELLED"
  sourceMessageId: string | null
  requestedAt: string
  resolvedAt: string | null
}

/* ---------------------------- EHR ---------------------------- */

export interface SoapDto {
  S: string | null
  O: string | null
  A: string | null
  P: string | null
}

export interface MseDto {
  appearance: string
  behavior: string
  speechCoherence: string
  moodAffect: string
}

export interface AddendumDto {
  id: string
  version: number
  text: string
  reasonCode: string
  createdAt: string
}

export interface ChartEncounterDto {
  encounterId: string
  source: "MANUAL" | "SCRIBE"
  visitDate: string | null
  encounterType: string | null
  signedAt: string | null
  diagnoses: string[]
  soap: SoapDto
  mse: MseDto
  finalContentHash: string | null
  addenda: AddendumDto[]
}

export interface EncounterDto extends ChartEncounterDto {
  patientId: string
  queueEntryId: string | null
  status: "DRAFT" | "SIGNED" | "DISCARDED"
  rowVersion: number
  signedByUserId: string | null
  createdAt: string
  updatedAt: string
}

export interface MedicationDto {
  medicationId: string
  patientId: string
  encounterId: string | null
  drugName: string
  dosage: string
  frequency: string
  instructions: string
  status: "ACTIVE" | "DISCONTINUED"
  cessationReasonCode: string | null
  cessationNote: string | null
  supersededByMedicationId: string | null
  startedAt: string
  stoppedAt: string | null
}

/* ---------------------------- Vault ---------------------------- */

export interface VaultNoteDto {
  noteId: string
  noteDate: string | null
  seq: number
  content: string
  supersedesNoteId: string | null
}

export interface VaultShreddedNoteDto {
  noteId: string
  noteDate: string | null
  seq: number
  shredded: true
  shreddedAt: string | null
}

/* ---------------------------- Scribe ---------------------------- */

export interface ScribeSessionDto {
  sessionId: string
  status: string
  mode: "AMBIENT_LIVE" | "DICTATION_60S"
  consentStatus: "GRANTED"
  audioRetentionUntil: string
}

export interface ScribeEvidenceItem {
  section: string
  claim: string
  quote: string
  speaker: "doctor" | "patient" | "unsure"
}

export interface ScribeTranscriptSegment {
  speaker: "doctor" | "patient" | "unsure"
  text: string
}

export interface ScribeAnalysisDto {
  sessionId: string
  analysis: {
    chiefComplaint: string
    symptoms: string[]
    moodAffect: string
    suggestions: { text: string; provenance: "AI" }[]
    evidence: ScribeEvidenceItem[]
    transcript: {
      cleanedText: string
      segments: ScribeTranscriptSegment[]
    } | null
  }
}

export interface ScribeCycle2Dto {
  sessionId: string
  soap: SoapDto
  prescriptions: {
    drugName: string
    dosage: string
    frequency: string
    instructions: string
  }[]
  finalDiagnosis: string
  evidence: ScribeEvidenceItem[]
}

export interface ScribeCommitDto {
  encounterId: string
  status: "COMMITTED"
}

export interface ScribeTranscriptDto {
  sessionId: string
  patientName: string
  sessionDate: string
  transcript: {
    raw: string
    cleaned: string
    segments: ScribeTranscriptSegment[]
    cleanedAt: string
    model: string
  } | null
  decisionTranscript: {
    raw: string
    cleaned: string
    segments: ScribeTranscriptSegment[]
    cleanedAt: string
    model: string
  } | null
}

/* ---------------------------- Supervision ---------------------------- */

export interface CashSummaryDto {
  shiftId: string
  businessDate: string
  status: "OPEN" | "CLOSED"
  queueVersion: number
  grossCollectedMinor: number
  cashCollectedMinor: number
  otherCollectedMinor: number
  reversalsMinor: number
  pettyExpenseMinor: number
  pettyInjectionMinor: number
  netCashMinor: number
  byMethod: { CASH: number; OTHER: number }
  expectedCashMinor: number | null
  actualCountedMinor: number | null
  differenceMinor: number | null
  result: "BALANCED" | "SURPLUS" | "DEFICIT" | null
  reconciliationPassed: boolean
  invariantFailures: string[]
  auditCoverage: {
    expectedAuditedEntities: number
    auditedEntities: number
    missing: number
  }
  reviewedByUserId: string | null
  reviewedAt: string | null
  reviewNote: string | null
}

export interface ShiftHistoryItemDto {
  shiftId: string
  businessDate: string
  status: "OPEN" | "CLOSED"
  expectedCashMinor: number | null
  actualCountedMinor: number | null
  differenceMinor: number | null
  result: "BALANCED" | "SURPLUS" | "DEFICIT" | null
  reviewedByUserId: string | null
  reviewedAt: string | null
  reviewNote: string | null
  closedAt: string | null
}

export interface UnsignedNotesDto {
  shiftId: string | null
  completedWithoutSigned: {
    queueEntryId: string
    patientId: string
    displayName: string
    status: string
    completedAt: string
    hasSignedEncounter: boolean
    isDeferred?: boolean
    deferredReason?: string | null
    deferredAt?: string | null
  }[]
  staleDrafts: {
    draftKind: "ENCOUNTER" | "SCRIBE"
    draftId: string
    patientId: string
    status: string
    createdAt: string
    ageHours: number
    stale: boolean
  }[]
  deferralCount?: number
}

export interface DiscountItemDto {
  invoiceId: string
  queueEntryId: string
  patientId: string
  standardFeeMinor: number
  finalFeeMinor: number
  discountMinor: number
  discountReason: string | null
  isComplimentary: boolean
  createdByUserId: string
  authorName: string
  authorRole: string
  createdAt: string
}

export interface SupervisionDiscountsDto {
  shiftId: string
  count: number
  totalDiscountMinor: number
  data: DiscountItemDto[]
}

export interface ExceptionsDto {
  shiftId: string | null
  businessDate: string | null
  completedWithoutInvoice: unknown[]
  unacknowledgedEmergencies: {
    queueEntryId: string
    patientId: string
    reasonCode: string
    flaggedAt: string
    flaggedByUserId: string
  }[]
  openingFloatDiscrepancyMinor: number
  openingCarryForwardMinor: number
  shiftVarianceMinor: number | null
  shiftResult: string | null
  forcedClose: boolean
}

export interface ShiftReadinessDto {
  shiftId: string
  canClose: boolean
  blockers: string[]
  queueVersion: number
  openEntries: { queueEntryId: string; status: string; position: number }[]
}

/* ---------------------------- Audit ---------------------------- */

export interface AuditEventDto {
  id: string
  action: string
  actorUserId: string
  actorRole: string
  entityType: string
  entityId: string
  requestId: string | null
  idempotencyKey: string | null
  reasonText: string | null
  beforeState: unknown
  afterState: unknown
  createdAt: string
}

/* ---------------------------- Envelopes ---------------------------- */

export interface CursorPage<T> {
  data: T[]
  nextCursor: string | null
}

/** Idempotent replays inject an extra `replayed: true` field — tolerated. */
export interface MaybeReplayed<T> {
  payload: T
  replayed: boolean
}
