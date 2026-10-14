// MOD-PRD Products, PATCH /v1/products/{id} (API-PRD-006), unit level (owner: Dev 3). Permission, If-Match and input
// validation run before any database call. Database behaviour is in products-patch.int.spec.ts.
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
const PRODUCT = 'prd_01HZX0000000000000000000AA';

describe('products PATCH: permissions and concurrency (API-PRD-006)', () => {
  it('TEST-PRD-PATCH-001 is 403 without config.manage', async () => {
    const res = await request(as('lead.read'))
      .patch(`/v1/products/${PRODUCT}`)
      .set('If-Match', '"0"')
      .send({ name: 'Renamed Product' });
    expect(res.status).toBe(403);
    expect(code(res)).toBe('FORBIDDEN');
  });

  it('TEST-PRD-PATCH-002 is 400 MALFORMED_REQUEST without If-Match', async () => {
    const res = await request(as('config.manage'))
      .patch(`/v1/products/${PRODUCT}`)
      .send({ name: 'Renamed Product' });
    expect(res.status).toBe(400);
    expect(code(res)).toBe('MALFORMED_REQUEST');
  });
});

describe('products PATCH: input validation (422 before any database call)', () => {
  const patch = (body: Record<string, unknown>) =>
    request(as('config.manage')).patch(`/v1/products/${PRODUCT}`).set('If-Match', '"0"').send(body);

  it('TEST-PRD-PATCH-003 an empty body is refused', async () => {
    const res = await patch({});
    expect(res.status).toBe(422);
    expect(code(res)).toBe('VALIDATION_ERROR');
  });

  it('TEST-PRD-PATCH-004 the lender cannot be moved, and status is not patchable (use /status)', async () => {
    const lender = await patch({ lenderId: 'lnd_01HZX0000000000000000000AA' });
    expect(lender.status).toBe(422);
    const status = await patch({ status: 'INACTIVE' });
    expect(status.status).toBe(422);
  });

  it('TEST-PRD-PATCH-005 name, category and applicant types follow the same rules as create', async () => {
    const bad = [
      { name: 'A' },
      { name: 'Loan for ABCDE1234F' },
      { category: 'XX' },
      { applicantTypes: [] },
      { applicantTypes: ['SALARIED', 'NOT_A_TYPE'] },
      { secured: 'yes' },
      { nextReviewAt: '13-10-2027' },
    ];
    for (const body of bad) {
      const res = await patch(body);
      expect(res.status).toBe(422);
      expect(code(res)).toBe('VALIDATION_ERROR');
    }
  });
});

describe('products: delete is disabled (TEST-PRD-PATCH-006)', () => {
  it('there is no DELETE route for a product', async () => {
    const res = await request(as('config.manage')).delete(`/v1/products/${PRODUCT}`).set('If-Match', '"0"');
    expect(res.status).toBe(404);
  });
});
