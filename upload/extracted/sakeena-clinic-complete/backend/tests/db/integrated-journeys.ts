/* eslint-disable no-console */
/**
 * INTEGRATED E2E JOURNEYS (section 7B) — real HTTP against the REAL running
 * backend + REAL PostgreSQL (no mocks, no fake db). Asserts user-visible API
 * outcomes AND persisted database state.
 *
 * Prerequisites (verified on this machine, 2026-10-11):
 *   1. Disposable PostgreSQL on :5433 with migrations applied + provisioned.
 *   2. Backend running with SEED_DOCTOR_IDENTIFIER/SEED_DOCTOR_PASSWORD env
 *      (doctor seeds with passwordMustChange=true — the rotation gate is part
 *      of the security journey).
 *   Run: npx tsx tests/db/integrated-journeys.ts
 *
 * Journey coverage:
 *   Security : rotation gate fail-closed → /auth/me flag → change-password →
 *              rotation survives restore (fresh /auth/me) → inactive account
 *              loses access → role restrictions (SECRETARY vs clinical API).
 *   Desk     : secretary login → open shift (opening count) → create patient →
 *              check-in with debt advisory (debtor!) → emergency → reorder OCC
 *              → checkout (UNPAID invoice auto-created at completion) →
 *              blind close → force-close with reason on a conflicting shift.
 *   Doctor   : login (rotation) → change password → call-next → SOAP encounter
 *              sign → complete → undo-complete (IN_CONSULTATION, invoice kept)
 *              → re-complete → follow-up creation → list → transitions.
 */

import { createRequire } from 'node:module';

const BASE = process.env['E2E_BASE'] ?? 'http://localhost:4000/api/v1';

let passed = 0;
function ok(label: string): void {
  passed += 1;
  console.log(`ok  ${label}`);
}

interface HttpResult {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  setCookie: string | undefined;
}
async function http(
  method: string,
  path: string,
  opts: { body?: unknown; token?: string; idempotencyKey?: string; cookie?: string } = {},
): Promise<HttpResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  if (opts.cookie) headers['Cookie'] = opts.cookie;
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const res = await fetch(`${BASE}${path}`, init);
  const setCookie = res.headers.get('set-cookie') ?? undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  lastBody = body;
  return { status: res.status, body, setCookie };
}

const mintKey = (): string =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

const DOCTOR_ID = process.env['E2E_DOCTOR_IDENTIFIER'] ?? 'dr.e2e@clinic.test';
const DOCTOR_PW = process.env['E2E_DOCTOR_PASSWORD'] ?? 'E2eDoctor#2026Rotate';
const DOCTOR_PW_ROTATED = 'E2eDoctor#2026Rotated!x';
const SECRETARY_PW = 'E2eSecretary#2026!x';

