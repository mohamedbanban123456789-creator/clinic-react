import type { PrismaClient } from '@prisma/client';
import { logger } from '../common/utils/logger.js';
import { prisma } from '../common/prisma.js';
import { loadEnv } from './env.js';
import { hashPassword } from '../common/utils/hash.js';

export interface SeedResult {
  readonly id: string;
  readonly identifier: string;
  readonly created: boolean;
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return (err as { code?: unknown }).code === 'P2002';
}

/**
 * BE-104 idempotent doctor bootstrap (RPS-2).
 *
 * - If ANY active DOCTOR exists, do nothing (never duplicate on repeat boots,
 *   even when the seed identifier rotated).
 * - Otherwise create the primary DOCTOR from SEED_DOCTOR_IDENTIFIER /
 *   SEED_DOCTOR_PASSWORD with role DOCTOR, isActive true,
 *   passwordMustChange true (forces rotation on first login), Argon2id hash.
 * - Race-safe: Prisma P2002 on identifier resolves to the existing row and
 *   returns created:false instead of throwing.
 */
export async function ensureSeededDoctor(db: PrismaClient = prisma): Promise<SeedResult> {
  const env = loadEnv();
  const identifier = env.SEED_DOCTOR_IDENTIFIER.trim();
  const doctorName = env.SEED_DOCTOR_NAME?.trim() || 'د. أحمد سامي';

  const activeDoctor = await db.user.findFirst({
    where: { role: 'DOCTOR', isActive: true },
    select: { id: true, identifier: true, name: true },
  });
  if (activeDoctor !== null) {
    if (activeDoctor.name === 'Doctor' || /^\?+$/.test(activeDoctor.name)) {
      await db.user.update({
        where: { id: activeDoctor.id },
        data: { name: doctorName },
      });
    }
    return { id: activeDoctor.id, identifier: activeDoctor.identifier, created: false };
  }

  const passwordHash = await hashPassword(env.SEED_DOCTOR_PASSWORD);
  try {
    const created = await db.user.create({
      data: {
        name: doctorName,
        identifier,
        passwordHash,
        role: 'DOCTOR',
        isActive: true,
        passwordMustChange: true,
        createdByUserId: null,
      },
      select: { id: true, identifier: true },
    });
    logger.info('seed.doctor.created', { identifier });
    return { id: created.id, identifier: created.identifier, created: true };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const existing = await db.user.findUnique({
        where: { identifier },
        select: { id: true, identifier: true },
      });
      if (existing !== null) {
        logger.info('seed.doctor.exists', { identifier });
        return { id: existing.id, identifier: existing.identifier, created: false };
      }
    }
    throw err;
  }
}

export interface SettingsSeedResult {
  readonly created: boolean;
}

/**
 * Startup ClinicSettings seed (feedback: "startup settings seed from env
 * defaults"). Idempotent: creates the singleton row from env defaults ONLY
 * when it does not exist; existing operator-tuned values are never overwritten.
 */
export async function ensureSeededClinicSettings(db: PrismaClient = prisma): Promise<SettingsSeedResult> {
  const env = loadEnv();
  const existing = await db.clinicSettings.findUnique({ where: { id: 'singleton' }, select: { id: true } });
  if (existing !== null) return { created: false };
  try {
    await db.clinicSettings.create({
      data: {
        id: 'singleton',
        standardFeeMinor: env.CLINIC_DEFAULT_FEE_MINOR,
        currency: env.CLINIC_CURRENCY,
        avgConsultDurationMin: env.CLINIC_AVG_CONSULT_MIN,
        openingFloatMinor: 0,
        secretaryMaxDiscountMinor: env.CLINIC_SECRETARY_MAX_DISCOUNT_MINOR,
        secretaryMaxDiscountPct: env.CLINIC_SECRETARY_MAX_DISCOUNT_PCT,
        audioRetentionDays: env.AUDIO_RETENTION_DAYS,
      },
    });
    logger.info('seed.clinicSettings.created', {
      standardFeeMinor: env.CLINIC_DEFAULT_FEE_MINOR,
      audioRetentionDays: env.AUDIO_RETENTION_DAYS,
    });
    return { created: true };
  } catch (err) {
    if (isUniqueViolation(err)) return { created: false };
    throw err;
  }
}
