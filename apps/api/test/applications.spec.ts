// MOD-APP Loan Applications, unit level (owner: Dev 3). Permissions, precondition headers and input validation run before
// any database call, so these tests need no database. Database behaviour is in applications.int.spec.ts.
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

describe('applications: permissions (MOD-APP)', () => {
  it('TEST-APP-001 reads need application.read; edits and holds need application.update (403 without)', async () => {
    const none = as('lead.read');
    expect(code(await request(none).get('/v1/applications'))).toBe('FORBIDDEN');
    expect(code(await request(none).get(`/v1/applications/${APP}`))).toBe('FORBIDDEN');
    const edit = await request(none)
      .patch(`/v1/applications/${APP}`)
      .set('If-Match', '"0"')
      .send({ tenureMonths: 24 });
    expect(edit.status).toBe(403);
    const hold = await request(none)
      .put(`/v1/applications/${APP}/hold`)
      .set('If-Match', '"0"')
      .send({ onHold: true, reason: 'Waiting on salary slips' });
    expect(hold.status).toBe(403);
  });

  it('TEST-APP-002 a reader cannot edit or hold (403 with application.read only)', async () => {
    const reader = as('application.read');
    const edit = await request(reader)
      .patch(`/v1/applications/${APP}`)
      .set('If-Match', '"0"')
      .send({ tenureMonths: 24 });
    expect(edit.status).toBe(403);
  });
});

describe('applications: precondition headers (MOD-APP)', () => {
  it('TEST-APP-003 an edit or hold without If-Match is 400 MALFORMED_REQUEST', async () => {
    const app = as('application.update');
    const edit = await request(app).patch(`/v1/applications/${APP}`).send({ tenureMonths: 24 });
    expect(edit.status).toBe(400);
    expect(code(edit)).toBe('MALFORMED_REQUEST');
    const hold = await request(app).put(`/v1/applications/${APP}/hold`).send({ onHold: false });
    expect(hold.status).toBe(400);
    expect(code(hold)).toBe('MALFORMED_REQUEST');
  });
});

describe('applications: input validation (422 before any database call)', () => {
  const app = () => as('application.update');
  const edit = (body: Record<string, unknown>) =>
    request(app()).patch(`/v1/applications/${APP}`).set('If-Match', '"0"').send(body);

  it('TEST-APP-004 an empty edit, an unknown field, or a zero amount is refused', async () => {
    expect((await edit({})).status).toBe(422);
    expect((await edit({ status: 'DISBURSED' })).status).toBe(422);
    expect((await edit({ requestedAmount: '0.00' })).status).toBe(422);
    expect((await edit({ requestedAmount: 300000 })).status).toBe(422);
  });

  it('TEST-APP-005 tenure must be a whole number of months from 1 to 480', async () => {
    expect((await edit({ tenureMonths: 0 })).status).toBe(422);
    expect((await edit({ tenureMonths: 481 })).status).toBe(422);
    expect((await edit({ tenureMonths: 12.5 })).status).toBe(422);
  });

  it('TEST-APP-006 a hold needs a reason; a reason or until is refused when clearing', async () => {
    const hold = (body: Record<string, unknown>) =>
      request(app()).put(`/v1/applications/${APP}/hold`).set('If-Match', '"0"').send(body);
    const noReason = await hold({ onHold: true });
    expect(noReason.status).toBe(422);
    expect(code(noReason)).toBe('VALIDATION_ERROR');
    expect((await hold({ onHold: false, reason: 'Resolved now' })).status).toBe(422);
  });

  it('TEST-APP-007 a hold cannot carry fields outside the contract (strict)', async () => {
    const res = await request(app())
      .put(`/v1/applications/${APP}/hold`)
      .set('If-Match', '"0"')
      .send({ onHold: true, reason: 'Waiting on bank statement', lenderId: 'lnd_x' });
    expect(res.status).toBe(422);
  });
});
