import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * BE-503 envelope crypto (CONV-08).
 *
 * AES-256-GCM envelope encryption, Node standard `node:crypto` only:
 *   - KEK (key-encryption key): 32 bytes, base64 in `VAULT_KEK` env.
 *   - DEK (per-note data key): fresh random 32 bytes per note.
 *   - AAD bound to `${noteId}:${patientId}` (transplant-resistant: a row
 *     copied to another note/patient fails authentication on decrypt).
 *
 * Envelope layout:
 *   - content: AES-256-GCM(DEK, ivContent 12B, AAD, plaintext utf8)
 *     -> ciphertextB64 = base64(ciphertext || tag 16B), nonceB64 = base64(ivContent)
 *   - wrappedDekB64 = base64(ivWrap 12B || encDek 32B || tag 16B)
 *     where encDek = AES-256-GCM(KEK, ivWrap, AAD, dek)
 *   - kekId labels which KEK wrapped the DEK (Appendix B custody).
 *
 * Plaintext is NEVER logged here. Callers must not log inputs/outputs.
 */

export interface EncryptedNote {
  readonly ciphertextB64: string;
  readonly wrappedDekB64: string;
  readonly nonceB64: string;
  readonly kekId: string;
}

const GCM_TAG_LEN = 16;
const NONCE_LEN = 12;
const DEK_LEN = 32;

function loadKekBytes(kekB64?: string): Buffer {
  const raw = kekB64 ?? process.env.VAULT_KEK;
  if (raw === undefined || raw.trim().length === 0) {
    throw new Error('VAULT_KEK is not configured (32-byte base64 required)');
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(raw.trim(), 'base64');
  } catch {
    throw new Error('VAULT_KEK is not valid base64');
  }
  if (bytes.length !== 32) {
    throw new Error(`VAULT_KEK must decode to 32 bytes, got ${bytes.length}`);
  }
  return bytes;
}

export function getKekId(): string {
  const id = process.env.VAULT_KEK_ID;
  if (id !== undefined && id.trim().length > 0) return id.trim();
  return 'v1';
}

function aadFor(noteId: string, patientId: string): Buffer {
  return Buffer.from(`${noteId}:${patientId}`, 'utf8');
}

function encryptGcm(key: Buffer, iv: Buffer, aad: Buffer, plaintext: Buffer): { ciphertext: Buffer; tag: Buffer } {
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, tag };
}

function decryptGcm(
  key: Buffer,
  iv: Buffer,
  aad: Buffer,
  ciphertext: Buffer,
  tag: Buffer,
): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Encrypt `plaintext` for (`noteId`, `patientId`).
 * Generates a fresh random DEK per note; wraps it with the current KEK.
 */
export function encryptNote(
  noteId: string,
  patientId: string,
  plaintext: string,
  opts: { kekB64?: string; kekId?: string } = {},
): EncryptedNote {
  if (noteId.trim().length === 0) throw new Error('noteId is required');
  if (patientId.trim().length === 0) throw new Error('patientId is required');
  if (plaintext.length === 0) throw new Error('plaintext must not be empty');
  const kek = loadKekBytes(opts.kekB64);
  const kekId = opts.kekId ?? getKekId();
  const aad = aadFor(noteId, patientId);

  const dek = randomBytes(DEK_LEN);
  try {
    const ivContent = randomBytes(NONCE_LEN);
    const { ciphertext, tag } = encryptGcm(dek, ivContent, aad, Buffer.from(plaintext, 'utf8'));
    const ciphertextB64 = Buffer.concat([ciphertext, tag]).toString('base64');
    const nonceB64 = ivContent.toString('base64');

    const ivWrap = randomBytes(NONCE_LEN);
    const wrapped = encryptGcm(kek, ivWrap, aad, dek);
    const wrappedDekB64 = Buffer.concat([ivWrap, wrapped.ciphertext, wrapped.tag]).toString('base64');

    return { ciphertextB64, wrappedDekB64, nonceB64, kekId };
  } finally {
    dek.fill(0);
  }
}

/**
 * Decrypt an envelope back to plaintext (in memory, DOCTOR-only caller).
 * Throws on wrong KEK, transplanted (noteId, patientId), or tampered bytes.
 */
