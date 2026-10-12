import { markSecretSafe, type SecretSafe } from '../../common/types/secretSafe.js';

/**
 * BE-304 / BE-305 shift + petty DTOs (CONV-02 allowlist-first).
 *
 * BLIND COUNT (DB-10 / CONV-06 / API-07) — the load-bearing rule of this sprint.
 * While a shift is OPEN the server MUST NOT reveal `expectedCashMinor` (nor
 * `differenceMinor` / `result`) to anyone: an open drawer that can read the
 * expected total can simply count to it, which defeats the whole control. The
 * rule is enforced INSIDE the mappers (`toSecretShiftViewDto` /
 * `toSecretShiftSummaryDto`) via the `isOpen` flag, so no call site can leak it
 * by forgetting a branch — the DTO layer hard-forces the fields to `null`.
 *
 * Shift/PettyExpense hold NO clinical columns (DB-02/DB-18), so there is nothing
 * sensitive to accidentally expose. Every response is still branded
 * `SecretSafe<T>` via an explicit `toSecret*` mapper; the global sanitizer
 * fail-closes any unbranded SECRETARY 2xx payload.
 */

export type PettyDirectionDto = 'EXPENSE' | 'INJECTION';
export type ShiftStatusDto = 'OPEN' | 'CLOSED';
export type ShiftResultDto = 'BALANCED' | 'SURPLUS' | 'DEFICIT';

export interface PettyExpenseDto {
  readonly pettyId: string;
  readonly shiftId: string;
  readonly direction: PettyDirectionDto;
  readonly amountMinor: number;
  readonly category: string;
  readonly description: string;
  readonly receiptRef: string | null;
  readonly createdByUserId: string;
  readonly createdAt: string;
}

export interface PettyListDto {
  readonly shiftId: string;
  readonly data: readonly PettyExpenseDto[];
  readonly nextCursor: string | null;
}

/** BE-305 POST /shifts/open success envelope. */
export interface ShiftOpenDto {
  readonly shiftId: string;
  readonly businessDate: string;
  readonly status: ShiftStatusDto;
  readonly openingDiscrepancyMinor: number;
  readonly queueVersion: number;
}

/**
 * Blind-aware shift view (`GET /shifts/current`, `GET /shifts/:id`).
 * `expectedCashMinor` / `differenceMinor` / `result` are null while OPEN.
 */
export interface ShiftViewDto {
  readonly shiftId: string;
  readonly businessDate: string;
  readonly status: ShiftStatusDto;
  readonly openingFloatMinor: number;
  readonly openingCarryForwardMinor: number;
  readonly openingDiscrepancyMinor: number;
  readonly queueVersion: number;
  readonly expectedCashMinor: number | null;
  readonly actualCountedMinor: number | null;
  readonly differenceMinor: number | null;
  readonly result: ShiftResultDto | null;
  readonly integrityCheckPassed: boolean | null;
  readonly openedByUserId: string;
  readonly closedAt: string | null;
  readonly reviewedByUserId: string | null;
  readonly reviewedAt: string | null;
  readonly reviewNote: string | null;
}

/** BE-305 POST /shifts/:id/close success envelope (expected revealed ONLY here). */
export interface ShiftCloseDto {
  readonly shiftId: string;
  readonly status: ShiftStatusDto;
  readonly expectedCashMinor: number;
  readonly actualCountedMinor: number;
  readonly differenceMinor: number;
  readonly result: ShiftResultDto;
  readonly integrityCheckPassed: boolean;
  readonly queueVersion: number;
}

export interface MethodBreakdownDto {
  readonly CASH: number;
  readonly OTHER: number;
}

/**
 * BE-305 GET /shifts/:id/summary. Pre-close: operational counts only, every cash
 * figure null. Post-close: full financial breakdown.
 */
export interface ShiftSummaryDto {
  readonly shiftId: string;
  readonly businessDate: string;
  readonly status: ShiftStatusDto;
  readonly queueVersion: number;
  readonly totalServed: number;
  readonly grossCollectedMinor: number | null;
  readonly cashCollectedMinor: number | null;
  readonly byMethod: MethodBreakdownDto | null;
  readonly reversalsMinor: number | null;
  readonly pettyTotalMinor: number | null;
  readonly pettyExpenseMinor: number | null;
  readonly pettyInjectionMinor: number | null;
  readonly discountTotalMinor: number | null;
  readonly discountCount: number | null;
  readonly writeOffTotalMinor: number | null;
  readonly complimentaryCount: number | null;
  readonly newDebtTotalMinor: number | null;
  readonly expectedCashMinor: number | null;
  readonly actualCountedMinor: number | null;
  readonly differenceMinor: number | null;
  readonly result: ShiftResultDto | null;
  readonly integrityCheckPassed: boolean | null;
  readonly reviewedByUserId: string | null;
  readonly reviewedAt: string | null;
  readonly reviewNote: string | null;
}

