// MOD-APP transitions, unit level (owner: Dev 3). Preconditions, permissions and input rules run before any database call.
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
const IDEM = { 'Idempotency-Key': 'trn-key-00000001' };
const send = (
  app: ReturnType<typeof as>,
  body: Record<string, unknown>,
  headers: Record<string, string> = { ...IDEM, 'If-Match': '"0"' },
) => {
  let r = request(app).post(`/v1/applications/${APP}/transitions`);
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return r.send(body);
};

describe('transitions: permission per transition (TEST-APP-TRN-001)', () => {
  it('T-APP-01 needs application.update', async () => {
    const res = await send(as('application.read'), { transitionCode: 'T-APP-01', productVersionId: 'prv_1' });
    expect(res.status).toBe(403);
    expect(code(res)).toBe('FORBIDDEN');
  });

  it('T-APP-02 needs application.review, not application.update', async () => {
    const res = await send(as('application.update'), { transitionCode: 'T-APP-02' });
    expect(res.status).toBe(403);
  });

  it('T-APP-10 needs application.cancel', async () => {
    const res = await send(as('application.update'), {
      transitionCode: 'T-APP-10',
      cancelReason: 'DUPLICATE',
    });
    expect(res.status).toBe(403);
  });
});

describe('transitions: preconditions (TEST-APP-TRN-002)', () => {
  it('a transition without If-Match is 400 MALFORMED_REQUEST', async () => {
    const res = await send(as('application.review'), { transitionCode: 'T-APP-02' }, IDEM);
    expect(res.status).toBe(400);
    expect(code(res)).toBe('MALFORMED_REQUEST');
  });

  it('a transition without Idempotency-Key is 400 MALFORMED_REQUEST', async () => {
    const res = await send(as('application.review'), { transitionCode: 'T-APP-02' }, { 'If-Match': '"0"' });
    expect(res.status).toBe(400);
    expect(code(res)).toBe('MALFORMED_REQUEST');
  });
});

describe('transitions: input rules (TEST-APP-TRN-003)', () => {
  const cancel = as('application.cancel');

  it('an unknown transition code is refused (only T-APP-01, 02 and 10 are built)', async () => {
    for (const transitionCode of ['T-APP-03', 'T-APP-11', 'WITHDRAW']) {
      const res = await send(cancel, { transitionCode });
      expect(res.status).toBe(422);
      expect(code(res)).toBe('VALIDATION_ERROR');
    }
  });

  it('a cancel needs a reason from the four agreed codes', async () => {
    expect((await send(cancel, { transitionCode: 'T-APP-10' })).status).toBe(422);
    expect((await send(cancel, { transitionCode: 'T-APP-10', cancelReason: 'BORED' })).status).toBe(422);
  });

  it('selecting a product needs a product version id', async () => {
    const res = await send(as('application.update'), { transitionCode: 'T-APP-01' });
    expect(res.status).toBe(422);
  });

  it('a transition cannot carry fields that belong to another transition (strict)', async () => {
    const res = await send(as('application.review'), { transitionCode: 'T-APP-02', cancelReason: 'OTHER' });
    expect(res.status).toBe(422);
  });
});
