// Connector workspace reads (MOD-CON) against a real database: the dashboard summary, a connector's referrals and its activity.
// Visibility and permissions decide what each caller sees (TEST-CINS). Synthetic data only.
import crypto from 'node:crypto';
import type { PermissionCode, Principal } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { createProductionDeps } from '../src/wiring';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import { fakeAuth, testPrincipal } from './support/fake-auth';

let env: IsolationEnv;
const RM_ID = 'usr_ci_rm1'; // relationship owner of CON_MINE
const RM2_ID = 'usr_ci_rm2'; // relationship owner of CON_OTHER
const MANAGER_ID = 'usr_ci_mgr';
const CON_MINE = 'con_ci_mine';
const CON_OTHER = 'con_ci_other';
const CUST = 'cust_ci_1';
const APP_CI = 'app_ci_1';
const h = (s: string) => crypto.createHash('sha256').update(s).digest();

const as = (id: string, grants: PermissionCode[], overrides: Partial<Principal> = {}) =>
  createApp({
    deps: createProductionDeps(createTxRunner(env.db)),
    corsAllowedOrigins: [],
    auth: fakeAuth(
      testPrincipal({
        id,
        tenantId: env.A.tenantId,
        primaryBranchId: env.A.branchId,
        authTime: new Date().toISOString(),
        grants: grants.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] })),
        ...overrides,
      }),
    ),
  });

/** A relationship manager: connector.read and lead.read, and the connectors it owns only. */
const rm = (id: string) => as(id, ['connector.read', 'lead.read']);
/** Tenant management: sees every connector, reads referrals, disputes and earnings. */
const manager = () =>
  as(MANAGER_ID, [
    'connector.manage',
    'connector.read',
    'lead.read',
    'connector.dispute_resolve',
    'finance.view',
  ]);

beforeAll(async () => {
  env = await startIsolationEnv();
  const a = env.A;
  const q = (text: string, values: unknown[]) => env.admin.query(text, values);

  for (const [id, email] of [
    [MANAGER_ID, 'mgr@ci.example.com'],
    [RM_ID, 'rm1@ci.example.com'],
    [RM2_ID, 'rm2@ci.example.com'],
  ] as const) {
    await q(
      `insert into app.app_user (id, tenant_id, idp_subject, email, display_name, primary_branch_id, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, 'iso', 'iso')`,
      [id, a.tenantId, `sub-${id}`, email, `Staff ${id}`, a.branchId],
    );
  }

  const connector = (id: string, owner: string, status: string, n: number) =>
    q(
      `insert into app.connector (id, tenant_id, connector_type, legal_name, contact_person, mobile_e164, mobile_hash, email, email_hash,
                                  encrypted_pan, pan_hash, pan_masked, primary_branch_id, relationship_owner_user_id, status,
                                  created_by, updated_by)
       values ($1, $2, 'INDIVIDUAL', $3, 'Synthetic Contact', $4, $5, $6, $7, $8, $9, 'XXXXX1234X', $10, $11, $12, 'iso', 'iso')`,
      [
        id,
        a.tenantId,
        `Synthetic Workspace Partner ${n}`,
        `+91987650300${n}`,
        h(`m-${id}`),
        `${id}@ci.example.com`,
        h(`e-${id}`),
        Buffer.from('synthetic'),
        h(`p-${id}`),
        a.branchId,
        owner,
        status,
      ],
    );
  await connector(CON_MINE, RM_ID, 'ACTIVE', 1);
  await connector(CON_OTHER, RM2_ID, 'PENDING_VERIFICATION', 2);

  await q(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Workspace Customer', $3, $4, $4)`,
    [CUST, a.tenantId, a.branchId, a.userIds[0]],
  );
  const lead = (id: string, connectorId: string, state: string, owner: string | null, n: number) =>
    q(
      `insert into app.lead (id, tenant_id, branch_id, full_name, mobile_e164, mobile_hash, product_category, source, state,
                             owner_user_id, connector_id, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, 'PL', 'REFERRAL', $7, $8, $9, 'iso', 'iso')`,
      [
        id,
        a.tenantId,
        a.branchId,
        `Referred Person ${n}`,
        `+91987650400${n}`,
        h(`lead-${id}`),
        state,
        owner,
        connectorId,
      ],
    );
  await lead('lead_ci_new', CON_MINE, 'NEW', RM_ID, 1);
  // A converted lead names its customer and application, and the application names the lead back, so the foreign keys are
  // checked after both exist. The check constraints still apply to the rows.
  await q(`set session_replication_role = replica`, []);
  await q(
    `insert into app.lead (id, tenant_id, branch_id, full_name, mobile_e164, mobile_hash, product_category, source, state,
                           customer_id, application_id, connector_id, qual_applicant_type, qual_requested_amount,
                           created_by, updated_by)
     values ('lead_ci_conv', $1, $2, 'Referred Person 2', '+919876504002', $3, 'PL', 'REFERRAL', 'CONVERTED', $4, $5, $6,
             'SALARIED', 300000, 'iso', 'iso')`,
    [a.tenantId, a.branchId, h('lead-lead_ci_conv'), CUST, APP_CI, CON_MINE],
  );
  await lead('lead_ci_other', CON_OTHER, 'NEW', RM2_ID, 3);
  await q(
    `insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, requested_amount,
                                       applicant_type, status, sales_owner_id, lead_id, created_by, updated_by)
     values ($1, $2, $3, $4, 'PL', 300000, 'SALARIED', 'DRAFT', $5, 'lead_ci_conv', $5, $5)`,
    [APP_CI, a.tenantId, a.branchId, CUST, a.userIds[0]],
  );

  // Activity: the connector's own event, and one for the other connector. Payloads are stored and must not be returned.
  for (const [id, entity, actor, reason] of [
    ['aud_ci_mine', CON_MINE, RM_ID, 'Contact details refreshed'],
    ['aud_ci_other', CON_OTHER, RM2_ID, 'Not this connector'],
  ] as const) {
    await q(
      `insert into app.audit_event (id, tenant_id, actor_type, actor_id, action, entity_type, entity_id, correlation_id, reason, before, after)
       values ($1, $2, 'USER', $3, 'connector.updated', 'connector', $4, 'corr_ci', $5, '{"legalName":"old"}', '{"legalName":"new"}')`,
      [id, a.tenantId, actor, entity, reason],
    );
  }

  // Earnings for CON_MINE: payable records, inserted with the foreign keys off as the portal fixture does.
  await q(`set session_replication_role = replica`, []);
  for (const [id, state, amount] of [
    ['cpay_ci_1', 'ELIGIBLE', '100.00'],
    ['cpay_ci_2', 'PAID', '250.00'],
  ] as const) {
    await q(
      `insert into app.commission_payable (id, tenant_id, calculation_id, connector_id, share_rate, amount, state, created_by, updated_by)
       values ($1, $2, 'ccal_ci_1', $3, 0.5, $4, $5, 'iso', 'iso')`,
      [id, a.tenantId, CON_MINE, amount, state],
    );
  }
  await q(`set session_replication_role = origin`, []);
}, 240_000);