/** BE-305 POST /supervision/shifts/:id/ack [DOCTOR]. */
export interface ShiftAckDto {
  readonly shiftId: string;
  readonly status: ShiftStatusDto;
  readonly differenceMinor: number | null;
  readonly result: ShiftResultDto | null;
  readonly reviewedByUserId: string;
  readonly reviewedAt: string;
  readonly reviewNote: string | null;
}

/** BE-306 POST /supervision/integrity-check [DOCTOR]. */
export interface IntegrityCheckDto {
  readonly shiftId: string;
  readonly passed: boolean;
  readonly failures: readonly string[];
}

// ---------------------------------------------------------------------------
// Mappers — allowlist-first, blind-aware. The blind rule lives HERE.
// ---------------------------------------------------------------------------

/** Allowlist-first mapper: only picked keys leave the server. */
export function toSecretPettyExpenseDto(row: PettyExpenseRow): SecretSafe<PettyExpenseDto> {
  return markSecretSafe<PettyExpenseDto>({
    pettyId: row.id,
    shiftId: row.shiftId,
    direction: row.direction,
    amountMinor: row.amountMinor,
    category: row.category,
    description: row.description,
    receiptRef: row.receiptRef,
    createdByUserId: row.actorUserId,
    createdAt: row.createdAt.toISOString(),
  });
}

/** Allowlist list envelope — branded whole so the SECRETARY sanitizer passes. */
export function toSecretPettyListDto(
  shiftId: string,
  rows: readonly SecretSafe<PettyExpenseDto>[],
  nextCursor: string | null,
): SecretSafe<PettyListDto> {
  return markSecretSafe<PettyListDto>({ shiftId, data: rows, nextCursor });
}

export interface ShiftRow {
  readonly id: string;
  readonly businessDate: Date;
  readonly status: ShiftStatusDto;
  readonly openingFloatMinor: number;
  readonly openingCarryForwardMinor: number;
  readonly openingDiscrepancyMinor: number;
  readonly queueVersion: number;
  readonly expectedCashMinor: number | null;
  readonly actualCountedMinor: number | null;
  readonly differenceMinor: number | null;
  readonly result: ShiftResultDto | null;
  readonly integrityCheckPassed: boolean | null;
  readonly openedByUserId: string;
  readonly closedAt: Date | null;
  readonly reviewedByUserId: string | null;
  readonly reviewedAt: Date | null;
  readonly reviewNote: string | null;
}

/**
 * CONV-06 / DB-10 blind count — THE tripwire-guarded mapper.
 *
 * `isOpen === true` hard-forces `expectedCashMinor`, `actualCountedMinor`,
 * `differenceMinor` and `result` to `null` regardless of what the row holds, so
 * an OPEN drawer can never be anchored on the expected total. There is no code
 * path that produces a non-null expected value for an OPEN shift.
 */
export function toSecretShiftViewDto(row: ShiftRow, isOpen: boolean): SecretSafe<ShiftViewDto> {
  const blind: boolean = isOpen;
  return markSecretSafe<ShiftViewDto>({
    shiftId: row.id,
    businessDate: row.businessDate.toISOString(),
    status: row.status,
    openingFloatMinor: row.openingFloatMinor,
    openingCarryForwardMinor: row.openingCarryForwardMinor,
    openingDiscrepancyMinor: row.openingDiscrepancyMinor,
    queueVersion: row.queueVersion,
    expectedCashMinor: blind ? null : row.expectedCashMinor,
    actualCountedMinor: blind ? null : row.actualCountedMinor,
    differenceMinor: blind ? null : row.differenceMinor,
    result: blind ? null : row.result,
    integrityCheckPassed: blind ? null : row.integrityCheckPassed,
    openedByUserId: row.openedByUserId,
    closedAt: row.closedAt === null ? null : row.closedAt.toISOString(),
    reviewedByUserId: blind ? null : row.reviewedByUserId,
    reviewedAt: blind ? null : (row.reviewedAt === null ? null : row.reviewedAt.toISOString()),
    reviewNote: blind ? null : row.reviewNote,
  });
}

/**
 * BE-305 close envelope — the ONLY sanctioned place expected cash is revealed.
 * `actualCountedMinor` is already persisted by the time this is constructed
 * (DB-10 two-phase reveal), so revealing here cannot influence the count.
 */
export function toSecretShiftCloseDto(params: {
  shiftId: string;
  expectedCashMinor: number;
  actualCountedMinor: number;
  differenceMinor: number;
  result: ShiftResultDto;
  integrityCheckPassed: boolean;
  queueVersion: number;
}): SecretSafe<ShiftCloseDto> {
  return markSecretSafe<ShiftCloseDto>({
    shiftId: params.shiftId,
    status: 'CLOSED',
    expectedCashMinor: params.expectedCashMinor,
    actualCountedMinor: params.actualCountedMinor,
    differenceMinor: params.differenceMinor,
    result: params.result,
    integrityCheckPassed: params.integrityCheckPassed,
    queueVersion: params.queueVersion,
  });
}