export function decryptNote(
  noteId: string,
  patientId: string,
  envelope: EncryptedNote,
  opts: { kekB64?: string } = {},
): string {
  const kek = loadKekBytes(opts.kekB64);
  const aad = aadFor(noteId, patientId);

  const wrapped = Buffer.from(envelope.wrappedDekB64, 'base64');
  if (wrapped.length !== NONCE_LEN + DEK_LEN + GCM_TAG_LEN) {
    throw new Error('wrappedDek has an invalid length');
  }
  const ivWrap = wrapped.subarray(0, NONCE_LEN);
  const encDek = wrapped.subarray(NONCE_LEN, NONCE_LEN + DEK_LEN);
  const wrapTag = wrapped.subarray(NONCE_LEN + DEK_LEN);
  const dek = decryptGcm(kek, ivWrap, aad, encDek, wrapTag);
  try {
    const ivContent = Buffer.from(envelope.nonceB64, 'base64');
    if (ivContent.length !== NONCE_LEN) throw new Error('nonce has an invalid length');
    const raw = Buffer.from(envelope.ciphertextB64, 'base64');
    if (raw.length < GCM_TAG_LEN + 1) throw new Error('ciphertext has an invalid length');
    const ct = raw.subarray(0, raw.length - GCM_TAG_LEN);
    const tag = raw.subarray(raw.length - GCM_TAG_LEN);
    const plain = decryptGcm(dek, ivContent, aad, ct, tag);
    return plain.toString('utf8');
  } finally {
    dek.fill(0);
  }
}

/**
 * Re-wrap an existing envelope's DEK with a new KEK (rotation, Appendix B).
 * Decrypts the DEK with `oldKekB64`, re-encrypts with `newKekB64`.
 * Content ciphertext + nonce are untouched (DEK unchanged, only wrapping changes).
 */
export function rotateKek(
  noteId: string,
  patientId: string,
  envelope: EncryptedNote,
  opts: { oldKekB64?: string; newKekB64: string; newKekId: string },
): EncryptedNote {
  const plaintextDekHolder = decryptDekOnly(noteId, patientId, envelope, opts.oldKekB64);
  try {
    const newKek = loadKekBytes(opts.newKekB64);
    const aad = aadFor(noteId, patientId);
    const ivWrap = randomBytes(NONCE_LEN);
    const wrapped = encryptGcm(newKek, ivWrap, aad, plaintextDekHolder);
    const wrappedDekB64 = Buffer.concat([ivWrap, wrapped.ciphertext, wrapped.tag]).toString('base64');
    return {
      ciphertextB64: envelope.ciphertextB64,
      wrappedDekB64,
      nonceB64: envelope.nonceB64,
      kekId: opts.newKekId,
    };
  } finally {
    plaintextDekHolder.fill(0);
  }
}

function decryptDekOnly(
  noteId: string,
  patientId: string,
  envelope: EncryptedNote,
  oldKekB64?: string,
): Buffer {
  const kek = loadKekBytes(oldKekB64);
  const aad = aadFor(noteId, patientId);
  const wrapped = Buffer.from(envelope.wrappedDekB64, 'base64');
  const ivWrap = wrapped.subarray(0, NONCE_LEN);
  const encDek = wrapped.subarray(NONCE_LEN, NONCE_LEN + DEK_LEN);
  const wrapTag = wrapped.subarray(NONCE_LEN + DEK_LEN);
  return decryptGcm(kek, ivWrap, aad, encDek, wrapTag);
}

/**
 * Shred helper: zero-fill caller-owned secret buffers in place.
 * DB shredding (null ciphertext/wrappedDek + shreddedAt tombstone) lives in
 * the vault service; this covers in-memory hygiene around it.
 */
export function shredNote(...buffers: Buffer[]): void {
  for (const b of buffers) {
    try {
      b.fill(0);
    } catch {
      /* ignore non-fillable */
    }
  }
}

/** SHA-256 hex helper for finalContentHash / diagnostics (no secrets). */
export function sha256Hex(canonical: string): string {
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
