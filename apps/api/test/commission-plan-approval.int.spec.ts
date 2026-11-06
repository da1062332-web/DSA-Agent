// Commission plan approval over HTTP, against a real database (Testcontainers, guarded config). The unit half is commission-plan-state.spec.ts.
// Covers: the approval route needs step-up (fresh second factor) and a refusal without it leaves the plan alone; a PATCH that names a status
// is refused; the edit and the approval are audited in app.audit_event; an ACTIVE plan is not edited or approved again; another tenant
// gets NOT_FOUND on every route and the plan is untouched. Synthetic data only.
import type { PermissionGrant } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { createProductionDeps } from '../src/wiring';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import { fakeAuth, testPrincipal } from './support/fake-auth';

let env: IsolationEnv;
const DRAFT = 'cpl_int_draft_1';
const DRAFT_B = 'cpl_int_draft_b';
const ACTIVE = 'cpl_int_active_1';
const CREATOR = 'usr_int_creator';
const CHECKER = 'usr_int_checker';
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  env = await startIsolationEnv();
  // Step-up is decided by the project setting and the token's MFA time. Both are set explicitly, so the test does not depend on the
  // machine it runs on. The developer switch is cleared for the same reason.
  for (const k of ['SUPABASE_MFA_ENABLED', 'DISABLE_MFA']) savedEnv[k] = process.env[k];
  process.env.SUPABASE_MFA_ENABLED = 'true';
  delete process.env.DISABLE_MFA;

  const a = env.A;
  // The lender and the creator are referenced by the plan; the seed skips the foreign-key checks, as the portal spec does.
  await env.admin.query(`set session_replication_role = replica`);
  // The database allows one ACTIVE plan per lender (uq_active_lender_plan), so the active seed has a lender of its own.
  const insert = (id: string, tenantId: string, lenderId: string, status: string) =>
    env.admin.query(
      `insert into app.commission_plan (id, tenant_id, lender_id, qualifying_event, basis, rounding_mode, clawback_window_days,
                                        rule_set_id, status, lock_version, created_at, created_by, updated_at, updated_by)
       values ($1, $2, $3, 'DISBURSEMENT', 'DISBURSED_AMOUNT', 'ROUND_HALF_UP', 90, null, $4, 0, now(), $5, now(), $5)`,
      [id, tenantId, lenderId, status, CREATOR],
    );
  await insert(DRAFT, a.tenantId, 'lnd_int_1', 'DRAFT');
  await insert(DRAFT_B, a.tenantId, 'lnd_int_3', 'DRAFT');
  await insert(ACTIVE, a.tenantId, 'lnd_int_2', 'ACTIVE');
  await env.admin.query(`set session_replication_role = origin`);
}, 240_000);

afterAll(async () => {
  for (const k of Object.keys(savedEnv)) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await env?.stop();
});

const tenantA = () => env.A.tenantId;
/** Each call is a request from a signed-in principal. `freshSecondFactor` decides whether its token carries a recent MFA time. */
function as(principal: ReturnType<typeof testPrincipal>) {
  return createApp({
    deps: createProductionDeps(createTxRunner(env.db)),
    corsAllowedOrigins: [],
    auth: fakeAuth(principal),
  });
}
const editor = () =>
  testPrincipal({
    id: CREATOR,
    tenantId: tenantA(),
    primaryBranchId: env.A.branchId,
    authTime: null,
    grants: [
      { code: 'commission.view', scope: 'TENANT', branchIds: [] },
      { code: 'commission.plan.edit', scope: 'TENANT', branchIds: [] },
    ],
  });
const checker = (freshSecondFactor: boolean) =>
  testPrincipal({
    id: CHECKER,
    tenantId: tenantA(),
    primaryBranchId: env.A.branchId,
    authTime: freshSecondFactor ? new Date().toISOString() : null,
    grants: [
      { code: 'commission.view', scope: 'TENANT', branchIds: [] },
      { code: 'commission.plan.approve', scope: 'TENANT', branchIds: [] },
    ],
  });

async function planRow(id: string) {
  const r = await env.admin.query(
    `select status, basis, lock_version from app.commission_plan where id = $1 and tenant_id = $2`,
    [id, tenantA()],
  );
  return r.rows[0] as { status: string; basis: string; lock_version: number };
}
async function auditActions(id: string) {
  const r = await env.admin.query(
    `select action, actor_id, permission_used from app.audit_event where entity_type = 'commission_plan' and entity_id = $1 order by seq`,
    [id],
  );
  return r.rows as { action: string; actor_id: string; permission_used: string | null }[];
}

