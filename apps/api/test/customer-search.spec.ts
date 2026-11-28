// TEST-CUST-SRCH customer search (2026-11-28), unit level: the permission and the body are checked before any database call. Matching,
// masking and isolation are in customer-search.int.spec.ts. Synthetic data only.
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

describe('TEST-CUST-SRCH customer search: input', () => {
  it('TEST-CUST-SRCH-001 a term shorter than 2 characters, an unknown field or a tenant id in the body is 422', async () => {
    const app = as('customer.read');
    for (const body of [{ query: 'a' }, { query: '  ' }, { query: 'ravi', tenantId: 'ten_x' }, {}]) {
      const res = await request(app).post('/v1/customers/search').send(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(code(res)).toBe('VALIDATION_ERROR');
    }
  });

  it('TEST-CUST-SRCH-002 without customer.read the search is refused (403)', async () => {
    const res = await request(as('lead.read')).post('/v1/customers/search').send({ query: 'ravi' });
    expect(res.status).toBe(403);
  });
});
