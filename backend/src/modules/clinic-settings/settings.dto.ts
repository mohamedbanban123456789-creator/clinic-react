import { markSecretSafe, type SecretSafe } from '../../common/types/secretSafe.js';

export interface PublicSettings {
  readonly standardFeeMinor: number;
  readonly currency: string;
  readonly avgConsultDurationMin: number;
  readonly openingFloatMinor: number;
  readonly secretaryMaxDiscountMinor: number;
  readonly secretaryMaxDiscountPct: number;
  readonly audioRetentionDays: number;
}

export interface SettingsRow {
  readonly standardFeeMinor: number;
  readonly currency: string;
  readonly avgConsultDurationMin: number;
  readonly openingFloatMinor: number;
  readonly secretaryMaxDiscountMinor: number;
  readonly secretaryMaxDiscountPct: number;
  readonly audioRetentionDays: number;
}

/** Allowlist-first mapper (CONV-02): only picked keys leave the server. */
export function toSecretSettingsDto(row: SettingsRow): SecretSafe<PublicSettings> {
  return markSecretSafe<PublicSettings>({
    standardFeeMinor: row.standardFeeMinor,
    currency: row.currency,
    avgConsultDurationMin: row.avgConsultDurationMin,
    openingFloatMinor: row.openingFloatMinor,
    secretaryMaxDiscountMinor: row.secretaryMaxDiscountMinor,
    secretaryMaxDiscountPct: row.secretaryMaxDiscountPct,
    audioRetentionDays: row.audioRetentionDays,
  });
}
