/* eslint-disable no-console */
/**
 * REAL-DATABASE scribe commit/withdraw concurrency verification (R1) + invoice
 * race-convergence proof (R6) — runs the ACTUAL service functions against a
 * DISPOSABLE embedded PostgreSQL cluster (PG 18 via embedded-postgres).
 *
 *   npx tsx tests/db/scribe-concurrency-verification.ts
 *
 * Isolation: the harness boots a throwaway cluster in a temp dir on a random
 * free port, runs the full migration chain + provision.sql, and DELETES the
 * cluster on exit. No persistent database is ever contacted.
 *
 * Proven here (mocked tests cannot prove these):
 *   - two simultaneous commits for one eligible session → exactly one signed
 *     encounter; the loser gets a precise 409 (conditional status claim);
 *   - a commit racing consent withdrawal can never create an encounter after
 *     the withdrawal wins;
 *   - sequential commit/withdraw repetitions stay consistent;
 *   - the retention TTL worker cannot clobber a concurrently committed session;
 *   - encounter-persistence failure rolls the status claim back (no half-state);
 *   - encounters.origin_scribe_draft_ref UNIQUE is live (second insert fails);
 *   - P2002 meta.target recognition: the invoice race loser CONVERGES on the
 *     winner's invoice (2/2 completions fulfilled, exactly one invoice).
 */
import assert from 'node:assert/strict';
import pkg from '@prisma/client/index.js';
const { PrismaClient } = pkg;
import { isUniqueViolation } from '../../src/common/db/unique-violation.js';
import { startDisposableClinicDb } from './disposable-db.js';

type Db = import('@prisma/client').PrismaClient;

const DOCTOR = { userId: 'cc-doctor', role: 'DOCTOR' } as const;

let passed = 0;
function ok(label: string): void {
  passed += 1;
  console.log(`ok  ${label}`);
}

