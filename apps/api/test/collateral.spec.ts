// TEST-APP-COL application collateral (task P1-03), unit level. Permissions, precondition headers and input validation run before
// any database call, so these tests need no database. Database behaviour, tenant isolation and the paise storage are in
// collateral.int.spec.ts. Synthetic data only.
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
const COL = 'acol_01HZX0000000000000000000AA';
const BODY = {
  propertyType: 'RESIDENTIAL_FLAT',
  addressLine1: 'Flat 12, Shanti Heights, Baner Road',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411045',
  estimatedMarketValue: { amount: '5000000.00', currency: 'INR' },
  ownershipType: 'FREEHOLD',
};

describe('TEST-APP-COL collateral: permissions', () => {
  it('TEST-APP-COL-001 reading needs application.read; adding, editing and removing need application.update', async () => {
    const none = as('lead.read');
    expect(code(await request(none).get(`/v1/applications/${APP}/collateral`))).toBe('FORBIDDEN');
    const reader = as('application.read');
    const add = await request(reader)
      .post(`/v1/applications/${APP}/collateral`)
      .set('Idempotency-Key', 'col-unit-0001')
      .send(BODY);
    expect(add.status).toBe(403);
    const edit = await request(reader)
      .patch(`/v1/applications/${APP}/collateral/${COL}`)
      .set('If-Match', '"0"')
      .send({ city: 'Mumbai' });
    expect(edit.status).toBe(403);
    const del = await request(reader)
      .delete(`/v1/applications/${APP}/collateral/${COL}`)
      .set('If-Match', '"0"');
    expect(del.status).toBe(403);
  });
});

describe('TEST-APP-COL collateral: precondition headers', () => {
  it('TEST-APP-COL-002 adding without Idempotency-Key, or editing or removing without If-Match, is 400 MALFORMED_REQUEST', async () => {
    const app = as('application.update');
    const add = await request(app).post(`/v1/applications/${APP}/collateral`).send(BODY);
    expect(add.status).toBe(400);
    expect(code(add)).toBe('MALFORMED_REQUEST');
    const edit = await request(app)
      .patch(`/v1/applications/${APP}/collateral/${COL}`)
      .send({ city: 'Mumbai' });
    expect(code(edit)).toBe('MALFORMED_REQUEST');
    const del = await request(app).delete(`/v1/applications/${APP}/collateral/${COL}`);
    expect(code(del)).toBe('MALFORMED_REQUEST');
  });
});

describe('TEST-APP-COL collateral: input validation (422 before any database call)', () => {
  const post = (body: Record<string, unknown>) =>
    request(as('application.update'))
      .post(`/v1/applications/${APP}/collateral`)
      .set('Idempotency-Key', `col-unit-${Math.random().toString(36).slice(2, 10)}`)
      .send(body);

  it('TEST-APP-COL-003 a value that is not INR money above zero is refused', async () => {
    for (const estimatedMarketValue of [
      { amount: '0.00', currency: 'INR' },
      { amount: '5000000.00', currency: 'USD' },
      { amount: 5000000, currency: 'INR' },
      { amount: '5000000', currency: 'INR' },
    ]) {
      const res = await post({ ...BODY, estimatedMarketValue });
      expect(res.status, JSON.stringify(estimatedMarketValue)).toBe(422);
      expect(code(res)).toBe('VALIDATION_ERROR');
    }
  });

  it('TEST-APP-COL-004 a PAN, Aadhaar or account number in the address, a bad pincode or an unknown field is refused', async () => {
    for (const body of [
      { ...BODY, addressLine1: 'Flat 12, owner ABCDE1234F' },
      { ...BODY, addressLine1: 'Plot 4, ref 2345 6789 0123' },
      { ...BODY, state: 'Maharashtra 123456789012' },
      { ...BODY, pincode: '41104' },
      { ...BODY, propertyType: 'AGRICULTURAL' },
      { ...BODY, ownerPan: 'ABCDE1234F' },
      { ...BODY, tenantId: 'ten_other' },
    ]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
  });

  it('TEST-APP-COL-005 an empty edit is refused', async () => {
    const res = await request(as('application.update'))
      .patch(`/v1/applications/${APP}/collateral/${COL}`)
      .set('If-Match', '"0"')
      .send({});
    expect(res.status).toBe(422);
  });
});
