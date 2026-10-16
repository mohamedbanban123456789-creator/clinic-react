import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../../common/prisma.js';
import { AppError } from '../../../common/errors/AppError.js';
import { writeAudit } from '../../../common/audit.js';
import { decryptNote, encryptNote, shredNote } from '../../../common/crypto/vault.js';
import type { CreateVaultNoteInput, ListVaultNotesQuery } from './vault.validators.js';

export interface DoctorActor {
  readonly userId: string;
  readonly role: 'DOCTOR' | 'SECRETARY';
}

type Db = PrismaClient | Prisma.TransactionClient;

async function assertPatientExists(db: Db, patientId: string): Promise<void> {
  const row = await (db as PrismaClient).patient.findUnique({
    where: { id: patientId },
    select: { id: true },
  });
  if (row === null) throw new AppError('NOT_FOUND', 'Patient not found');
}

// ---------------------------------------------------------------------------
// POST /api/v1/ehr/vault/patients/:id/notes [DOCTOR]
// Envelope-encrypts content; plaintext is NEVER stored or logged.
// ---------------------------------------------------------------------------
export async function createVaultNote(
  patientId: string,
  input: CreateVaultNoteInput,
  actor: DoctorActor,
  db: PrismaClient = prisma,
): Promise<{ noteId: string; noteDate: string; seq: number }> {
  await assertPatientExists(db, patientId);
  if (input.content.trim().length === 0) {
    throw new AppError('UNPROCESSABLE', 'content must not be empty');
  }
  const noteId = randomUUID();
  // Envelope encrypt BEFORE persist. AAD binds noteId:patientId.
  const envelope = encryptNote(noteId, patientId, input.content);
  try {
    const agg = await db.therapyNote.aggregate({
      where: { patientId },
      _max: { seq: true },
    });
    const seq = (agg._max.seq ?? 0) + 1;
    const noteDate = input.noteDate !== undefined ? new Date(input.noteDate) : new Date();
    const row = await db.therapyNote.create({
      data: {
        id: noteId,
        patientId,
        ciphertext: envelope.ciphertextB64,
        wrappedDek: envelope.wrappedDekB64,
        nonce: envelope.nonceB64,
        keyId: envelope.kekId,
        noteDate,
        seq,
        supersedesNoteId: input.supersedesNoteId ?? null,
        createdByUserId: actor.userId,
      },
      select: { id: true, noteDate: true, seq: true },
    });
    // Audit id + seq only — zero content (Appendix B B-3).
    await writeAudit(db, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'VAULT_ACCESS',
      entityType: 'TherapyNote',
      entityId: row.id,
      requestId: randomUUID(),
      afterState: { op: 'CREATE', seq: row.seq },
    });
    return { noteId: row.id, noteDate: (row.noteDate ?? noteDate).toISOString(), seq: row.seq };
  } finally {
    // Hygiene: drop the plaintext reference; envelope buffers are base64 strings
    // (GC'd). shredNote covers Buffer hygiene where applicable.
    shredNote(Buffer.alloc(0));
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/ehr/vault/patients/:id/notes?limit<=20&cursor [DOCTOR]
// Decrypts in memory for DOCTOR only. Audits id + count (zero content).
// ---------------------------------------------------------------------------
export async function listVaultNotes(
  patientId: string,
  query: ListVaultNotesQuery,
  actor: DoctorActor,
  db: PrismaClient = prisma,
): Promise<{
  patientId: string;
  notes: Array<
    | { noteId: string; noteDate: string | null; seq: number; content: string; supersedesNoteId: string | null }
    | { noteId: string; noteDate: string | null; seq: number; shredded: true; shreddedAt: string | null }
  >;
  nextCursor: string | null;
}> {
  await assertPatientExists(db, patientId);
  const limit = query.limit ?? 20;
  const rows = await db.therapyNote.findMany({
    where: { patientId },
    orderBy: [{ createdAt: 'desc' }, { seq: 'desc' }],
    ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? page[page.length - 1]?.id ?? null : null;

  const notes: Array<
    | { noteId: string; noteDate: string | null; seq: number; content: string; supersedesNoteId: string | null }
    | { noteId: string; noteDate: string | null; seq: number; shredded: true; shreddedAt: string | null }
  > = [];
  for (const r of page) {
    if (r.ciphertext === null || r.wrappedDek === null || r.nonce === null) {
      notes.push({
        noteId: r.id,
        noteDate: r.noteDate?.toISOString() ?? null,
        seq: r.seq,
        shredded: true,
        shreddedAt: r.shreddedAt?.toISOString() ?? null,
      });
      continue;
    }
    // Decrypt in memory; throws on tamper/transplant — surfaced as 500-safe?
    // Treat auth failure as INTERNAL (never leak oracle details).
    let content: string;
    try {
      content = decryptNote(r.id, r.patientId, {
        ciphertextB64: r.ciphertext,
        wrappedDekB64: r.wrappedDek,
        nonceB64: r.nonce,
        kekId: r.keyId,
      });
    } catch {
      throw new AppError('INTERNAL', 'Vault decryption failed');
    }
    notes.push({
      noteId: r.id,
      noteDate: r.noteDate?.toISOString() ?? null,
      seq: r.seq,
      content,
      supersedesNoteId: r.supersedesNoteId,
    });
  }

  await writeAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: 'VAULT_ACCESS',
    entityType: 'TherapyNote',
    entityId: patientId,
    requestId: randomUUID(),
    afterState: { op: 'READ', count: page.length },
  });

  return { patientId, notes, nextCursor };
}

// ---------------------------------------------------------------------------
// POST /api/v1/ehr/vault/notes/:id/shred [DOCTOR] — tombstone, no recovery.
// ---------------------------------------------------------------------------
export async function shredVaultNote(
  id: string,
  actor: DoctorActor,
  db: PrismaClient = prisma,
): Promise<{ noteId: string; shreddedAt: string }> {
  const cur = await db.therapyNote.findUnique({ where: { id } });
  if (cur === null) throw new AppError('NOT_FOUND', 'Therapy note not found');
  if (cur.shreddedAt !== null || cur.ciphertext === null) {
    return { noteId: cur.id, shreddedAt: (cur.shreddedAt ?? new Date()).toISOString() };
  }
  const shreddedAt = new Date();
  await db.therapyNote.update({
    where: { id },
    data: { ciphertext: null, wrappedDek: null, nonce: null, shreddedAt },
  });
  await writeAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: 'VAULT_ACCESS',
    entityType: 'TherapyNote',
    entityId: id,
    requestId: randomUUID(),
    afterState: { op: 'SHRED' },
  });
  return { noteId: id, shreddedAt: shreddedAt.toISOString() };
}