async function seedUserAndPatient(owner: Db): Promise<{ patientId: string }> {
  await owner.user.create({
    data: { id: 'cc-doctor', name: 'CC Doctor', identifier: 'cc-doctor-ident', passwordHash: 'x', role: 'DOCTOR', isActive: true, passwordMustChange: false },
  }).catch(() => undefined);
  const patient = await owner.patient.create({
    data: { id: `cc-pt-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, fullName: 'CC Patient', fullNameNorm: 'cc patient', dateOfBirth: new Date('1990-01-01'), emergencyContactName: 'Kin', emergencyContactPhone: '000', emergencyContactRelation: 'SELF', physicalAddress: 'n/a', createdByUserId: 'cc-doctor' },
  });
  return { patientId: patient.id };
}

async function seedAnalyzedSession(
  owner: Db,
  patientId: string,
  id: string,
  overrides: { status?: import('@prisma/client').ScribeSessionStatus; audioReference?: string | null; retentionPast?: boolean } = {},
): Promise<string> {
  const now = new Date();
  await owner.scribeSession.create({
    data: {
      id,
      patientId,
      mode: 'DICTATION_60S',
      consentStatus: 'GRANTED',
      consentedAt: now,
      status: overrides.status ?? 'TRANSCRIBED',
      audioReference: overrides.audioReference === undefined ? '/tmp/cc-audio.webm' : overrides.audioReference,
      audioRetentionUntil: overrides.retentionPast === true ? new Date(now.getTime() - 60_000) : new Date(now.getTime() + 86_400_000),
      createdByUserId: 'cc-doctor',
    },
  });
  await owner.scribeDraft.create({
    data: {
      scribeSessionId: id,
      patientId,
      mseSnapshot: {
        analysis: {
          cycle1: { chiefComplaint: 'Low mood', symptoms: ['insomnia'], moodAndAffect: 'Depressed', suggestions: [] },
          cycle2: null,
        },
      },
      soapDraftS: 's',
      soapDraftO: 'o',
      soapDraftA: 'a',
      soapDraftP: 'p',
      version: 1,
    },
  });
  return id;
}

async function main(): Promise<void> {
  const dbh = await startDisposableClinicDb();
  try {
    // The runtime role is the application identity: every service call below
    // runs under clinic_app (REVOKE-constrained), exactly like production.
    const app = new PrismaClient({ datasources: { db: { url: dbh.appUrl } } }) as unknown as Db;
    const owner = new PrismaClient({ datasources: { db: { url: dbh.ownerUrl } } }) as unknown as Db;
    process.env['DATABASE_URL'] = dbh.appUrl; // for lazily imported src modules
    const { commitScribeSession, withdrawConsentScribeSession, purgeExpiredScribeAudio } =
      await import('../../src/modules/ai-scribe/scribe.service.js');
    const noopPurge = (): Promise<{ purgedFiles: string[] }> => Promise.resolve({ purgedFiles: [] });

    // -----------------------------------------------------------------------
    // 0. Seed fixtures shared by the scribe scenarios.
    // -----------------------------------------------------------------------
    const { patientId } = await seedUserAndPatient(owner);
    const s = await import('../../src/config/env.js').catch(() => undefined);
    void s;

    // -----------------------------------------------------------------------
    // 1. Two SIMULTANEOUS commits for one eligible session: exactly one signed
    //    encounter; the loser surfaces 409 CONFLICT (conditional status claim).
    // -----------------------------------------------------------------------
    {
      const id = await seedAnalyzedSession(owner, patientId, 'cc-sess-race');
      const input = { soap: { S: 's', O: 'o', A: 'a', P: 'p' } };
      const results = await Promise.allSettled([
        commitScribeSession(id, input, DOCTOR, app),
        commitScribeSession(id, input, DOCTOR, app),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      const encounters = await owner.encounter.findMany({ where: { originScribeDraftRef: id } });
      assert.equal(encounters.length, 1, 'exactly one signed encounter under concurrent commit');
      assert.equal(fulfilled.length, 1, 'exactly one commit wins');
      const rejectCodes = rejected.map((r) => ((r as PromiseRejectedResult).reason as { code?: string }).code ?? 'unknown');
      assert.ok(rejectCodes.every((c) => c === 'CONFLICT'), `loser is 409 CONFLICT (got: ${rejectCodes.join(',')})`);
      const session = await owner.scribeSession.findUnique({ where: { id } });
      assert.equal(session?.status, 'COMMITTED');
      assert.equal(session?.encounterRef, (fulfilled[0] as PromiseFulfilledResult<{ encounterId: string }>).value.encounterId);
      ok('1. two simultaneous commits → 1 signed encounter, loser 409 CONFLICT');
    }

    // -----------------------------------------------------------------------
    // 2. Commit RACING withdrawal: whichever wins the row, the invariants hold —
    //    a rejected commit means NO encounter; a fulfilled commit means exactly
    //    one (created before the withdrawal claimed the row — doctor override).
    // -----------------------------------------------------------------------
    {
      const id = await seedAnalyzedSession(owner, patientId, 'cc-sess-race-cw');
      const input = { soap: { S: 's', O: 'o', A: 'a', P: 'p' } };
      const [commitRes, withdrawRes] = await Promise.allSettled([
        commitScribeSession(id, input, DOCTOR, app),
        withdrawConsentScribeSession(id, { reason: 'cc: race' }, DOCTOR, { purgeAudioFiles: noopPurge }, app),
      ]);
      const encounters = await owner.encounter.findMany({ where: { originScribeDraftRef: id } });
      const session = await owner.scribeSession.findUnique({ where: { id } });
      assert.ok(encounters.length <= 1, 'never two encounters');
      if (commitRes.status === 'rejected') {
        assert.equal(encounters.length, 0, 'a rejected commit must not have created an encounter');
        assert.equal(session?.status, 'WITHDRAWN', 'withdrawal won the race');
        assert.equal((commitRes.reason as { code?: string }).code, 'WITHDRAWN_GONE');
      } else {
        assert.equal(encounters.length, 1, 'a fulfilled commit created exactly one encounter');
        assert.equal(session?.encounterRef, commitRes.value.encounterId);
      }
      assert.equal(withdrawRes.status, 'fulfilled', 'withdrawal either won or exercised the COMMITTED override');
      ok('2. commit racing withdrawal → invariants hold (no encounter after withdrawal wins)');
    }

    // -----------------------------------------------------------------------
    // 3. Withdrawal completes FIRST, then commit → 403 WITHDRAWN_GONE, no
    //    encounter, ever.
    // -----------------------------------------------------------------------
    {
      const id = await seedAnalyzedSession(owner, patientId, 'cc-sess-wfirst');
      await withdrawConsentScribeSession(id, { reason: 'cc: revoke' }, DOCTOR, { purgeAudioFiles: noopPurge }, app);
      let thrown: unknown = null;
      try {
        await commitScribeSession(id, { soap: { S: 's', O: 'o', A: 'a', P: 'p' } }, DOCTOR, app);
      } catch (err) {
        thrown = err;
      }
      assert.ok((thrown as { code?: string })?.code === 'WITHDRAWN_GONE', 'commit after withdrawal is locked');
      assert.equal(await owner.encounter.count({ where: { originScribeDraftRef: id } }), 0, 'no signed encounter after withdrawal');
      ok('3. withdrawal-then-commit → WITHDRAWN_GONE, zero encounters');
    }

    // -----------------------------------------------------------------------
    // 4. Repeated SEQUENTIAL commit/withdraw: commit → withdraw (override) →
    //    withdraw (409) → commit (locked) — one encounter total, end WITHDRAWN.
    // -----------------------------------------------------------------------
    {
      const id = await seedAnalyzedSession(owner, patientId, 'cc-sess-seq');
      const committed = await commitScribeSession(id, { soap: { S: 's', O: 'o', A: 'a', P: 'p' } }, DOCTOR, app);
      let doubleCommit: unknown = null;
      try {
        await commitScribeSession(id, { soap: { S: 's', O: 'o', A: 'a', P: 'p' } }, DOCTOR, app);
      } catch (err) {
        doubleCommit = err;
      }
      assert.ok((doubleCommit as { code?: string })?.code === 'CONFLICT');
      const withdrawn = await withdrawConsentScribeSession(id, { reason: 'cc: late revoke' }, DOCTOR, { purgeAudioFiles: noopPurge }, app);
      assert.equal(withdrawn.status, 'WITHDRAWN', 'COMMITTED session remains withdrawable by explicit override');
      let doubleWithdraw: unknown = null;
      try {
        await withdrawConsentScribeSession(id, {}, DOCTOR, { purgeAudioFiles: noopPurge }, app);
      } catch (err) {
        doubleWithdraw = err;
      }
      assert.ok((doubleWithdraw as { code?: string })?.code === 'CONFLICT');
      let commitAfter: unknown = null;
      try {
        await commitScribeSession(id, { soap: { S: 's', O: 'o', A: 'a', P: 'p' } }, DOCTOR, app);
      } catch (err) {
        commitAfter = err;
      }
      assert.ok((commitAfter as { code?: string })?.code === 'WITHDRAWN_GONE');
      assert.equal(await owner.encounter.count({ where: { originScribeDraftRef: id } }), 1, 'exactly one encounter across all repetitions');
      assert.equal(await owner.medication.count({ where: { encounterRef: committed.encounterId } }), 0, 'commit had no prescriptions — no medication rows');
      ok('4. sequential commit/withdraw repetitions → one encounter, precise conflicts throughout');
    }

    // -----------------------------------------------------------------------
    // 5. Commit racing the RETENTION TTL worker (status change): a commit that
    //    wins keeps COMMITTED (never clobbered to PURGED); a purge that wins
    //    locks the session and the commit surfaces 410 GONE with no encounter.
    // -----------------------------------------------------------------------
    {
      const id = await seedAnalyzedSession(owner, patientId, 'cc-sess-ttl', { retentionPast: true });
      const [commitRes, purgeRes] = await Promise.allSettled([
        commitScribeSession(id, { soap: { S: 's', O: 'o', A: 'a', P: 'p' } }, DOCTOR, app),
        purgeExpiredScribeAudio(app, { purgeAudioFiles: noopPurge }),
      ]);
      const session = await owner.scribeSession.findUnique({ where: { id } });
      const encounters = await owner.encounter.count({ where: { originScribeDraftRef: id } });
      if (commitRes.status === 'fulfilled') {
        assert.equal(session?.status, 'COMMITTED', 'commit won — retention must not clobber it');
        assert.equal(encounters, 1);
        const purgeOk = purgeRes as PromiseFulfilledResult<{ purged: number; sessionIds: string[] }>;
        assert.ok(!purgeOk.value.sessionIds.includes(id), 'raced session not flipped by the worker');
      } else {
        assert.equal(session?.status, 'PURGED', 'retention won — session locked as PURGED');
        assert.equal(encounters, 0, 'no encounter after purge');
        assert.equal((commitRes.reason as { code?: string }).code, 'GONE');
      }
      ok('5. commit racing retention TTL → no clobber either way (conditional worker flip)');
    }

    // -----------------------------------------------------------------------
    // 6. ROLLBACK: a pre-existing encounter on the same session ref makes
    //    encounter.create violate the UNIQUE invariant inside the commit tx —
    //    the claim must roll back (status stays TRANSCRIBED, no medications,
    //    encounterRef null) and the error is a clean 409.
    // -----------------------------------------------------------------------
    {
      const id = await seedAnalyzedSession(owner, patientId, 'cc-sess-rollback');
      await owner.encounter.create({
        data: { patientId, source: 'SCRIBE', status: 'SIGNED', rowVersion: 1, originScribeDraftRef: id, signedByUserId: 'cc-doctor', signedAt: new Date() },
      });
      let thrown: unknown = null;
      try {
        await commitScribeSession(id, { soap: { S: 's', O: 'o', A: 'a', P: 'p' } }, DOCTOR, app);
      } catch (err) {
        thrown = err;
      }
      assert.ok((thrown as { code?: string })?.code === 'CONFLICT', `unique-backed failure surfaces 409 (got ${(thrown as { code?: string })?.code})`);
      const session = await owner.scribeSession.findUnique({ where: { id } });
      assert.equal(session?.status, 'TRANSCRIBED', 'status claim rolled back with the failed transaction');
      assert.equal(session?.encounterRef, null, 'no encounterRef leaked');
      assert.equal(await owner.medication.count({ where: { patientId } }), 0, 'no medication rows persisted');
      assert.equal(await owner.encounter.count({ where: { originScribeDraftRef: id } }), 1, 'only the pre-existing encounter remains');
      ok('6. encounter-persistence failure → full rollback of the commit claim (status intact)');
    }

    // -----------------------------------------------------------------------
    // 7. The durable invariant itself: a second encounter row for the same
    //    session ref is rejected by the DB (migration 0012 UNIQUE index).
    // -----------------------------------------------------------------------
    {
      const id = await seedAnalyzedSession(owner, patientId, 'cc-sess-unique');
      await owner.encounter.create({
        data: { patientId, source: 'SCRIBE', status: 'SIGNED', rowVersion: 1, originScribeDraftRef: id },
      });
      let threw = false;
      try {
        await owner.encounter.create({
          data: { patientId, source: 'SCRIBE', status: 'SIGNED', rowVersion: 1, originScribeDraftRef: id },
        });
      } catch {
        threw = true;
      }
      assert.ok(threw, 'second encounter for the same session ref violates the unique index');
      const manual = await owner.encounter.create({
        data: { patientId, source: 'MANUAL', status: 'DRAFT', rowVersion: 1, originScribeDraftRef: null },
      });
      await owner.encounter.create({
        data: { patientId, source: 'MANUAL', status: 'DRAFT', rowVersion: 1, originScribeDraftRef: null },
      });
      void manual;
      ok('7. UNIQUE(origin_scribe_draft_ref) live; multiple NULL (MANUAL) rows still allowed');
    }

    // -----------------------------------------------------------------------
    // 8. R6: the REAL P2002 representation — an actual duplicate invoice insert
    //    must be recognized by isUniqueViolation('queue_entry_id') whatever
    //    spelling Prisma reports, and the concurrent completion LOSER must
    //    converge on the winner's invoice (2/2 fulfilled, exactly one invoice).
    // -----------------------------------------------------------------------
    {
      await owner.clinicSettings.create({
        data: { id: 'singleton', standardFeeMinor: 50_000, secretaryMaxDiscountMinor: 5_000, secretaryMaxDiscountPct: 10, avgConsultDurationMin: 20, currency: 'USD' },
      });
      const shift = await owner.shift.create({
        data: { id: 'cc-shift-r6', businessDate: new Date(Date.now() - 86_400_000), status: 'OPEN', openingFloatMinor: 0, queueVersion: 0, openedByUserId: 'cc-doctor' },
      });
      const { checkIn, callEntry, completeEntry } = await import('../../src/modules/identity-queue/queue.service.js');
      const entryId = await checkIn({ patientId }, DOCTOR, 'cc-key-r6', app).then((r) => r.entryId);
      await callEntry(entryId, {}, DOCTOR, app);

      // Direct duplicate: pin down what Prisma actually reports.
      const dupInput = {
        patientId,
        queueEntryId: entryId,
        shiftId: shift.id,
        standardFeeMinor: 50_000,
        finalFeeMinor: 50_000,
        outstandingMinor: 50_000,
        status: 'UNPAID' as const,
        idempotencyKey: 'cc-dup-1',
        createdByUserId: 'cc-doctor',
      };
      await owner.invoice.create({ data: dupInput });
      let realErr: unknown = null;
      try {
        await owner.invoice.create({ data: { ...dupInput, idempotencyKey: 'cc-dup-2' } });
      } catch (err) {
        realErr = err;
      }
      assert.ok(realErr !== null, 'duplicate invoice insert must fail');
      assert.equal(isUniqueViolation(realErr, 'queue_entry_id'), true, `real P2002 meta.target=${JSON.stringify((realErr as { meta?: unknown })?.meta)} must match 'queue_entry_id'`);

      // Release the single-consultation slot held by the probe entry, then run
      // the convergence race on a fresh patient's entry.
      await completeEntry(entryId, DOCTOR, app);
      const { patientId: patientId2 } = await seedUserAndPatient(owner);
      const entryId2 = await checkIn({ patientId: patientId2 }, DOCTOR, 'cc-key-r6-b', app).then((r) => r.entryId);
      await callEntry(entryId2, {}, DOCTOR, app);
      const results = await Promise.allSettled([
        completeEntry(entryId2, DOCTOR, app),
        completeEntry(entryId2, DOCTOR, app),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const invoices = await owner.invoice.findMany({ where: { queueEntryId: entryId2 } });
      assert.equal(invoices.length, 1, 'exactly one invoice under concurrent completion');
      assert.equal(fulfilled.length, 2, `concurrent loser converges on the winner's invoice (got ${fulfilled.length}/2)`);
      ok('8. real P2002 recognized + concurrent completion loser converges (2/2, 1 invoice)');
    }

    await app.$disconnect();
    await owner.$disconnect();
    console.log(`\nScribe/invoice concurrency verification green: ${passed} scenario group(s) passed on disposable PostgreSQL.`);
  } finally {
    await dbh.stop();
  }
}

main().catch(async (err) => {
  console.error('SCRIBE CONCURRENCY VERIFICATION FAILED:', err);
  process.exit(1);
});