afterAll(async () => {
  await env?.stop();
});

describe('connector workspace reads (TEST-CINS)', () => {
  it('TEST-CINS-01 a relationship manager sees the summary of its own connectors only, with no disputes or earnings it may not read', async () => {
    const res = await request(rm(RM_ID)).get('/v1/connectors/summary');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.connectors.total).toBe(1);
    expect(res.body.connectors.byStatus).toMatchObject({ ACTIVE: 1, PENDING_VERIFICATION: 0 });
    expect(res.body.referrals).toEqual({ total: 2, pending: 1, converted: 1 });
    expect(res.body.disputes).toEqual({ attributionOpen: null, partnerOpen: null });
    expect(res.body.earnings).toBeNull();
  });

  it('TEST-CINS-02 tenant management sees every connector, the open disputes and the earnings of the connectors it can see', async () => {
    const res = await request(manager()).get('/v1/connectors/summary');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.connectors.total).toBe(2);
    expect(res.body.connectors.byStatus).toMatchObject({ ACTIVE: 1, PENDING_VERIFICATION: 1 });
    expect(res.body.referrals).toEqual({ total: 3, pending: 2, converted: 1 });
    expect(res.body.disputes).toEqual({ attributionOpen: 0, partnerOpen: 0 });
    expect(res.body.earnings).toEqual({
      currency: 'INR',
      expected: '100.00',
      approved: '0.00',
      paid: '250.00',
      held: '0.00',
    });
  });

  it('TEST-CINS-03 the date range narrows the counts, and a range that ends before it starts is refused', async () => {
    const future = await request(manager()).get('/v1/connectors/summary?from=2030-01-01T00:00:00.000Z');
    expect(future.status).toBe(200);
    expect(future.body.connectors.total).toBe(0);
    expect(future.body.referrals.total).toBe(0);
    const inverted = await request(manager()).get(
      '/v1/connectors/summary?from=2031-01-01T00:00:00.000Z&to=2030-01-01T00:00:00.000Z',
    );
    expect(inverted.status).toBe(422);
  });

  it('TEST-CINS-04 a connector’s referrals show the customer’s name and the application, never the mobile number, and another manager’s connector is not found', async () => {
    const own = await request(rm(RM_ID)).get(`/v1/connectors/${CON_MINE}/referrals`);
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(own.body.items).toHaveLength(2);
    for (const item of own.body.items) {
      expect(item).not.toHaveProperty('mobile');
      expect(item).not.toHaveProperty('mobileE164');
      expect(item.customerName).toMatch(/^Referred Person/);
    }
    const converted = own.body.items.find((i: { id: string }) => i.id === 'lead_ci_conv');
    expect(converted).toMatchObject({
      state: 'CONVERTED',
      applicationId: APP_CI,
      applicationStatus: 'DRAFT',
    });

    const other = await request(rm(RM2_ID)).get(`/v1/connectors/${CON_MINE}/referrals`);
    expect(other.status).toBe(404);

    const noLead = await request(as(RM_ID, ['connector.read'])).get(`/v1/connectors/${CON_MINE}/referrals`);
    expect(noLead.status).toBe(403);
  });

  it('TEST-CINS-05 a connector’s activity lists its own events and not another connector’s, and returns no payloads', async () => {
    const res = await request(rm(RM_ID)).get(`/v1/connectors/${CON_MINE}/activity`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ids = res.body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain('aud_ci_mine');
    expect(ids).not.toContain('aud_ci_other');
    const mine = res.body.items.find((i: { id: string }) => i.id === 'aud_ci_mine');
    expect(mine).toMatchObject({
      action: 'connector.updated',
      actorName: `Staff ${RM_ID}`,
      reason: 'Contact details refreshed',
    });
    for (const item of res.body.items) {
      expect(item).not.toHaveProperty('before');
      expect(item).not.toHaveProperty('after');
    }
    const other = await request(rm(RM2_ID)).get(`/v1/connectors/${CON_MINE}/activity`);
    expect(other.status).toBe(404);
  });

  it('TEST-CINS-06 a connector’s own login is refused every workspace read on the internal API', async () => {
    const portal = as('usr_ci_portal', [], { userType: 'CONNECTOR' });
    for (const path of [
      '/v1/connectors/summary',
      `/v1/connectors/${CON_MINE}/referrals`,
      `/v1/connectors/${CON_MINE}/activity`,
    ]) {
      const res = await request(portal).get(path);
      expect(res.status, path).toBe(403);
      expect(res.body.error.details?.[0]).toMatchObject({ issue: 'CONNECTOR_IDENTITY_NOT_ALLOWED' });
    }
  });

  it('TEST-CINS-07 reactivating a suspended connector through activation needs a stated reason, checked before the verification record', async () => {
    const h = (s: string) => crypto.createHash('sha256').update(s).digest();
    await env.admin.query(
      `insert into app.connector (id, tenant_id, connector_type, legal_name, contact_person, mobile_e164, mobile_hash, email, email_hash,
                                  encrypted_pan, pan_hash, pan_masked, primary_branch_id, relationship_owner_user_id, status,
                                  created_by, updated_by)
       values ('con_ci_susp', $1, 'INDIVIDUAL', 'Synthetic Suspended Partner', 'Synthetic Contact', '+919876503099', $2, 'susp@ci.example.com',
               $3, $4, $5, 'XXXXX1234X', $6, $7, 'SUSPENDED', 'iso', 'iso')`,
      [
        env.A.tenantId,
        h('m-susp'),
        h('e-susp'),
        Buffer.from('synthetic'),
        h('p-susp'),
        env.A.branchId,
        RM_ID,
      ],
    );
    const body = { verificationId: 'ver_01JZ0000000000000000000000' };
    const activate = (key: string, remarks?: string) =>
      request(manager())
        .post('/v1/connectors/con_ci_susp/activation')
        .set('Idempotency-Key', key)
        .set('If-Match', '"0"')
        .send(remarks === undefined ? body : { ...body, remarks });

    const none = await activate('ci_act_000001');
    expect(none.status, JSON.stringify(none.body)).toBe(422);
    expect(none.body.error.details?.[0]).toMatchObject({ field: 'remarks', issue: 'REQUIRED' });

    const short = await activate('ci_act_000002', 'ok');
    expect(short.status).toBe(422);
    expect(short.body.error.details?.[0]).toMatchObject({ field: 'remarks', issue: 'REQUIRED' });

    // With a reason, the reason is no longer the problem: the verification record is what is checked next.
    const reasoned = await activate('ci_act_000003', 'Partner re-verified its KYC documents');
    expect(reasoned.status).toBe(422);
    expect(reasoned.body.error.message).toMatch(/Referenced verification record does not exist/);
    const still = await env.admin.query(`select status from app.connector where id = 'con_ci_susp'`);
    expect(still.rows[0].status).toBe('SUSPENDED');
  });
});
