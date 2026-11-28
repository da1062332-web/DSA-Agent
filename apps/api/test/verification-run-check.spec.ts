// apps/api/test/verification-run-check.spec.ts — P1-06: the HTTP side of POST /v1/verifications/checks (API-VER-003) that needs no
// database: authentication, permission, the Idempotency-Key header, the request body, and failing closed without a KYC port. The run
// itself (consent, vendor call, stored record, idempotency) is in verification-kyc-check.int.spec.ts, against PostgreSQL.
import { FakeKycCheckPort } from '@dsa/contracts/fakes';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const PAN = 'QXZKW7391L';
const body = {
  check: 'PAN',
  subjectType: 'CUSTOMER',
  subjectId: 'cus_01M4V6DFM0TFA9D04QJTW32ETD',
  consentRecordId: 'cnst_01M4V6DFM0TFA9D04QJTW32ETD',
  idNumber: PAN,
};
const bankBody = {
  check: 'BANK_ACCOUNT',
  subjectType: 'CUSTOMER',
  subjectId: 'cus_01M4V6DFM0TFA9D04QJTW32ETD',
  consentRecordId: 'cnst_01M4V6DFM0TFA9D04QJTW32ETD',
  accountNumber: '918273645019',
  ifsc: 'HDFC0001234',
};
const KEY = 'idem_unit_test_0001';

const performer = testPrincipal({
  grants: [{ code: 'verification.perform', scope: 'TENANT', branchIds: [] }],
});
const readOnly = testPrincipal({ grants: [{ code: 'verification.read', scope: 'TENANT', branchIds: [] }] });

function appWith(principal = performer) {
  const kyc = new FakeKycCheckPort();
  const app = createTestApp({ auth: fakeAuth(principal), deps: { kycPort: kyc } });
  return { app, kyc };
}

const post = (app: ReturnType<typeof createTestApp>, payload: unknown = body, key: string | null = KEY) => {
  const req = request(app).post('/v1/verifications/checks');
  if (key !== null) req.set('Idempotency-Key', key);
  return req.send(payload as object);
};

