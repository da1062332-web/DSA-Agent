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

  it('an unknown transition code is refused (built: T-APP-01 to 05 and 07 to 10; T-APP-06 is the lender roll-up)', async () => {
    for (const transitionCode of ['T-APP-06', 'T-APP-11', 'WITHDRAW']) {
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

describe('transitions: withdraw (T-APP-08) and reopen (T-APP-09) rules (TEST-APP-TRN-004)', () => {
  const REASON = 'Customer no longer needs the loan';

  it('TEST-APP-TRN-004-01 T-APP-08 needs application.withdraw; cancel or update rights are not enough', async () => {
    for (const held of [
      'application.cancel',
      'application.update',
      'application.reopen',
    ] as PermissionCode[]) {
      const res = await send(as(held), { transitionCode: 'T-APP-08', reason: REASON });
      expect(res.status, held).toBe(403);
      expect(code(res)).toBe('FORBIDDEN');
    }
  });

  it('TEST-APP-TRN-004-02 T-APP-09 needs application.reopen; withdraw or update rights are not enough', async () => {
    for (const held of [
      'application.withdraw',
      'application.update',
      'application.cancel',
    ] as PermissionCode[]) {
      const res = await send(as(held), { transitionCode: 'T-APP-09', reason: 'Customer came back' });
      expect(res.status, held).toBe(403);
      expect(code(res)).toBe('FORBIDDEN');
    }
  });

  it('TEST-APP-TRN-004-03 both need a reason of 5 to 200 characters', async () => {
    const withdraw = as('application.withdraw');
    const reopen = as('application.reopen');
    for (const [app, transitionCode] of [
      [withdraw, 'T-APP-08'],
      [reopen, 'T-APP-09'],
    ] as const) {
      expect((await send(app, { transitionCode })).status, `${transitionCode} without a reason`).toBe(422);
      expect((await send(app, { transitionCode, reason: 'abc' })).status, `${transitionCode} too short`).toBe(
        422,
      );
      expect(
        (await send(app, { transitionCode, reason: 'x'.repeat(201) })).status,
        `${transitionCode} too long`,
      ).toBe(422);
    }
  });

  it('TEST-APP-TRN-004-04 the reason must not carry a PAN, an Aadhaar number or an account number', async () => {
    const withdraw = as('application.withdraw');
    for (const reason of ['Customer PAN ABCDE1234F', 'Aadhaar 2345 6789 0123', 'Account 123456789012']) {
      const res = await send(withdraw, { transitionCode: 'T-APP-08', reason });
      expect(res.status, reason).toBe(422);
      expect(code(res)).toBe('VALIDATION_ERROR');
    }
  });

  it('TEST-APP-TRN-004-05 a withdraw or reopen cannot carry a cancel reason, and a cancel cannot carry a free reason (strict)', async () => {
    expect(
      (
        await send(as('application.withdraw'), {
          transitionCode: 'T-APP-08',
          reason: REASON,
          cancelReason: 'OTHER',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await send(as('application.reopen'), {
          transitionCode: 'T-APP-09',
          reason: REASON,
          cancelReason: 'OTHER',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await send(as('application.cancel'), {
          transitionCode: 'T-APP-10',
          cancelReason: 'OTHER',
          reason: REASON,
        })
      ).status,
    ).toBe(422);
  });
});

describe('transitions: rework (T-APP-03), send back (T-APP-05) and close (T-APP-07) rules (TEST-APP-TRN-005)', () => {
  const REASON = 'Bank statement is for the wrong period';

  it('TEST-APP-TRN-005-01 T-APP-03 and T-APP-05 need application.review; update or cancel rights are not enough', async () => {
    for (const transitionCode of ['T-APP-03', 'T-APP-05']) {
      for (const held of [
        'application.update',
        'application.cancel',
        'application.close',
      ] as PermissionCode[]) {
        const res = await send(as(held), { transitionCode, reason: REASON });
        expect(res.status, `${transitionCode} with ${held}`).toBe(403);
        expect(code(res)).toBe('FORBIDDEN');
      }
    }
  });

  it('TEST-APP-TRN-005-02 T-APP-07 needs application.close; review, cancel or reopen rights are not enough', async () => {
    for (const held of [
      'application.review',
      'application.cancel',
      'application.reopen',
    ] as PermissionCode[]) {
      const res = await send(as(held), { transitionCode: 'T-APP-07' });
      expect(res.status, held).toBe(403);
      expect(code(res)).toBe('FORBIDDEN');
    }
  });

  it('TEST-APP-TRN-005-03 a rework or send back needs a reason of 5 to 200 characters without PAN, Aadhaar or account numbers', async () => {
    const review = as('application.review');
    for (const transitionCode of ['T-APP-03', 'T-APP-05']) {
      for (const body of [
        {},
        { reason: 'abc' },
        { reason: 'x'.repeat(201) },
        { reason: 'Customer PAN ABCDE1234F' },
        { reason: 'Account 123456789012' },
      ]) {
        const res = await send(review, { transitionCode, ...body });
        expect(res.status, `${transitionCode} ${JSON.stringify(body)}`).toBe(422);
        expect(code(res)).toBe('VALIDATION_ERROR');
      }
    }
  });

  it('TEST-APP-TRN-005-04 a close reason is optional but checked; fields of other transitions are refused (strict)', async () => {
    const close = as('application.close');
    expect((await send(close, { transitionCode: 'T-APP-07', reason: 'abc' })).status).toBe(422);
    expect((await send(close, { transitionCode: 'T-APP-07', cancelReason: 'OTHER' })).status).toBe(422);
    expect(
      (
        await send(as('application.review'), {
          transitionCode: 'T-APP-03',
          reason: REASON,
          productVersionId: 'prv_1',
        })
      ).status,
    ).toBe(422);
  });
});
