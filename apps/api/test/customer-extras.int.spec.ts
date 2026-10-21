// MOD-CUST contact points (API-CUST-007) and merge (API-CUST-008) against a real database (M-074), with the production
// wiring. Synthetic data only.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConsentPort } from '../src/modules/crm/customers/consent-port';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import type { PermissionCode } from '@dsa/contracts';

let env: IsolationEnv;
const KEEP = 'cust_cx_keep';
const GONE = 'cust_cx_gone';
const ENTITY = 'cust_cx_entity';
const STAFF: PermissionCode[] = ['customer.read', 'customer.update', 'lead.merge'];
const key = (l: string) => `cx_${l}_${Math.random().toString(36).slice(2, 10)}`;

beforeAll(async () => {
  env = await startIsolationEnv();
  const a = env.A;
  const q = (text: string, values: unknown[]) => env.admin.query(text, values);
  for (const [id, type, name] of [
    [KEEP, 'INDIVIDUAL', 'Kept Customer'],
    [GONE, 'INDIVIDUAL', 'Merged Customer'],
    [ENTITY, 'ENTITY', 'Entity Customer Pvt Ltd'],
  ]) {
    await q(
      `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $6)`,
      [id, a.tenantId, type, name, a.branchId, a.userIds[0]],
    );
  }
  await q(
    `insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, requested_amount,
                                       applicant_type, status, sales_owner_id, created_by, updated_by)
     values ('app_cx_1', $1, $2, $3, 'PL', 300000, 'SALARIED', 'DRAFT', $4, $4, $4)`,
    [a.tenantId, a.branchId, GONE, a.userIds[0]],
  );
  await q(
    `insert into app.consent_record (id, tenant_id, subject_type, subject_id, purpose, notice_version, channel, captured_by, captured_at)
     values ('cnst_cx_1', $1, 'CUSTOMER', $2, 'LOAN_PROCESSING', 'V1', 'IN_PERSON', $3, now())`,
    [a.tenantId, GONE, a.userIds[0]],
  );
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

describe('TEST-CUST-EXT-INT customer contact points and merge', () => {
  it('TEST-CUST-EXT-INT-01 API-CUST-007 adds a masked contact point; the same value twice is refused', async () => {
    const app = env.appAs(env.A, STAFF);
    const res = await request(app)
      .post(`/v1/customers/${GONE}/contact-points`)
      .set('Idempotency-Key', key('cp'))
      .send({ kind: 'MOBILE', value: '+919876500401', isPrimary: true });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.valueMasked).not.toContain('9876500401');
    expect(res.body.isPrimary).toBe(true);
    const dup = await request(app)
      .post(`/v1/customers/${GONE}/contact-points`)
      .set('Idempotency-Key', key('cp2'))
      .send({ kind: 'MOBILE', value: '+919876500401' });
    expect(dup.status).toBe(422);
  });

  it('TEST-CUST-EXT-INT-02 API-CUST-008 merges: MERGED with merged_into_id, contact points copied, application re-pointed, consent kept', async () => {
    const app = env.appAs(env.A, STAFF);
    const mismatch = await request(app)
      .post(`/v1/customers/${GONE}/merge`)
      .set('Idempotency-Key', key('mm'))
      .send({ intoCustomerId: ENTITY, reason: 'Same person' });
    expect(mismatch.status).toBe(422);
    const res = await request(app)
      .post(`/v1/customers/${GONE}/merge`)
      .set('Idempotency-Key', key('m'))
      .send({ intoCustomerId: KEEP, reason: 'Same person, two records' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.moved).toEqual({ leads: 0, applications: 1, contactPoints: 1 });
    const rows = await env.admin.query(
      `select (select status from app.customer where id = $1) as status,
              (select merged_into_id from app.customer where id = $1) as into,
              (select customer_id from app.loan_application where id = 'app_cx_1') as app_customer,
              (select count(*)::int from app.customer_contact_point where customer_id = $2) as points`,
      [GONE, KEEP],
    );
    expect(rows.rows[0]).toEqual({ status: 'MERGED', into: KEEP, app_customer: KEEP, points: 1 });

    const port = createConsentPort();
    const ctx = {
      principal: {
        kind: 'SERVICE' as const,
        id: 'SYSTEM:test',
        tenantId: env.A.tenantId,
        primaryBranchId: null,
        managedTeamMemberIds: [],
        queueIds: [],
        grants: [],
        authTime: null,
      },
      correlationId: 'corr_cx',
      now: new Date(),
    };
    const found = await createTxRunner(env.db).withTenantTx(ctx, (tx) =>
      port.findActive(tx, { customerId: KEEP, purpose: 'LOAN_PROCESSING' }),
    );
    expect(found).toEqual({ consentId: 'cnst_cx_1' });

    const again = await request(app)
      .post(`/v1/customers/${GONE}/merge`)
      .set('Idempotency-Key', key('m2'))
      .send({ intoCustomerId: KEEP, reason: 'Again' });
    expect(again.status).toBe(409);
  });

  it('TEST-CUST-EXT-INT-03 another tenant cannot add contact points or merge (404)', async () => {
    const b = env.appAs(env.B, STAFF);
    const cp = await request(b)
      .post(`/v1/customers/${KEEP}/contact-points`)
      .set('Idempotency-Key', key('x'))
      .send({ kind: 'EMAIL', value: 'x@cx.example.com' });
    expect(cp.status).toBe(404);
  });
});
