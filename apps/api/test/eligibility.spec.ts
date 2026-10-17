// MOD-ELG Eligibility, unit level (owner: Dev 3). Permissions, headers and input validation run before any database call.
// Database behaviour is in eligibility.int.spec.ts.
import { ErrorEnvelope, type PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { rollUp, evaluateCriteria } from '../src/modules/origination/applications/eligibility';
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

describe('eligibility: permissions and headers (MOD-ELG)', () => {
  it('TEST-ELG-001 running and reading assessments need application.read (403 without)', async () => {
    const none = as('lead.read');
    expect(
      code(await request(none).post(`/v1/applications/${APP}/eligibility-assessments`).set(IDEM).send({})),
    ).toBe('FORBIDDEN');
    expect(code(await request(none).get(`/v1/applications/${APP}/eligibility-assessments`))).toBe(
      'FORBIDDEN',
    );
  });

  it('TEST-ELG-002 an override needs eligibility.override; application.read is not enough', async () => {
    const res = await request(as('application.read'))
      .post(`/v1/eligibility-assessments/${ELG}/overrides`)
      .set(IDEM)
      .send({ productVersionId: 'prv_x_1', reason: 'A reason that is long enough' });
    expect(res.status).toBe(403);
  });

  it('TEST-ELG-003 running an assessment or an override without an Idempotency-Key is 400', async () => {
    const run = await request(as('application.read'))
      .post(`/v1/applications/${APP}/eligibility-assessments`)
      .send({});
    expect(run.status).toBe(400);
    const over = await request(as('eligibility.override'))
      .post(`/v1/eligibility-assessments/${ELG}/overrides`)
      .send({ productVersionId: 'prv_x_1', reason: 'A reason that is long enough' });
    expect(over.status).toBe(400);
  });

  it('TEST-ELG-004 an override with a short reason, or an unknown field, is 422 before any database call', async () => {
    const approver = as('eligibility.override');
    const url = `/v1/eligibility-assessments/${ELG}/overrides`;
    expect(
      (await request(approver).post(url).set(IDEM).send({ productVersionId: 'prv_x_1', reason: 'short' }))
        .status,
    ).toBe(422);
    expect(
      (
        await request(approver)
          .post(url)
          .set(IDEM)
          .send({ productVersionId: 'prv_x_1', reason: 'A reason that is long enough', extra: 1 })
      ).status,
    ).toBe(422);
  });
});

describe('eligibility: result rules', () => {
  it('TEST-ELG-005 with no rule set every criterion is UNKNOWN and the product result is UNKNOWN', () => {
    const criteria = evaluateCriteria({}, 'prv_x_1');
    expect(criteria.every((c) => c.result === 'UNKNOWN')).toBe(true);
    expect(rollUp(criteria)).toBe('UNKNOWN');
  });

  it('TEST-ELG-006 roll-up: any FAIL fails; all PASS passes; a mix with UNKNOWN is UNKNOWN; none is UNKNOWN', () => {
    const c = (result: 'PASS' | 'FAIL' | 'UNKNOWN') => ({ code: 'X', result, reason: '' });
    expect(rollUp([c('PASS'), c('FAIL'), c('UNKNOWN')])).toBe('FAIL');
    expect(rollUp([c('PASS'), c('PASS')])).toBe('PASS');
    expect(rollUp([c('PASS'), c('UNKNOWN')])).toBe('UNKNOWN');
    expect(rollUp([])).toBe('UNKNOWN');
  });
});
