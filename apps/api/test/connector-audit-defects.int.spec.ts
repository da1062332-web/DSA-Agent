// Regression tests for two P0 defects of the connector audit (docs/CONNECTOR_COMPREHENSIVE_AUDIT.md). Both were reproduced through the
// product's routes before the fix: the status route set a connector ACTIVE with no verification (AUD-P0-01), and the gateway route recorded an
// approved payout as paid with a reference the service invented (AUD-P0-02). The cases below assert the fixed behaviour and that the refused
// call changed nothing. Synthetic data only.
import crypto from 'node:crypto';
import type { PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { createProductionDeps } from '../src/wiring';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import { fakeAuth, testPrincipal } from './support/fake-auth';

let env: IsolationEnv;
const CON_PENDING = 'con_aud_pend';
const CON_ACTIVE = 'con_aud_active';
const PAYOUT = 'prq_aud_1';
const BATCH = 'pbt_aud_1';
const h = (s: string) => crypto.createHash('sha256').update(s).digest();

const as = (grants: PermissionCode[]) =>
  createApp({
    deps: createProductionDeps(createTxRunner(env.db)),
    corsAllowedOrigins: [],
    auth: fakeAuth(
      testPrincipal({
        id: env.A.userIds[0],
        tenantId: env.A.tenantId,
        primaryBranchId: env.A.branchId,
        authTime: new Date().toISOString(),
        grants: grants.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] })),
      }),
    ),
  });

const insertConnector = (id: string, status: string, mobile: string, email: string) =>
  env.admin.query(
    `insert into app.connector (id, tenant_id, connector_type, legal_name, contact_person, mobile_e164, mobile_hash, email, email_hash,
                                encrypted_pan, pan_hash, pan_masked, primary_branch_id, relationship_owner_user_id, status,
                                created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Synthetic Audit Connector', 'Synthetic Contact', $3, $4, $5, $6, $7, $8,
             'XXXXX1234X', $9, $10, $11, 'iso', 'iso')`,
    [
      id,
      env.A.tenantId,
      mobile,
      h(`m-${id}`),
      email,
      h(`e-${id}`),
      Buffer.from('synthetic'),
      h(`p-${id}`),
      env.A.branchId,
      env.A.userIds[0],
      status,
    ],
  );

const statusOf = async (id: string) =>
  (await env.admin.query(`select status from app.connector where id = $1`, [id])).rows[0].status as string;
const lockOf = async (id: string) =>
  (await env.admin.query(`select lock_version from app.connector where id = $1`, [id])).rows[0]
    .lock_version as number;
const payoutStatusOf = async (id: string) =>
  (await env.admin.query(`select status from app.payout_request where id = $1`, [id])).rows[0]
    .status as string;

beforeAll(async () => {
  env = await startIsolationEnv();
  const a = env.A;
  await insertConnector(CON_PENDING, 'PENDING_VERIFICATION', '+919876500901', 'aud@audit.example.com');
  // A connector that is already ACTIVE, set up as a fixture, so the legitimate SUSPENDED transition can be tested.
  await insertConnector(CON_ACTIVE, 'ACTIVE', '+919876500902', 'aud2@audit.example.com');
  await env.admin.query(
    `insert into app.payout_request (id, tenant_id, connector_id, origin, status, total, currency, submitted_by, submitted_at,
                                     created_by, updated_by)
     values ($1, $2, $3, 'CONNECTOR', 'APPROVED', '1500.00', 'INR', $4, now(), 'iso', 'iso')`,
    [PAYOUT, a.tenantId, CON_PENDING, a.userIds[0]],
  );
  await env.admin.query(
    `insert into app.payout_batch (id, tenant_id, payout_ids, status, generated_by)
     values ($1, $2, $3, 'GENERATED', $4)`,
    [BATCH, a.tenantId, [PAYOUT], a.userIds[0]],
  );
});

afterAll(async () => {
  await env?.stop();
});

describe('AUD-P0-01: the status route cannot activate a connector', () => {
  it('refuses ACTIVE with a message that points to the activation route, and the connector stays PENDING_VERIFICATION', async () => {
    const res = await request(as(['connector.manage']))
      .post(`/v1/connectors/${CON_PENDING}/status`)
      .set('If-Match', `"${await lockOf(CON_PENDING)}"`)
      .set('Idempotency-Key', 'aud-p0-01-1')
      .send({ targetStatus: 'ACTIVE', reason: 'Audit regression without verification' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/activation route/);
    expect(res.body.error.details?.[0]).toEqual({ field: 'targetStatus', issue: 'USE_ACTIVATION_ROUTE' });
    expect(await statusOf(CON_PENDING)).toBe('PENDING_VERIFICATION');
  });

  it('still accepts a legitimate suspension of an active connector', async () => {
    const res = await request(as(['connector.manage']))
      .post(`/v1/connectors/${CON_ACTIVE}/status`)
      .set('If-Match', `"${await lockOf(CON_ACTIVE)}"`)
      .set('Idempotency-Key', 'aud-p0-01-2')
      .send({ targetStatus: 'SUSPENDED', reason: 'Audit regression suspension' });

    expect(res.status).toBe(200);
    expect(await statusOf(CON_ACTIVE)).toBe('SUSPENDED');
  });

  it('the activation route still refuses a connector without a VERIFIED record of its own', async () => {
    const res = await request(as(['connector.manage']))
      .post(`/v1/connectors/${CON_PENDING}/activation`)
      .set('If-Match', `"${await lockOf(CON_PENDING)}"`)
      .set('Idempotency-Key', 'aud-p0-01-3')
      .send({ verificationId: 'ver_01AUDITMISSINGRECORD0000' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await statusOf(CON_PENDING)).toBe('PENDING_VERIFICATION');
  });
});

describe('AUD-P0-02: disbursement is refused without a bank transfer, and nothing is recorded', () => {
  it('the gateway route refuses with a clear reason, and the payout stays APPROVED with no reference returned', async () => {
    // Disbursing and recording the payment are two permissions; a user who holds both could otherwise complete the whole path.
    const res = await request(as(['payout.disburse', 'payout.record_payment']))
      .post(`/v1/payout-requests/${PAYOUT}/disburse-gateway`)
      .set('Idempotency-Key', 'aud-p0-02-1')
      .send({});

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(res.body.error.details?.[0]).toEqual({ issue: 'GATEWAY_NOT_CONFIGURED' });
    expect(res.body.utrNumber).toBeUndefined();
    expect(res.body.status).toBeUndefined();
    expect(await payoutStatusOf(PAYOUT)).toBe('APPROVED');
  });

  it('the batch gateway route refuses, the batch is not marked processed, and the payout stays APPROVED', async () => {
    const res = await request(as(['payout.disburse']))
      .post(`/v1/payout-batches/${BATCH}/dispatch-gateway`)
      .set('Idempotency-Key', 'aud-p0-02-2')
      .send({});

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    const batch = await env.admin.query(`select status from app.payout_batch where id = $1`, [BATCH]);
    expect(batch.rows[0].status).toBe('GENERATED');
    expect(await payoutStatusOf(PAYOUT)).toBe('APPROVED');
  });
});
