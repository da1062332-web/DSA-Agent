// TEST-APP-HIST-INT the status journey of an application against a real database, with the production wiring. Synthetic data only.
import type { PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

let env: IsolationEnv;
const CUSTOMER = 'cust_hist_int_1';
const STAFF: PermissionCode[] = [
  'application.create',
  'application.read',
  'application.update',
  'application.cancel',
  'application.reopen',
];
const key = (l: string) => `hist_${l}_${Math.random().toString(36).slice(2, 10)}`;

beforeAll(async () => {
  env = await startIsolationEnv();
  await env.admin.query(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'History Borrower', $3, $4, $4)`,
    [CUSTOMER, env.A.tenantId, env.A.branchId, env.A.userIds[0]],
  );
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

describe('TEST-APP-HIST-INT status history', () => {
  it('TEST-APP-HIST-INT-01 lists creation, cancellation and reopening oldest first, with who, when and the reason', async () => {
    const app = env.appAs(env.A, STAFF);
    const created = await request(app)
      .post('/v1/applications')
      .set('Idempotency-Key', key('create'))
      .send({
        customerId: CUSTOMER,
        branchId: env.A.branchId,
        productCategory: 'HL',
        requestedAmount: { amount: '3750000.00', currency: 'INR' },
        applicantType: 'SALARIED',
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    const cancel = await request(app)
      .post(`/v1/applications/${id}/transitions`)
      .set('Idempotency-Key', key('cancel'))
      .set('If-Match', `"${created.body.version}"`)
      .send({ transitionCode: 'T-APP-10', cancelReason: 'CREATED_IN_ERROR' });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    const reopen = await request(app)
      .post(`/v1/applications/${id}/transitions`)
      .set('Idempotency-Key', key('reopen'))
      .set('If-Match', `"${cancel.body.version}"`)
      .send({ transitionCode: 'T-APP-09', reason: 'Opened against the wrong product' });
    expect(reopen.status, JSON.stringify(reopen.body)).toBe(200);

    const res = await request(app).get(`/v1/applications/${id}/status-history`);
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ nextCursor: null, limit: 200 });
    expect(
      res.body.data.map(
        (e: {
          fromStatus: string | null;
          toStatus: string;
          transitionCode: string;
          reason: string | null;
        }) => [e.fromStatus, e.toStatus, e.transitionCode, e.reason],
      ),
    ).toEqual([
      [null, 'DRAFT', 'CREATE', 'DIRECT'],
      ['DRAFT', 'CANCELLED', 'T-APP-10', 'CREATED_IN_ERROR'],
      ['CANCELLED', 'DRAFT', 'T-APP-09', 'Opened against the wrong product'],
    ]);
    for (const e of res.body.data) {
      expect(e.actorId).toBe(env.A.userIds[0]);
      expect(e.occurredAt).toMatch(/Z$/);
    }
  });

  it('TEST-APP-HIST-INT-02 an unknown application, or one of another tenant, is 404', async () => {
    const b = env.appAs(env.B, STAFF);
    expect((await request(b).get('/v1/applications/app_hist_missing/status-history')).status).toBe(404);
    const aList = await request(env.appAs(env.A, STAFF)).get('/v1/applications?limit=1');
    const aId = aList.body.data[0].id as string;
    expect((await request(b).get(`/v1/applications/${aId}/status-history`)).status).toBe(404);
  });
});
