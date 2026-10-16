import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z
  .object({
    DATABASE_URL: z.string().min(1).transform((url) => {
      let finalUrl = url;
      if (!finalUrl.includes('client_encoding')) {
        const sep = finalUrl.includes('?') ? '&' : '?';
        finalUrl = `${finalUrl}${sep}client_encoding=utf8`;
      }
      process.env.DATABASE_URL = finalUrl;
      return finalUrl;
    }),
    JWT_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL: z.string().default('7d'),
    PORT: z.coerce.number().int().positive().default(4000),
    CORS_ORIGIN: z.string().min(1).default('http://localhost:3000'),
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    PASSWORD_HASH_COST: z.coerce.number().int().min(2).max(6).default(3),
    REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(120).default(10),
    CLINIC_DEFAULT_FEE_MINOR: z.coerce.number().int().nonnegative().default(50000),
    CLINIC_AVG_CONSULT_MIN: z.coerce.number().int().positive().default(20),
    CLINIC_CURRENCY: z.string().min(1).default('USD'),
    CLINIC_SECRETARY_MAX_DISCOUNT_MINOR: z.coerce.number().int().nonnegative().default(5000),
    CLINIC_SECRETARY_MAX_DISCOUNT_PCT: z.coerce.number().int().min(0).max(100).default(10),
    SHIFT_SYSTEM_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    AUDIO_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
    SEED_DOCTOR_IDENTIFIER: z.string().min(1).default('doctor'),
    SEED_DOCTOR_PASSWORD: z.string().min(8).default('ChangeMe123!'),
    SEED_DOCTOR_NAME: z.string().trim().min(1).default('د. أحمد سامي'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_DB_ROLE: z.string().default('clinic_app'),
    MIGRATION_DB_ROLE: z.string().default('clinic_owner'),
    // BE-503 vault KEK: 32-byte base64 (44 chars). Optional here so existing
    // deployments/tests without a vault still boot; vault.ts enforces at use.
    VAULT_KEK: z.string().min(1).optional(),
    VAULT_KEK_ID: z.string().min(1).default('v1'),
    // Sprint 6 AI scribe (Gemini): API key optional at boot so CI/tests boot
    // without a live paid key; gemini.provider.ts enforces at use with
    // AppError('GEMINI_KEY_MISSING'). Model defaults to gemini-3.5-flash-lite.
    GEMINI_API_KEY: z.string().trim().min(1).optional(),
    GEMINI_MODEL: z.string().trim().min(1).default('gemini-3.5-flash-lite'),
    // Scribe provider switch: 'groq' (Whisper STT + Qwen chat, default) or
    // 'gemini' (legacy direct-audio path — kept, disabled by default).
    SCRIBE_PROVIDER: z.enum(['groq', 'gemini']).default('groq'),
    GROQ_API_KEY: z.string().trim().min(1).optional(),
    GROQ_STT_MODEL: z.string().trim().min(1).default('whisper-large-v3'),
    GROQ_CHAT_MODEL: z.string().trim().min(1).default('qwen/qwen3.8-27b'),
    GROQ_MAX_TOKENS: z.coerce.number().int().positive().default(4096),
    GROQ_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  })
  .refine((e) => e.JWT_SECRET !== e.JWT_REFRESH_SECRET, {
    message: 'JWT_SECRET and JWT_REFRESH_SECRET must differ',
    path: ['JWT_REFRESH_SECRET'],
  })
  // Deployment hardening: production must never boot with transport security off
  // or the well-known bootstrap credential (BE-AUD-018).
  .refine((e) => e.NODE_ENV !== 'production' || e.COOKIE_SECURE, {
    message: 'COOKIE_SECURE must be "true" when NODE_ENV=production',
    path: ['COOKIE_SECURE'],
  })
  .refine((e) => e.NODE_ENV !== 'production' || e.SEED_DOCTOR_PASSWORD !== 'ChangeMe123!', {
    message: 'SEED_DOCTOR_PASSWORD must be overridden when NODE_ENV=production',
    path: ['SEED_DOCTOR_PASSWORD'],
  });

export type AppEnv = z.infer<typeof EnvSchema>;

let cached: AppEnv | undefined;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  if (cached !== undefined) return cached;
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${detail}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test-only reset for the cached env. */
export function resetEnvCache(): void {
  cached = undefined;
}
