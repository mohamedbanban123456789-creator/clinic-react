import { createHash } from 'node:crypto';

/**
 * BE-201 normalization helpers (RPS-2).
 * - Names: strip diacritics/symbols, collapse spaces, lowercase for compare.
 * - Digits: map Arabic-Indic + Persian digits to 0-9, strip non-digits.
 */

const ARABIC_INDIC: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

function mapLocaleDigits(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const mapped = ARABIC_INDIC[ch];
    out += mapped !== undefined ? mapped : ch;
  }
  return out;
}

/**
 * Bidirectional Arabic character normalization:
 * - Strip tashkeel / harakat (fatha, damma, kasra, tanwin, sukun, shadda, tatweel/kashida, dagger alef, etc.)
 * - All alef forms (أ/إ/آ/ٱ) -> ا
 * - ة and ه -> ه
 * - ى and ي -> ي
 */
export function normalizeArabic(text: string): string {
  return text
    .replace(/[\u064B-\u065F\u0670\u0640\u0610-\u061A\u06D6-\u06ED]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');
}

/** Normalize free-text names for duplicate comparison. Display value keeps trimmed original. */
export function normalizeName(raw: string): string {
  const arabicNorm = normalizeArabic(raw);
  const folded = arabicNorm
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const kept = folded.replace(/[^a-z0-9\u0600-\u06FF ]/g, ' ');
  return kept.replace(/\s+/g, ' ').trim();
}

/** Normalize phone / nationalId / guardian phone to digits-only. Empty -> null. */
export function normalizeDigits(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const mapped = mapLocaleDigits(raw);
  const digits = mapped.replace(/\D/g, '');
  return digits.length === 0 ? null : digits;
}

/** Last-4 masking for search candidates. Short/null -> null. */
export function last4(digits: string | null | undefined): string | null {
  if (digits === null || digits === undefined || digits.length < 4) return null;
  return digits.slice(-4);
}

/** sha256 hex (audit: hashed query + count, never raw query text). */
export function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}