export interface ShiftSummaryInput {
  readonly shift: ShiftRow;
  readonly totalServed: number;
  readonly grossCollectedMinor: number;
  readonly cashCollectedMinor: number;
  readonly otherCollectedMinor: number;
  readonly reversalsMinor: number;
  readonly pettyExpenseMinor: number;
  readonly pettyInjectionMinor: number;
  readonly discountTotalMinor: number;
  readonly discountCount: number;
  readonly writeOffTotalMinor: number;
  readonly complimentaryCount: number;
  readonly newDebtTotalMinor: number;
}

/**
 * BE-305 summary mapper. OPEN -> operational counts only, cash figures null.
 * CLOSED -> full financial breakdown. Blind rule enforced here as above.
 */
export function toSecretShiftSummaryDto(input: ShiftSummaryInput): SecretSafe<ShiftSummaryDto> {
  const { shift } = input;
  const blind = shift.status === 'OPEN';
  const pettyTotalMinor = input.pettyExpenseMinor + input.pettyInjectionMinor;

  return markSecretSafe<ShiftSummaryDto>({
    shiftId: shift.id,
    businessDate: shift.businessDate.toISOString(),
    status: shift.status,
    queueVersion: shift.queueVersion,
    totalServed: input.totalServed,
    grossCollectedMinor: blind ? null : input.grossCollectedMinor,
    cashCollectedMinor: blind ? null : input.cashCollectedMinor,
    byMethod: blind ? null : { CASH: input.cashCollectedMinor, OTHER: input.otherCollectedMinor },
    reversalsMinor: blind ? null : input.reversalsMinor,
    pettyTotalMinor: blind ? null : pettyTotalMinor,
    pettyExpenseMinor: blind ? null : input.pettyExpenseMinor,
    pettyInjectionMinor: blind ? null : input.pettyInjectionMinor,
    discountTotalMinor: blind ? null : input.discountTotalMinor,
    discountCount: blind ? null : input.discountCount,
    writeOffTotalMinor: blind ? null : input.writeOffTotalMinor,
    complimentaryCount: blind ? null : input.complimentaryCount,
    newDebtTotalMinor: blind ? null : input.newDebtTotalMinor,
    expectedCashMinor: blind ? null : shift.expectedCashMinor,
    actualCountedMinor: blind ? null : shift.actualCountedMinor,
    differenceMinor: blind ? null : shift.differenceMinor,
    result: blind ? null : shift.result,
    integrityCheckPassed: blind ? null : shift.integrityCheckPassed,
    reviewedByUserId: blind ? null : shift.reviewedByUserId,
    reviewedAt: blind ? null : (shift.reviewedAt === null ? null : shift.reviewedAt.toISOString()),
    reviewNote: blind ? null : shift.reviewNote,
  });
}

/** BE-305 supervision ack [DOCTOR] — doctor review is post-close, figures visible. */
export function toSecretShiftAckDto(params: {
  shiftId: string;
  differenceMinor: number | null;
  result: ShiftResultDto | null;
  reviewedByUserId: string;
  reviewedAt: Date;
  reviewNote: string | null;
}): SecretSafe<ShiftAckDto> {
  return markSecretSafe<ShiftAckDto>({
    shiftId: params.shiftId,
    status: 'CLOSED',
    differenceMinor: params.differenceMinor,
    result: params.result,
    reviewedByUserId: params.reviewedByUserId,
    reviewedAt: params.reviewedAt.toISOString(),
    reviewNote: params.reviewNote,
  });
}

/** BE-306 integrity probe [DOCTOR]. */
export function toSecretIntegrityCheckDto(
  shiftId: string,
  passed: boolean,
  failures: readonly string[],
): SecretSafe<IntegrityCheckDto> {
  return markSecretSafe<IntegrityCheckDto>({ shiftId, passed, failures });
}


/** BE-305 POST /shifts/open — expected is never part of the open envelope. */
export function toSecretShiftOpenDto(row: {
  id: string;
  businessDate: Date;
  openingDiscrepancyMinor: number;
  queueVersion: number;
}): SecretSafe<ShiftOpenDto> {
  return markSecretSafe<ShiftOpenDto>({
    shiftId: row.id,
    businessDate: row.businessDate.toISOString(),
    status: 'OPEN',
    openingDiscrepancyMinor: row.openingDiscrepancyMinor,
    queueVersion: row.queueVersion,
  });
}

/** DB row shape consumed by the petty mapper (operational projection only). */
export interface PettyExpenseRow {
  readonly id: string;
  readonly shiftId: string;
  readonly direction: PettyDirectionDto;
  readonly amountMinor: number;
  readonly category: string;
  readonly description: string;
  readonly receiptRef: string | null;
  readonly actorUserId: string;
  readonly createdAt: Date;
}
