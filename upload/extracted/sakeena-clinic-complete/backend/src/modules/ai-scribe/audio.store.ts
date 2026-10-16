import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Sprint 6 AI Scribe — local audio file store (encrypted at rest).
 *
 * Consultation + dictation bytes are persisted under `data/scribe-audio/`
 * (gitignored, never committed) so `purge-audio` / the retention worker can
 * delete bytes while the committed Encounter/Medication rows are preserved.
 * Paths are derived from the session id + cycle label only (no patient data
 * in filenames).
 *
 * AT-REST ENCRYPTION (BE-603): audio is encrypted with AES-256-GCM before it
 * ever touches disk, using the vault KEK (`VAULT_KEK`, 32-byte base64) as the
 * content key. Each file gets a fresh random 12-byte IV; the on-disk layout is
 * `IV(12) || TAG(16) || CIPHERTEXT`. `readScribeAudio` decrypts transparently
 * for Gemini ingestion. Plaintext audio is never written to disk or logged.
 */

const BASE_DIR = path.join(process.cwd(), 'data', 'scribe-audio');

const GCM_TAG_LEN = 16;
const NONCE_LEN = 12;

/** Base dir override (test isolation); defaults to <cwd>/data/scribe-audio. */
export function scribeAudioDir(): string {
  const override = process.env.SCRIBE_AUDIO_DIR;
  return override !== undefined && override.trim().length > 0 ? path.resolve(override.trim()) : BASE_DIR;
}

/** Load the 32-byte KEK from VAULT_KEK (base64). Throws if missing/invalid. */
function loadKekBytes(): Buffer {
  const raw = process.env.VAULT_KEK;
  if (raw === undefined || raw.trim().length === 0) {
    throw new Error('VAULT_KEK is not configured (32-byte base64 required) for scribe audio encryption');
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

function encryptAudio(plaintext: Buffer): Buffer {
  const key = loadKekBytes();
  const iv = randomBytes(NONCE_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

function decryptAudio(envelope: Buffer): Buffer {
  const key = loadKekBytes();
  if (envelope.length < NONCE_LEN + GCM_TAG_LEN) {
    throw new Error('encrypted scribe audio is truncated');
  }
  const iv = envelope.subarray(0, NONCE_LEN);
  const tag = envelope.subarray(NONCE_LEN, NONCE_LEN + GCM_TAG_LEN);
  const ciphertext = envelope.subarray(NONCE_LEN + GCM_TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function extensionForMime(mimeType: string): string {
  const t = mimeType.toLowerCase();
  if (t.includes('mp3') || t.includes('mpeg')) return 'mp3';
  if (t.includes('wav')) return 'wav';
  if (t.includes('ogg')) return 'ogg';
  if (t.includes('mp4') || t.includes('m4a')) return 'm4a';
  return 'webm';
}

function filePathFor(sessionId: string, cycle: 'cycle-1' | 'cycle-2', mimeType: string): string {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(scribeAudioDir(), safeId, `${cycle}.${extensionForMime(mimeType)}`);
}

export async function saveScribeAudio(
  sessionId: string,
  cycle: 'cycle-1' | 'cycle-2',
  audioBase64: string,
  mimeType: string,
): Promise<string> {
  const filePath = filePathFor(sessionId, cycle, mimeType);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const plaintext = Buffer.from(audioBase64, 'base64');
  await fs.writeFile(filePath, encryptAudio(plaintext), { mode: 0o600 });
  return filePath;
}

/** Decrypt stored audio back to base64 for Gemini ingestion. */
export async function readScribeAudio(
  sessionId: string,
  cycle: 'cycle-1' | 'cycle-2',
  mimeType: string,
): Promise<string> {
  const filePath = filePathFor(sessionId, cycle, mimeType);
  const envelope = await fs.readFile(filePath);
  return decryptAudio(envelope).toString('base64');
}

export async function purgeScribeAudio(sessionId: string): Promise<{ purgedFiles: string[] }> {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
  const dir = path.join(scribeAudioDir(), safeId);
  const purgedFiles: string[] = [];
  try {
    const entries = await fs.readdir(dir);
    for (const entry of entries) {
      const full = path.join(dir, entry);
      await fs.rm(full, { force: true });
      purgedFiles.push(full);
    }
    await fs.rmdir(dir);
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    // Missing directory = nothing stored; idempotent success.
    if (code !== 'ENOENT') throw err;
  }
  return { purgedFiles };
}
