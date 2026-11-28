// TEST-SEC-001 cases for application collateral (owner: Bhushan, task P1-03, migration 0111). A tenant B principal with every
// application permission must not list, add, edit or remove tenant A collateral: each answers 404 and the row is unchanged. The full
// behaviour is in apps/api/test/collateral.int.spec.ts.
import type { PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_ADMIN, startIsolationEnv, type IsolationEnv } from '../harness';

let env: IsolationEnv;
const APP_A = 'app_iso_col_a1';
const COL_A = 'acol_iso_col_a1';
const APP_CODES: PermissionCode[] = ['application.read', 'application.update'];

beforeAll(async () => {
  env = await startIsolationEnv();
  const a = env.A;
  await env.admin.query(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ('cust_iso_col_a1', $1, 'INDIVIDUAL', 'Isolation Borrower', $2, $3, $3)`,
    [a.tenantId, a.branchId, a.userIds[0]],
  );
  await env.admin.query(
    `insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, requested_amount,
        applicant_type, sales_owner_id, created_by, updated_by)
     values ($1, $2, $3, 'cust_iso_col_a1', 'HL', 3750000.00, 'SALARIED', $4, $4, $4)`,
    [APP_A, a.tenantId, a.branchId, a.userIds[0]],
  );
  await env.admin.query(
    `insert into app.application_collateral (id, tenant_id, application_id, property_type, address_line1, city, state, pincode,
        estimated_market_value_paise, ownership_type, created_by, updated_by)
     values ($1, $2, $3, 'RESIDENTIAL_FLAT', 'Flat 12, Shanti Heights', 'Pune', 'Maharashtra', '411045', 500000000, 'FREEHOLD', $4, $4)`,
    [COL_A, a.tenantId, APP_A, a.userIds[0]],
  );
});
afterAll(async () => {
  await env?.stop();
});

describe('TEST-SEC-001 application collateral: tenants never cross', () => {
  it('API-APP-COL-001..004: tenant B cannot list, add, edit or remove tenant A collateral (404), and the row is unchanged', async () => {
    const a = env.appAs(env.A, APP_CODES);
    const own = await request(a).get(`/v1/applications/${APP_A}/collateral`);
    expect(own.status).toBe(200);
    expect(own.body.data.map((c: { id: string }) => c.id)).toEqual([COL_A]);

    const b = env.appAs(env.B, [...ALL_ADMIN, ...APP_CODES]);
    expect((await request(b).get(`/v1/applications/${APP_A}/collateral`)).status).toBe(404);
    const add = await request(b)
      .post(`/v1/applications/${APP_A}/collateral`)
      .set('Idempotency-Key', `iso-col-${Math.random().toString(36).slice(2, 10)}`)
      .send({
        propertyType: 'COMMERCIAL',
        addressLine1: 'Shop 3, Market Yard',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411037',
        estimatedMarketValue: { amount: '1000000.00', currency: 'INR' },
        ownershipType: 'FREEHOLD',
      });
    expect(add.status).toBe(404);
    const edit = await request(b)
      .patch(`/v1/applications/${APP_A}/collateral/${COL_A}`)
      .set('If-Match', '"0"')
      .send({ city: 'Mumbai' });
    expect(edit.status).toBe(404);
    const del = await request(b)
      .delete(`/v1/applications/${APP_A}/collateral/${COL_A}`)
      .set('If-Match', '"0"');
    expect(del.status).toBe(404);

    const rows = await env.admin.query(
      `select city, removed_at, lock_version from app.application_collateral where application_id = $1`,
      [APP_A],
    );
    expect(rows.rows).toEqual([{ city: 'Pune', removed_at: null, lock_version: 0 }]);
  });
});
