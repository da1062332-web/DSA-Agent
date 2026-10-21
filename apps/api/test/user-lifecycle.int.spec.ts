// MOD-USR lifecycle against a real database (M-073), with the production wiring: invitation (API-USR-001), deactivation with
// hand-over (API-USR-004), suspension (API-USR-005), role assignments (API-USR-006) and transfers (API-USR-008).
// Synthetic data only.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUserTransferHandler } from '../src/modules/platform/user-lifecycle';
import { globalJobQueue } from '../src/modules/platform/job-queue';
import { createProductionDeps } from '../src/wiring';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import type { PermissionCode } from '@dsa/contracts';
import { createPrincipalResolver } from '@dsa/kernel';

let env: IsolationEnv;
const LEAVER = 'usr_ulc_leaver';
const BR2 = 'br_ulc_2';

beforeAll(async () => {
  env = await startIsolationEnv();
  const a = env.A;
  const q = (text: string, values: unknown[]) => env.admin.query(text, values);
  await q(
    `insert into app.app_user (id, tenant_id, idp_subject, email, display_name, primary_branch_id, created_by, updated_by)
     values ($1, $2, 'sub-ulc-leaver', 'leaver@ulc.example.com', 'Leaving User', $3, 'iso', 'iso')`,
    [LEAVER, a.tenantId, a.branchId],
  );
  await q(
    `insert into app.branch (id, tenant_id, organisation_id, code, name, created_by, updated_by)
     values ($1, $2, $3, 'PUN01', 'Pune', 'iso', 'iso')`,
    [BR2, a.tenantId, a.orgId],
  );
  await q(
    `insert into app.lead (id, tenant_id, branch_id, full_name, mobile_e164, mobile_hash, product_category, source,
                           owner_user_id, created_by, updated_by)
     values ('lead_ulc_1', $1, $2, 'Owned Lead', '+919876500071', decode('000000000000000000000000000000c1', 'hex'), 'PL',
             'PHONE', $3, $3, $3)`,
    [a.tenantId, a.branchId, LEAVER],
  );
  await q(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ('cust_ulc_1', $1, 'INDIVIDUAL', 'Owned Customer', $2, $3, $3)`,
    [a.tenantId, a.branchId, LEAVER],
  );
  await q(
    `insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, requested_amount,
                                       applicant_type, status, sales_owner_id, created_by, updated_by)
     values ('app_ulc_1', $1, $2, 'cust_ulc_1', 'PL', 300000, 'SALARIED', 'DRAFT', $3, $3, $3)`,
    [a.tenantId, a.branchId, LEAVER],
  );
  await q(
    `insert into app.task (id, tenant_id, type, title, owner_user_id, linked_type, linked_id, branch_id, priority, status,
                           due_at, idempotency_key, created_by_source, tags, lock_version, created_by, updated_by)
     values ('task_ulc_1', $1, 'FOLLOW_UP', 'Owned Task', $2, 'LEAD', 'lead_ulc_1', $3, 'MEDIUM', 'OPEN', now(),
             'idem_ulc_1', 'USER', '{}', 0, $2, $2)`,
    [a.tenantId, LEAVER, a.branchId],
  );
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

const ADMIN: PermissionCode[] = ['user.manage', 'role.manage'];
const key = (l: string) => `ulc_${l}_${Math.random().toString(36).slice(2, 10)}`;
const versionOf = async (id: string) =>
  Number(
    (await env.admin.query(`select lock_version from app.app_user where id = $1`, [id])).rows[0].lock_version,
  );

describe('TEST-USR-LC-INT user lifecycle', () => {
  it('TEST-USR-LC-INT-01 API-USR-001 invites a user as INVITED; a duplicate email is refused; a replay returns the same user', async () => {
    const app = env.appAs(env.A, ADMIN);
    const k = key('inv');
    const body = {
      email: 'New.Joiner@ulc.example.com',
      displayName: 'New Joiner',
      primaryBranchId: env.A.branchId,
    };
    const res = await request(app).post('/v1/users/invitations').set('Idempotency-Key', k).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ status: 'INVITED', email: 'new.joiner@ulc.example.com' });
    const again = await request(app).post('/v1/users/invitations').set('Idempotency-Key', k).send(body);
    expect(again.body.id).toBe(res.body.id);
    const dup = await request(app)
      .post('/v1/users/invitations')
      .set('Idempotency-Key', key('dup'))
      .send(body);
    expect(dup.status).toBe(422);
  });

  it('TEST-USR-LC-INT-02 API-USR-005 suspends and reactivates with a reason; nobody suspends themselves', async () => {
    const app = env.appAs(env.A, ADMIN);
    const self = await request(app)
      .post(`/v1/users/${env.A.userIds[0]}/suspension`)
      .set('If-Match', '"0"')
      .send({ action: 'SUSPEND', reason: 'Testing self' });
    expect(self.status).toBe(403);
    const v = await versionOf(LEAVER);
    const sus = await request(app)
      .post(`/v1/users/${LEAVER}/suspension`)
      .set('If-Match', `"${v}"`)
      .send({ action: 'SUSPEND', reason: 'Long leave' });
    expect(sus.status, JSON.stringify(sus.body)).toBe(200);
    expect(sus.body.status).toBe('SUSPENDED');
    const back = await request(app)
      .post(`/v1/users/${LEAVER}/suspension`)
      .set('If-Match', `"${sus.body.lockVersion}"`)
      .send({ action: 'REACTIVATE', reason: 'Back from leave' });
    expect(back.status).toBe(200);
    expect(back.body.status).toBe('ACTIVE');
  });

  it('TEST-USR-LC-INT-03 API-USR-006 replaces role assignments; an unknown role is refused and nothing changes', async () => {
    const app = env.appAs(env.A, ADMIN);
    const role = await env.admin.query(`select id from app.role where tenant_id = $1 limit 1`, [
      env.A.tenantId,
    ]);
    if (!role.rows[0]) {
      await env.admin.query(
        `insert into app.role (id, tenant_id, code, name, created_by) values ('role_ulc_1', $1, 'ROLE-ULC', 'Ulc', 'iso')`,
        [env.A.tenantId],
      );
    }
    const roleId = role.rows[0]?.id ?? 'role_ulc_1';
    const bad = await request(app)
      .put(`/v1/users/${LEAVER}/role-assignments`)
      .set('If-Match', `"${await versionOf(LEAVER)}"`)
      .send({ assignments: [{ roleId: 'role_missing_1', scopeType: 'TENANT', scopeBranchIds: [] }] });
    expect(bad.status).toBe(422);
    const put = await request(app)
      .put(`/v1/users/${LEAVER}/role-assignments`)
      .set('If-Match', `"${await versionOf(LEAVER)}"`)
      .send({ assignments: [{ roleId, scopeType: 'BRANCH', scopeBranchIds: [env.A.branchId] }] });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const held = await env.admin.query(
      `select role_id, scope_type from app.user_role_assignment where user_id = $1 and effective_range @> now()`,
      [LEAVER],
    );
    expect(held.rows).toEqual([{ role_id: roleId, scope_type: 'BRANCH' }]);
  });

  it('TEST-USR-LC-INT-04 API-USR-008 applies a transfer now, and schedules one for later through the job queue', async () => {
    const app = env.appAs(env.A, ADMIN);
    const now = await request(app)
      .post(`/v1/users/${LEAVER}/transfers`)
      .set('Idempotency-Key', key('tr'))
      .send({ toBranchId: BR2, reason: 'Moved to Pune' });
    expect(now.status, JSON.stringify(now.body)).toBe(200);
    expect(now.body.status).toBe('APPLIED');
    const later = await request(app)
      .post(`/v1/users/${LEAVER}/transfers`)
      .set('Idempotency-Key', key('tr2'))
      .send({ toBranchId: env.A.branchId, reason: 'Back to Mumbai', effectiveAt: '2030-01-01T00:00:00Z' });
    expect(later.status).toBe(202);
    expect(later.body.status).toBe('SCHEDULED');
    const job = await env.admin.query(
      `select id, payload from app.job_queue where job_type = 'USER_TRANSFER'`,
    );
    expect(job.rows).toHaveLength(1);
    // Run the scheduled job now, as the worker would at effectiveAt.
    await env.admin.query(`update app.job_queue set run_at = now() where id = $1`, [job.rows[0].id]);
    globalJobQueue.registerHandler(
      'USER_TRANSFER',
      createUserTransferHandler(createProductionDeps(createTxRunner(env.db))),
    );
    const worker = createTxRunner(env.db);
    const ctx = {
      principal: {
        kind: 'SERVICE' as const,
        id: 'SYSTEM:worker',
        tenantId: env.A.tenantId,
        primaryBranchId: null,
        managedTeamMemberIds: [],
        queueIds: [],
        grants: [],
        authTime: null,
      },
      correlationId: 'corr_ulc_job',
      now: new Date(),
    };
    expect(await worker.withTenantTx(ctx, (tx) => globalJobQueue.processJob(tx, job.rows[0].id))).toBe(true);
    const u = await env.admin.query(`select primary_branch_id from app.app_user where id = $1`, [LEAVER]);
    expect(u.rows[0].primary_branch_id).toBe(env.A.branchId);
  });

  it('TEST-USR-LC-INT-05 API-USR-004 deactivates and hands over the lead, application and task in one transaction', async () => {
    const app = env.appAs(env.A, ADMIN);
    const to = env.A.userIds[1];
    const notActive = await request(app)
      .post(`/v1/users/${LEAVER}/deactivation`)
      .set('Idempotency-Key', key('na'))
      .set('If-Match', `"${await versionOf(LEAVER)}"`)
      .send({ handoverToUserId: 'usr_missing_1', reason: 'Resigned' });
    expect(notActive.status).toBe(422);
    const res = await request(app)
      .post(`/v1/users/${LEAVER}/deactivation`)
      .set('Idempotency-Key', key('de'))
      .set('If-Match', `"${await versionOf(LEAVER)}"`)
      .send({ handoverToUserId: to, reason: 'Resigned' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('DEACTIVATED');
    expect(res.body.handedOver).toEqual({ leads: 1, applicationsAsSales: 1, applicationsAsOps: 0, tasks: 1 });
    const owners = await env.admin.query(
      `select (select owner_user_id from app.lead where id = 'lead_ulc_1') as lead,
              (select sales_owner_id from app.loan_application where id = 'app_ulc_1') as app,
              (select owner_user_id from app.task where id = 'task_ulc_1') as task,
              (select reason_code from app.lead_assignment where lead_id = 'lead_ulc_1') as reason,
              (select count(*)::int from app.user_role_assignment where user_id = $1 and effective_range @> now()) as roles`,
      [LEAVER],
    );
    expect(owners.rows[0]).toEqual({ lead: to, app: to, task: to, reason: 'OWNER_INACTIVE', roles: 0 });
  });

  it('TEST-USR-LC-INT-07 the invited user is bound on first sign-in with the invited email, only in its own tenant', async () => {
    const resolver = createPrincipalResolver(createTxRunner(env.db));
    const at = { correlationId: 'corr_ulc_bind', now: new Date() };
    const token = (tenantId: string, email: string) =>
      ({ subject: 'sub-ulc-new-joiner', tenantId, aal: 'aal1', mfaVerifiedAt: null, email }) as const;
    await expect(resolver.resolve(token(env.B.tenantId, 'new.joiner@ulc.example.com'), at)).rejects.toThrow();
    await expect(
      resolver.resolve(token(env.A.tenantId, 'someone.else@ulc.example.com'), at),
    ).rejects.toThrow();
    const p = await resolver.resolve(token(env.A.tenantId, 'new.joiner@ulc.example.com'), at);
    const row = await env.admin.query(
      `select id, status, idp_subject from app.app_user where email = 'new.joiner@ulc.example.com'`,
    );
    expect(row.rows[0]).toMatchObject({ id: p.id, status: 'ACTIVE', idp_subject: 'sub-ulc-new-joiner' });
  });

  it('TEST-USR-LC-INT-06 another tenant cannot touch these users (404)', async () => {
    const b = env.appAs(env.B, ADMIN);
    const res = await request(b)
      .post(`/v1/users/${env.A.userIds[1]}/suspension`)
      .set('If-Match', '"0"')
      .send({ action: 'SUSPEND', reason: 'Hostile' });
    expect(res.status).toBe(404);
  });
});