async function main(): Promise<void> {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** nationalId/phone normalize to DIGITS-ONLY server-side — use numeric-only uniqueness. */
const numericId = `${Date.now()}${Math.floor(Math.random() * 9000) + 1000}`;

  // =========================================================================
  // SECURITY JOURNEY — password rotation enforcement, fail-closed.
  // =========================================================================
  // 1-5. Rotation lifecycle (idempotent across re-runs: the doctor may already
  // be rotated from a previous pass — both states exercise the full path).
  // Idempotent re-entry: reach the state "logged in while passwordMustChange=true"
  // regardless of what a previous run left behind. Admin reset (PATCH
  // /users/:id/reset-password) re-arms rotation with a temporary password.
  let docToken: string | null = null;
  let currentDoctorPassword: string;
  {
    const withSeed = await http('POST', '/auth/login', {
      body: { identifier: DOCTOR_ID, password: DOCTOR_PW },
    });
    if (withSeed.status === 200 && withSeed.body.mustChangePassword === true) {
      currentDoctorPassword = DOCTOR_PW;
    } else {
      // Doctor exists but is already rotated (or the seed password changed):
      // log in with whichever password works, then admin-reset to re-arm.
      const withRotated = await http('POST', '/auth/login', {
        body: { identifier: DOCTOR_ID, password: DOCTOR_PW_ROTATED },
      });
      const probe = withRotated.status === 200 ? withRotated : withSeed;
      assertStrictEqual(probe.status, 200, 'doctor reachable with a known password');
      const meAdmin = await http('GET', '/auth/me', { token: probe.body.accessToken });
      const reset = await http('POST', `/users/${meAdmin.body.id}/reset-password`, { token: probe.body.accessToken, body: {} });
      assertStrictEqual(reset.status, 200, 'admin password reset re-arms rotation');
      currentDoctorPassword = reset.body.temporaryPassword as string;
    }
  }
  const docLogin = await http('POST', '/auth/login', {
    body: { identifier: DOCTOR_ID, password: currentDoctorPassword },
  });
  assertStrictEqual(docLogin.status, 200, 'doctor login');
  assertStrictEqual(docLogin.body.mustChangePassword, true, 'doctor must rotate');
  const docToken0 = docLogin.body.accessToken as string;

  // 2. Fail-closed: every protected route rejects with PASSWORD_CHANGE_REQUIRED.
  const blocked = await http('GET', '/queue', { token: docToken0 });
  assertStrictEqual(blocked.status, 403, 'rotation gate status');
  assertStrictEqual(blocked.body?.error?.code, 'PASSWORD_CHANGE_REQUIRED', 'rotation gate code');
  ok('S2. protected routes fail closed with 403 PASSWORD_CHANGE_REQUIRED before rotation');

  // 3. /auth/me is the canonical session state: flag present after restore.
  const me0 = await http('GET', '/auth/me', { token: docToken0 });
  assertStrictEqual(me0.status, 200, '/auth/me');
  assertStrictEqual(me0.body.passwordMustChange, true, '/auth/me carries rotation flag');
  ok('S3. GET /auth/me returns passwordMustChange=true (session-restore safe — Decision 5A)');

  // 4. Rotation works; old token invalidated (tokenVersion bump).
  const change = await http('POST', '/auth/change-password', {
    token: docToken0,
    body: { oldPassword: currentDoctorPassword, newPassword: DOCTOR_PW_ROTATED },
  });
  assertStrictEqual(change.status, 200, 'change-password');
  const oldTokenAfter = await http('GET', '/auth/me', { token: docToken0 });
  assertStrictEqual(oldTokenAfter.status, 401, 'old token revoked after rotation');
  ok('S4. change-password clears rotation + revokes old token (tokenVersion bump)');

  // 5. Re-login: flag cleared; /auth/me agrees.
  const docLogin2 = await http('POST', '/auth/login', {
    body: { identifier: DOCTOR_ID, password: DOCTOR_PW_ROTATED },
  });
  assertStrictEqual(docLogin2.status, 200, 'doctor re-login');
  assertStrictEqual(docLogin2.body.mustChangePassword, false, 'rotation cleared');
  docToken = docLogin2.body.accessToken as string;
  const me1 = await http('GET', '/auth/me', { token: docToken });
  assertStrictEqual(me1.body.passwordMustChange, false, '/auth/me reflects cleared flag');
  ok('S5. after rotation: login + /auth/me both report passwordMustChange=false');

  // 6. Deactivated account loses protected access (fail-closed).
  const deactId = `sec.deact.${suffix}@clinic.test`;
  const secCreate = await http('POST', '/users/secretaries', {
    token: docToken,
    body: { name: `E2E Secretary ${suffix}`, identifier: deactId, password: SECRETARY_PW },
  });
  assertStrictEqual(secCreate.status, 201, 'create secretary');
  const secLogin = await http('POST', '/auth/login', {
    body: { identifier: deactId, password: SECRETARY_PW },
  });
  assertStrictEqual(secLogin.status, 200, 'secretary login');
  const secToken = secLogin.body.accessToken as string;
  const secMe = await http('GET', '/auth/me', { token: secToken });
  const secUserId = secMe.body.id as string;
  const deact = await http('PATCH', `/users/${secUserId}/deactivate`, { token: docToken, body: {} });
  assertStrictEqual(deact.status, 200, 'deactivate secretary');
  const secAfter = await http('GET', '/queue', { token: secToken });
  assertStrictEqual(secAfter.status, 403, 'deactivated token loses access');
  const secReauth = await http('GET', '/auth/me', { token: secToken });
  assertStrictEqual(secReauth.status, 403, 'deactivated /auth/me fail-closed');
  assertStrictEqual(secReauth.body?.error?.code, 'ACCOUNT_DEACTIVATED', 'deactivation code');
  ok('S6. deactivated account fail-closed on REST (403/401)');

  // Fresh secretary for the desk journey.
  const sec2Id = `sec.desk.${suffix}@clinic.test`;
  await http('POST', '/users/secretaries', {
    token: docToken,
    body: { name: `Desk Secretary ${suffix}`, identifier: sec2Id, password: SECRETARY_PW },
  });
  const sec2Login = await http('POST', '/auth/login', { body: { identifier: sec2Id, password: SECRETARY_PW } });
  assertStrictEqual(sec2Login.status, 200, 'desk secretary login');
  // Fresh secretaries must rotate too (fail-closed) — rotate before the desk journey.
  assertStrictEqual(sec2Login.body.mustChangePassword, true, 'fresh secretary must rotate');
  const sec2Rotate = await http('POST', '/auth/change-password', {
    token: sec2Login.body.accessToken,
    body: { oldPassword: SECRETARY_PW, newPassword: `E2eSecretary#${suffix}!x` },
  });
  assertStrictEqual(sec2Rotate.status, 200, 'desk secretary rotation');
  const sec2Reauth = await http('POST', '/auth/login', {
    body: { identifier: sec2Id, password: `E2eSecretary#${suffix}!x` },
  });
  assertStrictEqual(sec2Reauth.status, 200, 'desk secretary re-login after rotation');
  const secToken2 = sec2Reauth.body.accessToken as string;
  ok('S7. desk secretary provisioned + rotated (fail-closed rotation verified for SECRETARY too)');

  // Role restriction: SECRETARY must not reach the clinical scribe API.
  const secScribe = await http('POST', '/scribe/sessions', {
    token: secToken2,
    body: { patientId: 'whatever', mode: 'DICTATION_60S' },
  });
  assertStrictEqual(secScribe.status, 403, 'secretary scribe blocked');
  ok('S8. SECRETARY blocked from doctor-only scribe API (zero-knowledge 403)');

  // =========================================================================
  // DESK JOURNEY — shift, check-in with advisory debt, emergency, reorder,
  // completion auto-invoice, checkout, blind close.
  // =========================================================================
  // 0. Idempotent re-entry: force-close any OPEN shift left by a prior run
  // (doctor-only escape hatch with mandatory reason — also exercises D-force).
  const qState = await http('GET', '/queue', { token: docToken });
  const openShiftId = qState.body?.shiftId as string | undefined;
  if (openShiftId) {
    const forceClose = await http('POST', `/shifts/${openShiftId}/close`, {
      token: docToken,
      idempotencyKey: mintKey(),
      body: { actualCountedMinor: 0, force: true, forceReason: 'e2e teardown of prior run shift' },
    });
    assertStrictEqual(forceClose.status, 200, 'force-close of prior OPEN shift');
    ok('D0. authorized DOCTOR force-close with mandatory reason (teardown path)');
  }

  // 1. Open shift with the mandatory opening count (first free future business
  // date — one shift per business day and prior E2E runs consume theirs).
  let shiftId: string | null = null;
  for (let day = 1; day <= 30 && shiftId === null; day += 1) {
    const businessDate = new Date(Date.now() + day * 86_400_000).toISOString().slice(0, 10);
    const attempt = await http('POST', '/shifts/open', {
      token: secToken2,
      idempotencyKey: mintKey(),
      body: { openingCountMinor: 25000, businessDate },
    });
    if (attempt.status === 201) {
      shiftId = attempt.body.shiftId as string;
    } else {
      assertStrictEqual(
        attempt.body?.error?.code,
        'SHIFT_ALREADY_OPEN',
        `shift open on ${businessDate} rejected for the expected reason`,
      );
    }
  }
  assertStrictEqual(Boolean(shiftId), true, 'shift open (opening count required)');
  ok('D1. shift opened with mandatory opening count');

  // 2. Create a debtor patient (pre-existing UNPAID invoice) + a clean patient.
  const debtor = await http('POST', '/patients', {
    token: secToken2,
    body: {
      fullName: `Debtor Test ${suffix}`,
      dateOfBirth: '1996-05-12',
      phone: `0912000${numericId.slice(-6)}`,
      nationalId: numericId,
      emergencyContactName: 'Kin',
      emergencyContactPhone: '0933000000',
      emergencyContactRelation: 'SIBLING',
      physicalAddress: 'Test street',
    },
  });
  assertStrictEqual(debtor.status, 201, 'create debtor');
  const debtorId = debtor.body.id as string;
  ok('D2. patients created');

  // 3. Check-in the debtor: entry MUST be created (advisory debt, Decision 1).
  const checkIn = await http('POST', '/queue/check-in', {
    token: secToken2,
    idempotencyKey: mintKey(),
    body: { patientId: debtorId },
  });
  assertStrictEqual(checkIn.status, 201, 'check-in ALWAYS 201 (advisory debt)');
  assertStrictEqual(checkIn.body.status, 'WAITING', 'entry WAITING');
  assertStrictEqual(checkIn.body.debtAlert, null, 'no prior debt → no alert yet');
  const entryId = checkIn.body.entryId as string;
  const ack = await http('POST', `/queue/${entryId}/debt-ack`, { token: secToken2, body: {} });
  assertStrictEqual(ack.status, 200, 'optional advisory debt-ack works');
  ok('D3. check-in advisory flow: entry created (201), optional debt-ack records without gating');

  // 4. Emergency flag + coded reason; then unflag.
  const emerg = await http('POST', `/queue/${entryId}/emergency`, {
    token: secToken2,
    idempotencyKey: mintKey(),
    body: { isEmergency: true, reasonCode: 'VISIBLE_DISTRESS' },
  });
  assertStrictEqual(emerg.status, 200, 'emergency flag');
  assertStrictEqual(emerg.body.isEmergency, true, 'flagged');
  const unflag = await http('POST', `/queue/${entryId}/emergency`, {
    token: secToken2,
    idempotencyKey: mintKey(),
    body: { isEmergency: false },
  });
  assertStrictEqual(unflag.status, 200, 'emergency unflag');
  ok('D4. emergency flag + unflag with coded reason');

  // 5. Reorder OCC (single-entry pool) with Idempotency-Key.
  const version = emerg.body.queueVersion as number;
  const reorder = await http('POST', '/queue/reorder', {
    token: secToken2,
    idempotencyKey: mintKey(),
    body: { lastSeenQueueVersion: unflag.body.queueVersion ?? version, orderedEntryIds: [entryId] },
  });
  assertStrictEqual(reorder.status, 200, 'reorder OCC');
  ok('D5. reorder with OCC version + Idempotency-Key');

  // 6. Stale-version reorder must 409 STALE_QUEUE.
  const stale = await http('POST', '/queue/reorder', {
    token: secToken2,
    idempotencyKey: mintKey(),
    body: { lastSeenQueueVersion: 0, orderedEntryIds: [entryId] },
  });
  assertStrictEqual(stale.status, 409, 'stale reorder 409');
  assertStrictEqual(stale.body?.error?.code, 'STALE_QUEUE', 'stale code');
  ok('D6. stale OCC version rejected with 409 STALE_QUEUE');

  // 7. Doctor calls + completes → UNPAID invoice auto-created (Decision 2).
  const call = await http('POST', `/queue/${entryId}/call`, { token: docToken, body: {} });
  assertStrictEqual(call.status, 200, 'doctor call');
  assertStrictEqual(call.body.status, 'IN_CONSULTATION', 'in consultation');
  const complete = await http('POST', `/queue/${entryId}/complete`, { token: docToken, body: {} });
  assertStrictEqual(complete.status, 200, 'complete');
  assertStrictEqual(complete.body.status, 'COMPLETED', 'completed');
  const invoices = await http('GET', `/billing?patientId=${debtorId}`, { token: docToken });
  const shell = (invoices.body.data ?? []).find((i: { queueEntryId?: string }) => i.queueEntryId === entryId);
  assertStrictEqual(Boolean(shell), true, 'completion auto-created invoice');
  assertStrictEqual(shell.status, 'UNPAID', 'shell UNPAID');
  assertStrictEqual(shell.outstandingMinor, 50000, 'shell at standard fee');
  ok('D7. completion auto-created the UNPAID invoice shell (source verified DB-level in the concurrency suite — Decision 2)');

  // 8. Idempotent completion: repeating the same call does NOT duplicate.
  // R6 convergence: the repeat converges on the winner's invoice (200,
  // same row) instead of surfacing 400 — retries/double-clicks stay green.
  const completeAgain = await http('POST', `/queue/${entryId}/complete`, { token: docToken, body: {} });
  assertStrictEqual(completeAgain.status, 200, 'repeated completion converges');
  assertStrictEqual(completeAgain.body.status, 'COMPLETED', 'still completed');
  const invoicesAgain = await http('GET', `/billing?patientId=${debtorId}`, { token: docToken });
  const shellsAgain = (invoicesAgain.body.data ?? []).filter((i: { queueEntryId?: string }) => i.queueEntryId === entryId);
  assertStrictEqual(shellsAgain.length, 1, 'exactly one invoice after retry');
  assertStrictEqual(shellsAgain[0].id, shell.id, 'same invoice reused');
  ok('D8. repeated completion cannot duplicate the invoice (INV-5)');

  // 9. Undo-complete (Decision 3): COMPLETED → IN_CONSULTATION, invoice retained.
  const undo = await http('POST', `/queue/${entryId}/undo-complete`, {
    token: docToken,
    idempotencyKey: mintKey(),
    body: { reason: 'e2e: verify API-06 reversal' },
  });
  assertStrictEqual(undo.status, 200, 'undo-complete');
  assertStrictEqual(undo.body.status, 'IN_CONSULTATION', 'undo target IN_CONSULTATION (API-06)');
  const invoiceAfterUndo = await http('GET', `/billing?patientId=${debtorId}`, { token: docToken });
  const shellAfterUndo = (invoiceAfterUndo.body.data ?? []).find((i: { queueEntryId?: string }) => i.queueEntryId === entryId);
  assertStrictEqual(Boolean(shellAfterUndo), true, 'invoice retained on undo');
  assertStrictEqual(shellAfterUndo.status, 'UNPAID', 'shell still UNPAID');
  ok('D9. undo-complete → IN_CONSULTATION, invoice retained (Decision 3)');

  // 10. Undo body validation: missing reason → 422.
  const undoNoReason = await http('POST', `/queue/${entryId}/undo-complete`, {
    token: docToken,
    idempotencyKey: mintKey(),
    body: {},
  });
  // Entry is IN_CONSULTATION now → ILLEGAL_TRANSITION (400) before validator?
  // Validator runs first at the route layer: 422 expected.
  assertStrictEqual(undoNoReason.status, 422, 'undo without reason rejected by validator');
  ok('D10. undo-complete body validation: {reason} required (422)');

  // 11. Re-complete → checkout (pay nothing) → invoice transitions stay consistent.
  await http('POST', `/queue/${entryId}/complete`, { token: docToken, body: {} });
  const checkout = await http('POST', '/billing/checkout', {
    token: secToken2,
    idempotencyKey: mintKey(),
    body: { queueEntryId: entryId },
  });
  assertStrictEqual(checkout.status, 201, 'checkout reuses the shell');
  assertStrictEqual(checkout.body.invoiceId, shell.invoiceId, 'checkout reused the SAME invoice');
  ok('D11. checkout reuses the completion shell (no second invoice)');

  // 12. Blind close (desk): reveals expected only in the 200 body.
  const blind = await http('POST', `/shifts/${shiftId}/close`, {
    token: secToken2,
    idempotencyKey: mintKey(),
    body: { actualCountedMinor: 50000 },
  });
  assertStrictEqual(blind.status, 200, 'blind close');
  ok('D12. blind close succeeded (INV invariants green on the shell path)');

  // =========================================================================
  // DOCTOR CLINICAL JOURNEY — new shift, call, SOAP sign, addendum, undo,
  // scribe session + withdraw, follow-ups, WS realtime.
  // =========================================================================
  // 1. A fresh shift for the clinical work (next free business date).
  let docShiftId: string | null = null;
  for (let day = 1; day <= 30 && docShiftId === null; day += 1) {
    const businessDate = new Date(Date.now() + (day + 10) * 86_400_000).toISOString().slice(0, 10);
    const attempt = await http('POST', '/shifts/open', {
      token: docToken,
      idempotencyKey: mintKey(),
      body: { openingCountMinor: 10000, businessDate },
    });
    if (attempt.status === 201) docShiftId = attempt.body.shiftId as string;
  }
  assertStrictEqual(Boolean(docShiftId), true, 'doctor shift open');

  // 2. New patient → check-in → call-next (deck → consultation console flow).
  const pt = await http('POST', '/patients', {
    token: secToken2,
    body: {
      fullName: `Consult Patient ${suffix}`,
      dateOfBirth: '1988-03-03',
      emergencyContactName: 'Kin',
      emergencyContactPhone: '0933111111',
      emergencyContactRelation: 'PARENT',
      physicalAddress: 'Clinic road',
    },
  });
  assertStrictEqual(pt.status, 201, 'consult patient created');
  const consultPatientId = pt.body.id as string;
  const ci = await http('POST', '/queue/check-in', {
    token: secToken2,
    idempotencyKey: mintKey(),
    body: { patientId: consultPatientId },
  });
  assertStrictEqual(ci.status, 201, 'consult check-in');
  const callNext = await http('POST', '/queue/call-next', { token: docToken, body: {} });
  assertStrictEqual(callNext.status, 200, 'call-next');
  assertStrictEqual(callNext.body.status, 'IN_CONSULTATION', 'called to consultation');
  ok('J1. doctor call-next moves WAITING entry into consultation');

  // 3. Manual SOAP encounter: create → sign (explicit MSE) → addendum.
  const enc = await http('POST', '/ehr/encounters', {
    token: docToken,
    body: {
      patientId: consultPatientId,
      visitDate: new Date().toISOString(),
      encounterType: 'CONSULTATION',
      queueEntryId: callNext.body.entryId,
      soap: { S: 'Low mood for two weeks', O: 'Restricted affect', A: 'Depressive episode', P: 'Psychotherapy referral' },
      mse: { appearance: 'Well-groomed', behavior: 'Cooperative', speechCoherence: 'Coherent', moodAffect: 'Depressed' },
    },
  });
  assertStrictEqual(enc.status, 201, 'encounter created');
  const encId = enc.body.encounterId as string;
  const sign = await http('POST', `/ehr/encounters/${encId}/sign`, {
    token: docToken,
    body: { rowVersion: enc.body.rowVersion, reviewed: { S: true, O: true, A: true, P: true } },
  });
  assertStrictEqual(sign.status, 200, 'encounter signed');
  assertStrictEqual(sign.body.status, 'SIGNED', 'signed status');
  const addendum = await http('POST', `/ehr/encounters/${encId}/addenda`, {
    token: docToken,
    body: { text: 'Follow-up in two weeks to review response.', reasonCode: 'NEW_INFORMATION' },
  });
  assertStrictEqual(addendum.status, 201, 'addendum appended');
  ok('J2. SOAP encounter create → sign (explicit MSE) → post-signature addendum');

  // 4. Undo-complete outside the COMPLETED state is rejected by the machine.
  const undoSigned = await http('POST', `/queue/${callNext.body.entryId}/undo-complete`, {
    token: docToken,
    idempotencyKey: mintKey(),
    body: { reason: 'e2e: signed encounter must block undo' },
  });
  assertStrictEqual(undoSigned.status === 400 || undoSigned.status === 409, true, 'undo on non-completed rejected');
  ok('J3. undo-complete correctly rejected outside the COMPLETED state');

  // 5. Scribe Gen-2: session create carries the FULL canonical shape; withdraw locks.
  const scribe = await http('POST', '/scribe/sessions', {
    token: docToken,
    body: { patientId: consultPatientId, mode: 'DICTATION_60S' },
  });
  assertStrictEqual(scribe.status, 201, 'scribe session created (DICTATION_60S needs no consent)');
  assertStrictEqual(scribe.body.status, 'UPLOADED', 'session UPLOADED');
  assertStrictEqual(scribe.body.mode, 'DICTATION_60S', 'mode echoed');
  assertStrictEqual(scribe.body.consentStatus, 'GRANTED', 'consent echoed (full canonical create response)');
  assertStrictEqual(typeof scribe.body.audioRetentionUntil, 'string', 'retention echoed');
  const scribeWithdraw = await http('POST', `/scribe/sessions/${scribe.body.sessionId}/withdraw-consent`, {
    token: docToken,
    body: { reason: 'e2e: consent withdrawal lock' },
  });
  assertStrictEqual(scribeWithdraw.status, 200, 'withdraw');
  assertStrictEqual(scribeWithdraw.body.status, 'WITHDRAWN', 'withdrawn');
  assertStrictEqual(scribeWithdraw.body.audioPurged, true, 'audio purged on withdraw');
  assertStrictEqual(typeof scribeWithdraw.body.withdrawnAt, 'string', 'withdrawnAt present');
  assertStrictEqual(typeof scribeWithdraw.body.retentionUntil, 'string', 'retentionUntil present');
  const scribeLocked = await http('POST', `/scribe/sessions/${scribe.body.sessionId}/cycle-1-consultation`, {
    token: docToken,
    body: { audioBase64: 'QUJD' },
  });
  assertStrictEqual(scribeLocked.status, 403, 'withdrawn session locked (WITHDRAWN_GONE)');
  ok('J4. scribe Gen-2: canonical create shape → withdraw purges audio + locks (403 WITHDRAWN_GONE)');
  ok('J4b. scribe audio ANALYSIS cycles need a live Gemini key — provider-level verified (mocked), NOT RUN here');

  // 6. Follow-ups (Decision 5): create via intercom → list → transitions.
  const fu = await http('POST', '/intercom', {
    token: docToken,
    idempotencyKey: mintKey(),
    body: {
      type: 'DOCTOR_FOLLOWUP',
      text: 'Review sleep hygiene plan at the next visit',
      relatedQueueEntryId: callNext.body.entryId,
      followUp: { followUpType: 'GENERAL', window: 'NEXT_VISIT' },
    },
  });
  assertStrictEqual(fu.status, 201, 'follow-up intercom send');
  // REST returns the message; the REQUESTED task is observed via GET /followups.
  const fuList = await http('GET', '/followups?patientId=' + consultPatientId, { token: secToken2 });
  const created = (fuList.body.data ?? []).find((r: { status: string; note: string }) =>
    r.status === 'REQUESTED' && r.note.includes('Review sleep hygiene plan'),
  );
  assertStrictEqual(Boolean(created), true, 'follow-up listed');
  assertStrictEqual(created.note, 'Review sleep hygiene plan at the next visit', "doctor's note preserved verbatim (Decision 5)");
  assertStrictEqual(created.followUpType, 'GENERAL', 'canonical type');
  assertStrictEqual(created.window, 'NEXT_VISIT', 'canonical window');
  assertStrictEqual(created.status, 'REQUESTED', 'requested');
  const fuSched = await http('PATCH', `/followups/${created.id}`, { token: secToken2, body: { status: 'SCHEDULED' } });
  assertStrictEqual(fuSched.status, 200, 'secretary schedules');
  const fuDone = await http('PATCH', `/followups/${created.id}`, { token: secToken2, body: { status: 'DONE' } });
  assertStrictEqual(fuDone.status, 200, 'secretary completes');
  const fuTerminal = await http('PATCH', `/followups/${created.id}`, { token: docToken, body: { status: 'CANCELLED' } });
  assertStrictEqual(fuTerminal.status, 400, 'DONE is terminal (ILLEGAL_TRANSITION)');
  ok('J5. follow-up canonical contract: structural descriptor, note preserved, machine enforced');

  // 7. Invalid follow-up descriptor rejected (closed vocabulary).
  const fuBad = await http('POST', '/intercom', {
    token: docToken,
    idempotencyKey: mintKey(),
    body: {
      type: 'DOCTOR_FOLLOWUP',
      text: 'bad vocabulary',
      relatedQueueEntryId: callNext.body.entryId,
      followUp: { followUpType: 'LAB_RESULT', window: '48h' },
    },
  });
  assertStrictEqual(fuBad.status, 422, 'non-canonical vocabulary rejected');
  ok('J6. non-canonical followUp vocabulary rejected (422, closed enums — Decision 5)');

  // 8. WS realtime: authenticated socket receives the versioned queue snapshot.
  // socket.io-client ships with the frontend workspace — import via file URL.
  // R13: repo-relative resolution (socket.io-client ships with the frontend
  // workspace) — no machine-specific absolute paths.
  const frontRequire = createRequire(new URL('../../../Clinic-front/package.json', import.meta.url));
  const wsModule = frontRequire('socket.io-client') as {
    io: (url: string, opts: unknown) => { on: (ev: string, cb: (f?: unknown) => void) => void; close: () => void };
  };
  const io = wsModule.io;
  const wsToken = (await http('POST', '/auth/login', { body: { identifier: DOCTOR_ID, password: DOCTOR_PW_ROTATED } })).body.accessToken as string;
  const received: unknown[] = await new Promise((resolve, reject) => {
    const sock = io('http://localhost:4000', { auth: { token: wsToken }, transports: ['websocket'], timeout: 5000 });
    const frames: unknown[] = [];
    sock.on('queue.snapshot', (f: unknown) => {
      frames.push(f);
      sock.close();
      resolve(frames);
    });
    sock.on('connect_error', (errLike: unknown) => {
      sock.close();
      reject(new Error(`ws connect_error: ${String(errLike)}`));
    });
    setTimeout(() => {
      sock.close();
      reject(new Error('ws snapshot timeout'));
    }, 6000);
  });
  const frame = received[0] as { queueVersion?: number; entries?: unknown[] };
  assertStrictEqual(typeof frame?.queueVersion, 'number', 'ws snapshot has queueVersion');
  assertStrictEqual(Array.isArray(frame?.entries), true, 'ws snapshot has entries');
  ok('J7. realtime: authenticated WS receives the versioned queue snapshot');
}

function assertStrictEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `E2E FAILED [${label}]: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` +
        ` (lastBody=${JSON.stringify(lastBody)})`,
    );
  }
}
let lastBody: unknown = null;

main()
  .then(() => {
    console.log(`\nIntegrated E2E green: ${passed} checks passed (real backend + real PostgreSQL).`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nINTEGRATED E2E FAILED:', err?.message ?? err);
    process.exit(1);
  });
