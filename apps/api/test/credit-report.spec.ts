// apps/api/test/credit-report.spec.ts — P1-05: the HTTP side of the credit-bureau soft pull (API-CRP-001 to 003) that needs no database:
// authentication, permission, the customer id of the path, the Idempotency-Key, the request body and query, the age rule, and failing closed
// without a bureau or consent port. The run itself (consent, cache, vendor call, stored summary, idempotency, scope) is in
// credit-report.int.spec.ts, against PostgreSQL.
import { FakeBureauPullPort, FakeConsentPort } from '@dsa/contracts/fakes';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

// Synthetic values that appear nowhere else in the repository.
const PAN = 'QXZKW7391L';
const DOB = '1987-06-23';
const NAME = 'Sunita Devi Verma';
const CUSTOMER = 'cust_01M4V6DFM0TFA9D04QJTW32ETD';
const KEY = 'idem_crp_unit_0001';
const body = { bureau: 'CIBIL', name: NAME, pan: PAN, dateOfBirth: DOB };

const puller = testPrincipal({ grants: [{ code: 'credit_report.pull', scope: 'TENANT', branchIds: [] }] });
const reader = testPrincipal({ grants: [{ code: 'credit_report.read', scope: 'TENANT', branchIds: [] }] });
const nobody = testPrincipal({ grants: [{ code: 'verification.read', scope: 'TENANT', branchIds: [] }] });

function appWith(principal = puller) {
  const bureau = new FakeBureauPullPort();
  const app = createTestApp({
    auth: fakeAuth(principal),
    deps: { bureauPort: bureau, consentPort: new FakeConsentPort() },
  });
  return { app, bureau };
}

const post = (
  app: ReturnType<typeof createTestApp>,
  payload: unknown = body,
  key: string | null = KEY,
  customer = CUSTOMER,
) => {
  const req = request(app).post(`/v1/customers/${customer}/credit-reports`);
  if (key !== null) req.set('Idempotency-Key', key);
  return req.send(payload as object);
};

