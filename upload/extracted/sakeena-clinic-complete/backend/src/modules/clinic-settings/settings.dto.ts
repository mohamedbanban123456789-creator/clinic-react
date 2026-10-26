import { markSecretSafe, type SecretSafe } from '../../common/types/secretSafe.js';

export interface PublicSettings {
  readonly standardFeeMinor: number;
  readonly currency: string;
  readonly avgConsultDurationMin: number;
  readonly openingFloatMinor: number;
  readonly audioRetentionDays: number;
}

export interface SettingsRow {
  readonly standardFeeMinor: number;
  readonly currency: string;
  readonly avgConsultDurationMin: number;
  readonly openingFloatMinor: number;
  readonly secretaryMaxDiscountMinor?: number | null;
  readonly secretaryMaxDiscountPct?: number | null;
  readonly audioRetentionDays: number;
}

/** Allowlist-first mapper (CONV-02): only picked keys leave the server. */
export function toSecretSettingsDto(row: SettingsRow): SecretSafe<PublicSettings> {
  return markSecretSafe<PublicSettings>({
    standardFeeMinor: row.standardFeeMinor,
    currency: row.currency,
    avgConsultDurationMin: row.avgConsultDurationMin,
    openingFloatMinor: row.openingFloatMinor,
    audioRetentionDays: row.audioRetentionDays,
  });
}
