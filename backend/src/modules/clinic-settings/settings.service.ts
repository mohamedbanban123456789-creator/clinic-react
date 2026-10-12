import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { loadEnv } from '../../config/env.js';
import { toSecretSettingsDto, type PublicSettings, type SettingsRow } from './settings.dto.js';
import type { SecretSafe } from '../../common/types/secretSafe.js';
import type { UpdateSettingsInput } from './settings.validators.js';

/** Shared env fallback used by GET/PUT + the startup seed. */
function envFallbackRow(): SettingsRow {
  const env = loadEnv();
  return {
    standardFeeMinor: env.CLINIC_DEFAULT_FEE_MINOR,
    currency: env.CLINIC_CURRENCY,
    avgConsultDurationMin: env.CLINIC_AVG_CONSULT_MIN,
    openingFloatMinor: 0,
    secretaryMaxDiscountMinor: env.CLINIC_SECRETARY_MAX_DISCOUNT_MINOR,
    secretaryMaxDiscountPct: env.CLINIC_SECRETARY_MAX_DISCOUNT_PCT,
    audioRetentionDays: env.AUDIO_RETENTION_DAYS,
  };
}

/**
 * BE-101 singleton configuration lookup.
 * Prefers the ClinicSettings row; falls back to env defaults so
 * GET /api/v1/settings works before seeding (BE-104 seeds the row).
 */
export async function getPublicSettings(db: PrismaClient = prisma): Promise<SecretSafe<PublicSettings>> {
  const fallback = envFallbackRow();
  try {
    const row = await db.clinicSettings.findUnique({ where: { id: 'singleton' } });
    if (row === null) return toSecretSettingsDto(fallback);
    return toSecretSettingsDto({
      standardFeeMinor: row.standardFeeMinor,
      currency: row.currency,
      avgConsultDurationMin: row.avgConsultDurationMin,
      openingFloatMinor: row.openingFloatMinor,
      secretaryMaxDiscountMinor: row.secretaryMaxDiscountMinor,
      secretaryMaxDiscountPct: row.secretaryMaxDiscountPct,
      audioRetentionDays: row.audioRetentionDays,
    });
  } catch {
    return toSecretSettingsDto(fallback);
  }
}

/**
 * PUT /api/v1/settings [DOCTOR] — upserts the singleton ClinicSettings row.
 * Partial semantics: provided fields overwrite the stored values; omitted
 * fields are preserved. The merge base is the PERSISTED row — never the env
 * fallback — so a transient read failure cannot silently clobber tuned fee/
 * floor values with bootstrap defaults (it fails the request instead).
 */
export async function updatePublicSettings(
  input: UpdateSettingsInput,
  db: PrismaClient = prisma,
): Promise<SecretSafe<PublicSettings>> {
  const existing = await db.clinicSettings.findUnique({ where: { id: 'singleton' } });
  const base: SettingsRow =
    existing === null
      ? envFallbackRow()
      : {
          standardFeeMinor: existing.standardFeeMinor,
          currency: existing.currency,
          avgConsultDurationMin: existing.avgConsultDurationMin,
          openingFloatMinor: existing.openingFloatMinor,
          secretaryMaxDiscountMinor: existing.secretaryMaxDiscountMinor,
          secretaryMaxDiscountPct: existing.secretaryMaxDiscountPct,
          audioRetentionDays: existing.audioRetentionDays,
        };
  const merged: SettingsRow = {
    standardFeeMinor: input.standardFeeMinor ?? base.standardFeeMinor,
    currency: input.currency ?? base.currency,
    avgConsultDurationMin: input.avgConsultDurationMin ?? base.avgConsultDurationMin,
    openingFloatMinor: input.openingFloatMinor ?? base.openingFloatMinor,
    secretaryMaxDiscountMinor: input.secretaryMaxDiscountMinor ?? base.secretaryMaxDiscountMinor,
    secretaryMaxDiscountPct: input.secretaryMaxDiscountPct ?? base.secretaryMaxDiscountPct,
    audioRetentionDays: input.audioRetentionDays ?? base.audioRetentionDays,
  };
  const row = await db.clinicSettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', ...merged },
    update: { ...merged },
  });
  return toSecretSettingsDto({
    standardFeeMinor: row.standardFeeMinor,
    currency: row.currency,
    avgConsultDurationMin: row.avgConsultDurationMin,
    openingFloatMinor: row.openingFloatMinor,
    secretaryMaxDiscountMinor: row.secretaryMaxDiscountMinor,
    secretaryMaxDiscountPct: row.secretaryMaxDiscountPct,
    audioRetentionDays: row.audioRetentionDays,
  });
}