describe('P1-05 POST /v1/customers/{id}/credit-reports (API-CRP-001): before the database', () => {
  it('P1-05 answers 401 without a token', async () => {
    const res = await request(createTestApp())
      .post(`/v1/customers/${CUSTOMER}/credit-reports`)
      .set('Idempotency-Key', KEY)
      .send(body);

    expect(res.status).toBe(401);
  });

  it('P1-05 answers 403 FORBIDDEN without credit_report.pull (reading is not enough) and never reaches the bureau', async () => {
    for (const principal of [nobody, reader]) {
      const { app, bureau } = appWith(principal);

      const res = await post(app);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(bureau.requests).toHaveLength(0);
    }
  });

  it('P1-05 the permission is checked before the body is read: a user without it learns nothing about the body', async () => {
    const { app } = appWith(nobody);

    const res = await post(app, { bureau: 'NOPE', extra: PAN });

    expect(res.status).toBe(403);
    expect(res.text).not.toContain(PAN);
  });

  it('P1-05 a customer id that cannot be an id is 404, like an unknown customer, and is never echoed', async () => {
    const { app, bureau } = appWith();

    for (const id of ['x'.repeat(65), 'a%20b', 'a.b', 'ab;cd']) {
      const res = await post(app, body, KEY, id);
      expect(res.status, id).toBe(404);
      expect(res.body.error.code, id).toBe('NOT_FOUND');
      expect(res.text, id).not.toContain(id);
    }
    expect(bureau.requests).toHaveLength(0);
  });

  it('P1-05 requires an Idempotency-Key: missing or malformed is 422 VALIDATION_ERROR', async () => {
    const { app, bureau } = appWith();

    const missing = await post(app, body, null);
    expect(missing.status).toBe(422);
    expect(missing.body.error.details).toEqual([{ field: 'Idempotency-Key', issue: 'REQUIRED' }]);
    for (const key of ['short', 'has spaces in it!', 'x'.repeat(129)]) {
      const res = await post(app, body, key);
      expect(res.status, key).toBe(422);
      expect(res.body.error.details, key).toEqual([{ field: 'Idempotency-Key', issue: 'INVALID_FORMAT' }]);
    }
    expect(bureau.requests).toHaveLength(0);
  });

  it('P1-05 refuses a bad body with 422, never echoes what was typed, and never reaches the bureau', async () => {
    const { app, bureau } = appWith();
    const bad: [string, unknown, string][] = [
      ['a PAN with a digit missing', { ...body, pan: 'QXZKW739L' }, 'QXZKW739L'],
      ['a date written the other way round', { ...body, dateOfBirth: '23-06-1987' }, '23-06-1987'],
      ['a date that does not exist', { ...body, dateOfBirth: '1987-02-30' }, '1987-02-30'],
      ['an unknown bureau', { ...body, bureau: 'TRANSUNION' }, 'TRANSUNION'],
      ['no bureau', { ...body, bureau: undefined }, 'zzz-not-in-the-response'],
      ['no name', { ...body, name: undefined }, 'zzz-not-in-the-response'],
      ['a PAN typed into the name', { ...body, name: `Sunita ${PAN}` }, PAN],
      ['an account number typed into the name', { ...body, name: 'Sunita 731904826517' }, '731904826517'],
      ['an Aadhaar number as an extra key', { ...body, aadhaar: '123456789012' }, '123456789012'],
      ['a mobile as an extra key', { ...body, mobile: '9876543210' }, '9876543210'],
      [
        'a consent id stated by the caller',
        { ...body, consentRecordId: 'cnst_01M4V6DFM0TFA9D04QJTW32ETD' },
        'cnst_01M4V6DFM0TFA9D04QJTW32ETD',
      ],
      ['a score stated by the caller', { ...body, score: 900 }, 'zzz-not-in-the-response'],
    ];
    for (const [label, payload, typed] of bad) {
      const res = await post(app, payload);
      expect(res.status, label).toBe(422);
      expect(res.body.error.code, label).toBe('VALIDATION_ERROR');
      expect(res.text, label).not.toContain(typed);
    }
    expect(bureau.requests).toHaveLength(0);
  });

  it('P1-05 refuses a date of birth that makes the person younger than 18 or older than 100 (422 INVALID_AGE) before the bureau, and does not echo it', async () => {
    const { app, bureau } = appWith();
    const year = new Date().getUTCFullYear();
    for (const dateOfBirth of [`${year - 5}-03-15`, `${year}-01-01`, '1900-01-01', `${year + 1}-01-01`]) {
      const res = await post(app, { ...body, dateOfBirth });

      expect(res.status, dateOfBirth).toBe(422);
      expect(res.body.error.details, dateOfBirth).toEqual([{ field: 'dateOfBirth', issue: 'INVALID_AGE' }]);
      expect(res.text, dateOfBirth).not.toContain(dateOfBirth);
    }
    expect(bureau.requests).toHaveLength(0);
  });

  it('P1-05 fails closed with 503 DEPENDENCY_UNAVAILABLE when the server has no bureau port, or no consent port', async () => {
    const noBureau = createTestApp({ auth: fakeAuth(puller), deps: { consentPort: new FakeConsentPort() } });
    const noConsent = createTestApp({
      auth: fakeAuth(puller),
      deps: { bureauPort: new FakeBureauPullPort() },
    });

    for (const app of [noBureau, noConsent]) {
      const res = await post(app);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    }
  });
});

describe('P1-05 GET /v1/customers/{id}/credit-reports/latest and the list (API-CRP-002, API-CRP-003): before the database', () => {
  const urls = [
    `/v1/customers/${CUSTOMER}/credit-reports/latest`,
    `/v1/customers/${CUSTOMER}/credit-reports`,
  ];

  it('P1-05 answer 401 without a token', async () => {
    for (const url of urls) expect((await request(createTestApp()).get(url)).status, url).toBe(401);
  });

  it('P1-05 answer 403 without credit_report.read (pulling is not enough)', async () => {
    for (const principal of [nobody, puller]) {
      const { app } = appWith(principal);
      for (const url of urls) {
        const res = await request(app).get(url);
        expect(res.status, url).toBe(403);
        expect(res.body.error.code, url).toBe('FORBIDDEN');
      }
    }
  });

  it('P1-05 a customer id that cannot be an id is 404', async () => {
    const { app } = appWith(reader);

    for (const url of [
      `/v1/customers/${'x'.repeat(65)}/credit-reports/latest`,
      `/v1/customers/a.b/credit-reports`,
    ]) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(404);
    }
  });

  it('P1-05 refuse an unknown bureau, an unknown query key on latest, a limit over 200 and a bad cursor with 422', async () => {
    const { app } = appWith(reader);
    const bad = [
      `/v1/customers/${CUSTOMER}/credit-reports/latest?bureau=TRANSUNION`,
      `/v1/customers/${CUSTOMER}/credit-reports/latest?limit=5`,
      `/v1/customers/${CUSTOMER}/credit-reports?bureau=TRANSUNION`,
      `/v1/customers/${CUSTOMER}/credit-reports?limit=201`,
      `/v1/customers/${CUSTOMER}/credit-reports?limit=0`,
    ];
    for (const url of bad) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(422);
      expect(res.body.error.code, url).toBe('VALIDATION_ERROR');
    }
  });
});
