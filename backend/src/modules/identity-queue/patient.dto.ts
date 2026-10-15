import { markSecretSafe, type SecretSafe } from '../../common/types/secretSafe.js';
import { last4 } from './patient.normalize.js';

/** Full non-clinical identity DTO (allowlisted, CONV-02). No clinical keys exist to leak. */
export interface PatientDto {
  readonly id: string;
  readonly fullName: string;
  readonly dateOfBirth: string;
  readonly phone: string | null;
  readonly nationalId: string | null;
  readonly guardianPhone: string | null;
  readonly emergencyContactName: string | null;
  readonly emergencyContactPhone: string | null;
  readonly emergencyContactRelation: string | null;
  readonly physicalAddress: string | null;
  readonly adminNotes: string | null;
  readonly registrationStatus: 'COMPLETE' | 'INCOMPLETE';
  readonly outstandingBalanceMinor: number;
  readonly lastVisitAt: string | null;
  readonly createdAt: string;
}

/** Minimized search candidate — excludes address + emergency contacts. Max 10 per search. */
export interface PatientSearchCandidateDto {
  readonly id: string;
  readonly fullName: string;
  readonly dateOfBirth: string;
  readonly phone: string | null;
  readonly phoneLast4: string | null;
  readonly nationalIdLast4: string | null;
  readonly lastVisitAt: string | null;
  readonly hasDebtAlert: boolean;
  readonly registrationStatus: 'COMPLETE' | 'INCOMPLETE';
}

export interface PatientDetailDto extends PatientDto {
  readonly pastVisitTimestamps: readonly string[];
}

interface PatientRowLike {
  readonly id: string;
  readonly fullName: string;
  readonly dateOfBirth: Date;
  readonly phone: string | null;
  readonly nationalId: string | null;
  readonly guardianPhone: string | null;
  readonly emergencyContactName: string | null;
  readonly emergencyContactPhone: string | null;
  readonly emergencyContactRelation: string | null;
  readonly physicalAddress: string | null;
  readonly adminNotes: string | null;
  readonly registrationStatus: 'COMPLETE' | 'INCOMPLETE';
  readonly outstandingBalanceMinor: number;
  readonly lastVisitAt: Date | null;
  readonly createdAt: Date;
}

interface SearchRowLike extends Pick<
  PatientRowLike,
  'id' | 'fullName' | 'dateOfBirth' | 'registrationStatus' | 'outstandingBalanceMinor' | 'lastVisitAt'
> {
  readonly phone?: string | null;
  readonly phoneNorm: string | null;
  readonly nationalIdNorm: string | null;
}

/** Allowlist-first mapper: only picked keys leave the server. */
export function toSecretPatientDto(row: PatientRowLike): SecretSafe<PatientDto> {
  return markSecretSafe<PatientDto>({
    id: row.id,
    fullName: row.fullName,
    dateOfBirth: row.dateOfBirth.toISOString(),
    phone: row.phone,
    nationalId: row.nationalId,
    guardianPhone: row.guardianPhone,
    emergencyContactName: row.emergencyContactName,
    emergencyContactPhone: row.emergencyContactPhone,
    emergencyContactRelation: row.emergencyContactRelation,
    physicalAddress: row.physicalAddress,
    adminNotes: row.adminNotes,
    registrationStatus: row.registrationStatus,
    outstandingBalanceMinor: row.outstandingBalanceMinor,
    lastVisitAt: row.lastVisitAt === null ? null : row.lastVisitAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  });
}

/** Minimized search mapper: full phone + masked last-4 + debt flag, no address/emergency. */
export function toSecretPatientSearchDto(row: SearchRowLike): SecretSafe<PatientSearchCandidateDto> {
  return markSecretSafe<PatientSearchCandidateDto>({
    id: row.id,
    fullName: row.fullName,
    dateOfBirth: row.dateOfBirth.toISOString(),
    phone: row.phone ?? (row.phoneNorm ? row.phoneNorm : null),
    phoneLast4: last4(row.phoneNorm),
    nationalIdLast4: last4(row.nationalIdNorm),
    lastVisitAt: row.lastVisitAt === null ? null : row.lastVisitAt.toISOString(),
    hasDebtAlert: row.outstandingBalanceMinor > 0,
    registrationStatus: row.registrationStatus,
  });
}

export function toSecretPatientDetailDto(
  row: PatientRowLike,
  pastVisitTimestamps: readonly string[],
): SecretSafe<PatientDetailDto> {
  const base = toSecretPatientDto(row);
  return markSecretSafe<PatientDetailDto>({ ...base, pastVisitTimestamps });
}