describe('P1-06 POST /v1/verifications/checks (API-VER-003): before the database', () => {
  it('P1-06 answers 401 without a token', async () => {
    const res = await request(createTestApp())
      .post('/v1/verifications/checks')
      .set('Idempotency-Key', KEY)
      .send(body);

    expect(res.status).toBe(401);
  });

  it('P1-06 answers 403 FORBIDDEN without verification.perform and never reaches the provider', async () => {
    const { app, kyc } = appWith(readOnly);

    const res = await post(app);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(kyc.requests).toHaveLength(0);
  });

  it('P1-06 requires an Idempotency-Key: missing or malformed is 422 VALIDATION_ERROR', async () => {
    const { app, kyc } = appWith();

    const missing = await post(app, body, null);
    expect(missing.status).toBe(422);
    expect(missing.body.error.details).toEqual([{ field: 'Idempotency-Key', issue: 'REQUIRED' }]);

    for (const key of ['short', 'has spaces in it!', 'x'.repeat(129)]) {
      const res = await post(app, body, key);
      expect(res.status, key).toBe(422);
      expect(res.body.error.details, key).toEqual([{ field: 'Idempotency-Key', issue: 'INVALID_FORMAT' }]);
    }
    expect(kyc.requests).toHaveLength(0);
  });

  it('P1-06 refuses a bad body with 422, never echoes what was typed, and never reaches the provider', async () => {
    const { app, kyc } = appWith();
    const bad: [string, unknown, string][] = [
      ['a PAN with a digit missing', { ...body, idNumber: 'QXZKW739L' }, 'QXZKW739L'],
      ['a GSTIN given for a PAN check', { ...body, idNumber: '27QXZKW7391L1Z5' }, '27QXZKW7391L1Z5'],
      ['a PAN in the free-text name', { ...body, name: `Ravi ${PAN}` }, PAN],
      ['an Aadhaar-shaped number in the name', { ...body, name: 'Ravi 1234 5678 9012' }, '1234 5678 9012'],
      ['a check type that cannot be run yet', { ...body, check: 'BANK_STATEMENT' }, 'BANK_STATEMENT'],
      [
        'a bank check without an account number',
        { ...bankBody, accountNumber: undefined },
        'zzz-not-in-the-response',
      ],
      [
        'a bank check with an account number of 8 digits',
        { ...bankBody, accountNumber: '48201937' },
        '48201937',
      ],
      [
        'a bank check with letters in the account number',
        { ...bankBody, accountNumber: '4820AB193746' },
        '4820AB193746',
      ],
      [
        'a bank check with an IFSC whose fifth character is not zero',
        { ...bankBody, ifsc: 'HDFC1001234' },
        'HDFC1001234',
      ],
      ['a bank check without an IFSC', { ...bankBody, ifsc: undefined }, 'zzz-not-in-the-response'],
      ['a PAN given to a bank check', { ...bankBody, idNumber: PAN }, PAN],
      ['an account number given to a PAN check', { ...body, accountNumber: '482019374651' }, '482019374651'],
      [
        'an account number in the free-text name of a bank check',
        { ...bankBody, name: 'Sunita 482019374651' },
        '482019374651',
      ],
      [
        'a result stated by the caller of a bank check',
        { ...bankBody, result: 'VERIFIED' },
        'zzz-not-in-the-response',
      ],
      ['an Aadhaar number as an extra key', { ...body, aadhaar: '123456789012' }, '123456789012'],
      ['a result stated by the caller', { ...body, result: 'VERIFIED' }, 'zzz-not-in-the-response'],
      ['a method stated by the caller', { ...body, method: 'PROVIDER_AUTOMATED' }, 'zzz-not-in-the-response'],
      ['a consent id of the wrong shape', { ...body, consentRecordId: 'consent-1' }, 'consent-1'],
      ['no subject', { ...body, subjectId: undefined }, 'zzz-not-in-the-response'],
    ];
    for (const [label, payload, typed] of bad) {
      const res = await post(app, payload);
      expect(res.status, label).toBe(422);
      expect(res.body.error.code, label).toBe('VALIDATION_ERROR');
      expect(res.text, label).not.toContain(typed);
    }
    expect(kyc.requests).toHaveLength(0);
  });

  it('P1-06 fails closed with 503 DEPENDENCY_UNAVAILABLE when the server has no KYC port', async () => {
    const app = createTestApp({ auth: fakeAuth(performer) });

    const res = await post(app);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(res.text).not.toContain(PAN);
  });

  it('P1-06 the permission is checked before the body is read: a read-only user learns nothing about the body', async () => {
    const { app } = appWith(readOnly);

    const res = await post(app, { check: 'NOT-A-CHECK' }, null);

    expect(res.status).toBe(403);
  });
});

describe('P1-06 POST /v1/verifications cannot be used to forge a provider-automated record', () => {
  const manualBody = {
    subjectType: 'CUSTOMER',
    subjectId: 'cus_01M4V6DFM0TFA9D04QJTW32ETD',
    checkType: 'PAN',
    method: 'PROVIDER_AUTOMATED',
    purpose: 'KYC',
    consentRecordId: 'cnst_01M4V6DFM0TFA9D04QJTW32ETD',
    result: 'VERIFIED',
    minimalResult: { statusDescription: 'Typed by hand', maskedIdentifier: 'QXZKW****L' },
    evidenceRef: 'karza:typed-by-hand',
  };

  it('P1-06 answers 422 PROVIDER_AUTOMATED_IS_SERVER_ONLY for a hand-made automated record, and names the way to run a check', async () => {
    const { app } = appWith();

    const res = await request(app).post('/v1/verifications').set('Idempotency-Key', KEY).send(manualBody);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([{ field: 'method', issue: 'PROVIDER_AUTOMATED_IS_SERVER_ONLY' }]);
    expect(res.body.error.message).toContain('POST /v1/verifications/checks');
  });

  it('P1-06 a MANUAL record gets past the guard (it then needs the database, which this spec does not have)', async () => {
    const { app } = appWith();

    const res = await request(app)
      .post('/v1/verifications')
      .set('Idempotency-Key', KEY)
      .send({ ...manualBody, method: 'MANUAL' });

    // Not the guard's 422: the request went on to the transaction, which a unit test does not provide.
    expect(res.body.error?.details ?? []).not.toContainEqual({
      field: 'method',
      issue: 'PROVIDER_AUTOMATED_IS_SERVER_ONLY',
    });
  });
});