describe('TEST-COMAPPR-INT commission plan approval over HTTP', () => {
  it('TEST-COMAPPR-INT-01 a PATCH that names ACTIVE is refused over HTTP, and the plan stays a DRAFT', async () => {
    const before = await planRow(DRAFT);
    const res = await request(as(editor()))
      .patch(`/v1/commission-plans/${DRAFT}`)
      .set('If-Match', `"${before.lock_version}"`)
      .send({ status: 'ACTIVE' });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(JSON.stringify(res.body)).toContain('USE_APPROVAL_ROUTE');
    expect(await planRow(DRAFT)).toEqual(before);
  });

  it('TEST-COMAPPR-INT-02 an editor changes a DRAFT, and the change is audited with the editor as actor', async () => {
    const before = await planRow(DRAFT_B);
    const res = await request(as(editor()))
      .patch(`/v1/commission-plans/${DRAFT_B}`)
      .set('If-Match', `"${before.lock_version}"`)
      .send({ basis: 'NET_LOAN' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = await planRow(DRAFT_B);
    expect(after).toMatchObject({
      status: 'DRAFT',
      basis: 'NET_LOAN',
      lock_version: before.lock_version + 1,
    });
    const actions = await auditActions(DRAFT_B);
    expect(actions).toEqual([
      expect.objectContaining({ action: 'commission_plan.updated', actor_id: CREATOR }),
    ]);
  });

  it('TEST-COMAPPR-INT-03 approval without a fresh second factor is refused, and the plan stays a DRAFT', async () => {
    const before = await planRow(DRAFT);
    const res = await request(as(checker(false)))
      .post(`/v1/commission-plans/${DRAFT}/approval`)
      .set('If-Match', `"${before.lock_version}"`)
      .send({});
    // STEP_UP_REQUIRED maps to 401 in the app's error mapping (the client then asks for the second factor).
    expect(res.status, JSON.stringify(res.body)).toBe(401);
    expect(JSON.stringify(res.body)).toContain('STEP_UP_REQUIRED');
    expect(await planRow(DRAFT)).toEqual(before);
    expect(await auditActions(DRAFT)).toEqual([]);
  });

  it('TEST-COMAPPR-INT-04 approval with a fresh second factor activates the DRAFT and is audited with the approval permission', async () => {
    const before = await planRow(DRAFT);
    const res = await request(as(checker(true)))
      .post(`/v1/commission-plans/${DRAFT}/approval`)
      .set('If-Match', `"${before.lock_version}"`)
      .send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await planRow(DRAFT)).toMatchObject({ status: 'ACTIVE' });
    const actions = await auditActions(DRAFT);
    expect(actions).toEqual([
      expect.objectContaining({
        action: 'commission_plan.approved',
        actor_id: CHECKER,
        permission_used: 'commission.plan.approve',
      }),
    ]);
  });

  it('TEST-COMAPPR-INT-05 an ACTIVE plan is neither edited nor approved again, and nothing changes', async () => {
    const before = await planRow(ACTIVE);
    const edit = await request(as(editor()))
      .patch(`/v1/commission-plans/${ACTIVE}`)
      .set('If-Match', `"${before.lock_version}"`)
      .send({ basis: 'NET_LOAN' });
    expect(edit.status, JSON.stringify(edit.body)).toBe(409);
    const approve = await request(as(checker(true)))
      .post(`/v1/commission-plans/${ACTIVE}/approval`)
      .set('If-Match', `"${before.lock_version}"`)
      .send({});
    expect(approve.status, JSON.stringify(approve.body)).toBe(409);
    expect(await planRow(ACTIVE)).toEqual(before);
    expect(await auditActions(ACTIVE)).toEqual([]);
  });

  it('TEST-COMAPPR-INT-06 another tenant gets NOT_FOUND on read, edit and approval, and the plan is untouched', async () => {
    const otherTenant = (grants: PermissionGrant[]) =>
      as(
        testPrincipal({
          id: 'usr_int_other_tenant',
          tenantId: env.B.tenantId,
          primaryBranchId: env.B.branchId,
          authTime: new Date().toISOString(),
          grants,
        }),
      );
    const all: PermissionGrant[] = [
      { code: 'commission.view', scope: 'TENANT' as const, branchIds: [] },
      { code: 'commission.plan.edit', scope: 'TENANT' as const, branchIds: [] },
      { code: 'commission.plan.approve', scope: 'TENANT' as const, branchIds: [] },
    ];
    const before = await planRow(DRAFT_B);
    const read = await request(otherTenant(all)).get(`/v1/commission-plans/${DRAFT_B}`);
    expect(read.status).toBe(404);
    const edit = await request(otherTenant(all))
      .patch(`/v1/commission-plans/${DRAFT_B}`)
      .set('If-Match', `"${before.lock_version}"`)
      .send({ basis: 'SANCTION_AMOUNT' });
    expect(edit.status).toBe(404);
    const approve = await request(otherTenant(all))
      .post(`/v1/commission-plans/${DRAFT_B}/approval`)
      .set('If-Match', `"${before.lock_version}"`)
      .send({});
    expect(approve.status).toBe(404);
    expect(await planRow(DRAFT_B)).toEqual(before);
  });
});
