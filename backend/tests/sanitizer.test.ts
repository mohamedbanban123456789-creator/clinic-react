import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { AppError } from '../src/common/errors/AppError.js';
import type { AuthContext } from '../src/common/middleware/authenticate.js';
import { requireRole } from '../src/common/middleware/requireRole.js';
import { isSecretSafe, markSecretSafe } from '../src/common/types/secretSafe.js';
import { sanitizeSecretaryResponses, scanForbiddenKeys } from '../src/common/middleware/sanitize.js';
import { toSecretSettingsDto } from '../src/modules/clinic-settings/settings.dto.js';
import { toMeDto } from '../src/modules/auth-users/auth.dto.js';

function mockReq(role?: 'DOCTOR' | 'SECRETARY'): Request {
  const req = { method: 'GET', originalUrl: '/probe', path: '/probe' } as Request;
  if (role !== undefined) {
    const auth: AuthContext = { userId: 'u1', role, tokenVersion: 1, mustChangePassword: false };
    (req as Request & { auth: AuthContext }).auth = auth;
  }
  return req;
}

function mockRes(capture: { body: unknown; status: number }): Response {
  const res = {
    statusCode: 200,
    json(body: unknown): Response {
      capture.body = body;
      return res as Response;
    },
    status(code: number): Response {
      capture.status = code;
      return res as Response;
    },
  } as unknown as Response;
  return res;
}

/** 1. requireRole: W5 role-first + generic 403 (no existence oracle). */
{
  let touchedParams = false;
  const req = mockReq('SECRETARY');
  Object.defineProperty(req, 'params', {
    get(): Record<string, string> {
      touchedParams = true;
      return {};
    },
  });
  let forwarded: unknown = 'none';
  requireRole('DOCTOR')(req, mockRes({ body: null, status: 200 }), (err?: unknown) => {
    forwarded = err;
  });
  assert.ok(forwarded instanceof AppError);
  const err = forwarded as AppError;
  assert.equal(err.code, 'FORBIDDEN');
  assert.equal(err.statusCode, 403);
  assert.equal(err.message, 'Access denied for role');
  assert.deepEqual([...err.details], []);
  assert.equal(touchedParams, false, 'W5: no resource lookup before role check');
}

/** 1b. match passes; missing auth is 401 (never 403 oracle). */
{
  let passed = false;
  requireRole('DOCTOR', 'SECRETARY')(mockReq('SECRETARY'), mockRes({ body: null, status: 200 }), (err?: unknown) => {
    assert.equal(err, undefined);
    passed = true;
  });
  assert.equal(passed, true);
  let unauth: unknown = null;
  requireRole('DOCTOR')(mockReq(), mockRes({ body: null, status: 200 }), (err?: unknown) => {
    unauth = err;
  });
  assert.ok(unauth instanceof AppError && unauth.code === 'UNAUTHORIZED');
}


/** 2. Oracle denylist: every listed key (incl. soap and mse prefixes) is caught. */
{
  const oracleKeys = [
    'content', 'drugName', 'dosage', 'frequency', 'instructions', 'cessationReason',
    'addendumText', 'signedEncounterId', 'scribeDraftId', 'origin', 'transcript',
    'transcriptReference', 'audioReference', 'audioRef', 'ciphertext', 'wrappedDek',
    'nonce', 'soapSubjective', 'soapObjective', 'mseAppearance', 'mseMood',
    'diagnoses', 'prescriptions', 'medications', 'psychotherapyNotes', 'therapyNoteFinal',
    'vaultCipher', 'scribeDraftBody', 'assessment', 'clinicalSummary', 'failureReason',
    'consentStatus',
  ];
  for (const key of oracleKeys) {
    const scan = scanForbiddenKeys({ id: 'x', [key]: 'probe-value' });
    assert.equal(scan.forbidden, true, `oracle key must be forbidden: ${key}`);
  }
  const nested = scanForbiddenKeys({ data: [{ queue: { soapPlan: 'x', items: [{ consentGiven: true }] } }] });
  assert.equal(nested.forbidden, true);
  const settings = toSecretSettingsDto({
    standardFeeMinor: 1, currency: 'USD', avgConsultDurationMin: 1, openingFloatMinor: 0,
    secretaryMaxDiscountMinor: 0, secretaryMaxDiscountPct: 0, audioRetentionDays: 30,
  });
  const me = toMeDto({ id: 'u1', name: 'Sec', role: 'SECRETARY', lastLoginAt: null, passwordMustChange: false });
  assert.equal(isSecretSafe(settings), true);
  assert.equal(isSecretSafe(me), true);
  assert.equal(scanForbiddenKeys(settings).forbidden, false);
  assert.equal(scanForbiddenKeys(me).forbidden, false);
}
/** 3. Sanitizer: branded SECRETARY passes; raw/unbranded fails closed. */
{
  const settings = toSecretSettingsDto({
    standardFeeMinor: 1, currency: 'USD', avgConsultDurationMin: 1, openingFloatMinor: 0,
    secretaryMaxDiscountMinor: 0, secretaryMaxDiscountPct: 0, audioRetentionDays: 30,
  });
  const reqOk = mockReq('SECRETARY');
  const okCap: { body: unknown; status: number } = { body: null, status: 200 };
  const resOk = mockRes(okCap);
  let nextCalled = false;
  sanitizeSecretaryResponses(reqOk, resOk, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  resOk.json(settings);
  assert.deepEqual(JSON.parse(JSON.stringify(okCap.body)), JSON.parse(JSON.stringify(settings)));

  const reqBad = mockReq('SECRETARY');
  const badCap: { body: unknown; status: number } = { body: null, status: 200 };
  const resBad = mockRes(badCap);
  sanitizeSecretaryResponses(reqBad, resBad, () => undefined);
  resBad.json(markSecretSafe({ id: 'q1', soapPlan: 'leak', transcriptReference: 't1' }));
  const blocked = badCap.body as { error: { code: string; message: string; details: unknown[] } };
  assert.equal(blocked.error.code, 'INTERNAL');
  assert.deepEqual(blocked.error.details, []);
  assert.match(blocked.error.message, /requestId=/);
  assert.equal(JSON.stringify(badCap.body)?.includes('leak'), false);

  const reqRaw = mockReq('SECRETARY');
  const rawCap: { body: unknown; status: number } = { body: null, status: 200 };
  const resRaw = mockRes(rawCap);
  sanitizeSecretaryResponses(reqRaw, resRaw, () => undefined);
  resRaw.json({ id: 'q1', status: 'WAITING' });
  assert.equal((rawCap.body as { error: { code: string } }).error.code, 'INTERNAL');

  const reqDoc = mockReq('DOCTOR');
  const docCap: { body: unknown; status: number } = { body: null, status: 200 };
  const resDoc = mockRes(docCap);
  sanitizeSecretaryResponses(reqDoc, resDoc, () => undefined);
  const clinical = { soapPlan: 'doctor-only' };
  resDoc.json(clinical);
  assert.deepEqual(docCap.body, clinical);
}

// eslint-disable-next-line no-console
console.log('BE-103 sanitizer oracle green.');

