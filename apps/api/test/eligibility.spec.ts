// MOD-ELG Eligibility, unit level (owner: Dev 3). Permissions, headers and input validation run before any database call.
// Database behaviour is in eligibility.int.spec.ts; the decision rules are in eligibility-rules.spec.ts.
import { ErrorEnvelope, type PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const as = (...codes: PermissionCode[]) =>
  createTestApp({
    auth: fakeAuth(
      testPrincipal({ grants: codes.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] })) }),
    ),
  });
const code = (res: request.Response) => ErrorEnvelope.parse(res.body).error.code;
const APP = 'app_01HZX0000000000000000000AA';
const ELG = 'elg_01HZX0000000000000000000AA';
const IDEM = { 'Idempotency-Key': 'elg-unit-1' };
const IF_MATCH = { 'If-Match': '"0"' };

describe('eligibility: permissions and headers (MOD-ELG)', () => {
  it('TEST-ELG-001 running an assessment needs application.update and reading needs application.read (403 without)', async () => {
    const none = as('lead.read');
    expect(
      code(await request(none).post(`/v1/applications/${APP}/eligibility-assessments`).set(IDEM).send({})),
    ).toBe('FORBIDDEN');
    expect(code(await request(none).get(`/v1/applications/${APP}/eligibility-assessments`))).toBe(
      'FORBIDDEN',
    );
    expect(code(await request(none).get(`/v1/applications/${APP}/eligibility-assessments/latest`))).toBe(
      'FORBIDDEN',
    );
  });

  it('TEST-ELG-001b a reader cannot run an assessment: application.read alone is refused (403)', async () => {
    const res = await request(as('application.read'))
      .post(`/v1/applications/${APP}/eligibility-assessments`)
      .set(IDEM)
      .send({});
    expect(res.status).toBe(403);
    expect(code(res)).toBe('FORBIDDEN');
  });

  it('TEST-ELG-002 an override needs eligibility.override; application.read or application.update is not enough', async () => {
    for (const held of ['application.read', 'application.update'] as PermissionCode[]) {
      const res = await request(as(held))
        .post(`/v1/eligibility-assessments/${ELG}/overrides`)
        .set(IDEM)
        .send({ productVersionId: 'prv_x_1', reason: 'A reason that is long enough' });
      expect(res.status, held).toBe(403);
    }
  });

  it('TEST-ELG-003 running an assessment or an override without an Idempotency-Key is 400', async () => {
    const run = await request(as('application.update'))
      .post(`/v1/applications/${APP}/eligibility-assessments`)
      .send({});
    expect(run.status).toBe(400);
    expect(code(run)).toBe('MALFORMED_REQUEST');
    const over = await request(as('eligibility.override'))
      .post(`/v1/eligibility-assessments/${ELG}/overrides`)
      .send({ productVersionId: 'prv_x_1', reason: 'A reason that is long enough' });
    expect(over.status).toBe(400);
  });

  it('TEST-ELG-004 an override with a short reason, a missing product version or an unknown field is 422 before any database call', async () => {
    const overrider = as('eligibility.override');
    const short = await request(overrider)
      .post(`/v1/eligibility-assessments/${ELG}/overrides`)
      .set(IDEM)
      .send({ productVersionId: 'prv_x_1', reason: 'short' });
    expect(short.status).toBe(422);
    const noVersion = await request(overrider)
      .post(`/v1/eligibility-assessments/${ELG}/overrides`)
      .set(IDEM)
      .send({ reason: 'A reason that is long enough' });
    expect(noVersion.status).toBe(422);
    const unknown = await request(overrider)
      .post(`/v1/eligibility-assessments/${ELG}/overrides`)
      .set(IDEM)
      .send({ productVersionId: 'prv_x_1', reason: 'A reason that is long enough', result: 'PASS' });
    expect(unknown.status).toBe(422);
  });
});

describe('eligibility: applicant figures (MOD-ELG inputs)', () => {
  it('TEST-ELG-005 reading or changing the figures needs application.update (403 without)', async () => {
    const reader = as('application.read');
    expect(code(await request(reader).get(`/v1/applications/${APP}/eligibility-inputs`))).toBe('FORBIDDEN');
    expect(
      code(
        await request(reader)
          .put(`/v1/applications/${APP}/eligibility-inputs`)
          .set(IF_MATCH)
          .send({
            declaredMonthlyIncome: { amount: '1.00', currency: 'INR' },
            declaredIncomeSource: 'APPLICANT_STATED',
          }),
      ),
    ).toBe('FORBIDDEN');
  });

  it('TEST-ELG-005b a change without the If-Match version is 400 before any database call', async () => {
    const res = await request(as('application.update'))
      .put(`/v1/applications/${APP}/eligibility-inputs`)
      .send({ declaredMonthlyIncome: null, declaredIncomeSource: null });
    expect(res.status).toBe(400);
    expect(code(res)).toBe('MALFORMED_REQUEST');
  });

  it('TEST-ELG-005c figures are validated: a declared income needs its source; a credit score must be 300 to 900; a report reference cannot hold a PAN', async () => {
    const editor = as('application.update');
    const put = (body: Record<string, unknown>) =>
      request(editor).put(`/v1/applications/${APP}/eligibility-inputs`).set(IF_MATCH).send(body);

    expect((await put({ declaredMonthlyIncome: { amount: '50000.00', currency: 'INR' } })).status).toBe(422);
    expect((await put({ declaredIncomeSource: 'APPLICANT_STATED' })).status).toBe(422);
    expect((await put({})).status).toBe(422);
    expect(
      (
        await put({
          credit: { score: 299, reportReference: 'RPT-1', reportDate: '2026-10-01' },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await put({
          credit: { score: 700, reportReference: 'PAN ABCDE1234F', reportDate: '2026-10-01' },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await put({
          verifiedMonthlyIncome: { amount: '50000', currency: 'INR', checklistItemId: 'chk_x_1' },
        })
      ).status,
    ).toBe(422);
  });
});

describe('eligibility: free text and dates are checked like the rest of the system (MOD-ELG)', () => {
  it('TEST-ELG-007 an override reason carrying a PAN, an Aadhaar number or an account number is refused (422), like other free text', async () => {
    const overrider = as('eligibility.override');
    for (const reason of [
      'Reviewed with PAN ABCDE1234F and the file',
      'Aadhaar 2345 6789 0123 checked by phone',
      'Account 123456789012 was the source',
    ]) {
      const res = await request(overrider)
        .post(`/v1/eligibility-assessments/${ELG}/overrides`)
        .set(IDEM)
        .send({ productVersionId: 'prv_x_1', reason });
      expect(res.status, reason).toBe(422);
      expect(code(res)).toBe('VALIDATION_ERROR');
    }
  });

  it('TEST-ELG-008 a credit report date that is not a real day (2026-02-31) is refused (422) before any database call', async () => {
    const res = await request(as('application.update'))
      .put(`/v1/applications/${APP}/eligibility-inputs`)
      .set(IF_MATCH)
      .send({ credit: { score: 700, reportReference: 'RPT-1', reportDate: '2026-02-31' } });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('VALIDATION_ERROR');
  });
});

describe('eligibility: the rule outcome is never a pass by default (MOD-ELG)', () => {
  it('TEST-ELG-006 an unknown field in the figures is refused (strict), so nothing outside the contract is stored', async () => {
    const res = await request(as('application.update'))
      .put(`/v1/applications/${APP}/eligibility-inputs`)
      .set(IF_MATCH)
      .send({ declaredMonthlyIncome: null, declaredIncomeSource: null, bureauScore: 812 });
    expect(res.status).toBe(422);
  });
});
