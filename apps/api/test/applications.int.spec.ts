// MOD-APP Loan Applications against a real database (owner: Dev 3). Covers record scope (tenant, branch, own), edits,
// holds, optimistic concurrency under parallel writers, tenant isolation and the audit trail.
import type { PermissionGrant, PermissionCode } from '@dsa/contracts';
import { createAuditPort, createAuthz, createIdGenerator, createUserDirectory } from '@dsa/kernel';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { fakeAuth, testPrincipal } from './support/fake-auth';
import { startIsolationEnv, type IsolationEnv, type TenantFixture } from '../../../tests/isolation/harness';

let env: IsolationEnv;
beforeAll(async () => {
  env = await startIsolationEnv();
}, 180_000);
afterAll(async () => {
  await env?.stop();
});

const etag = (res: request.Response) => res.headers.etag as string;

/** An app whose principal holds the given grants (with their scopes), in the given tenant. */
function scopedApp(t: TenantFixture, grants: PermissionGrant[], userId = t.userIds[0]) {
  const ids = createIdGenerator();
  const deps = {
    txRunner: createTxRunner(env.db),
    authz: createAuthz(),
    audit: createAuditPort(ids),
    ids,
    userDirectory: createUserDirectory(),
  };
  return createApp({
    deps,
    corsAllowedOrigins: [],
    auth: fakeAuth(
      testPrincipal({
        tenantId: t.tenantId,
        id: userId,
        primaryBranchId: t.branchId,
        grants,
      }),
    ),
  });
}

const tenantGrants = (...codes: PermissionCode[]): PermissionGrant[] =>
  codes.map((code) => ({ code, scope: 'TENANT', branchIds: [] }));

let seq = 0;
/** A product version, so that applications past DRAFT satisfy the table's guard. Synthetic data only. */
async function productVersion(t: TenantFixture): Promise<string> {
  seq += 1;
  const lender = `lnd_app_int_${seq}`;
  const product = `prd_app_int_${seq}`;
  const version = `prv_app_int_${seq}`;
  await env.admin.query(
    `insert into app.lender (id, tenant_id, name, lender_type, created_by, updated_by) values ($1, $2, $3, 'NBFC', $4, $4)`,
    [lender, t.tenantId, `Application Lender ${seq}`, t.userIds[0]],
  );
  await env.admin.query(
    `insert into app.loan_product (id, tenant_id, lender_id, name, category, applicant_types, secured, created_by, updated_by)
     values ($1, $2, $3, $4, 'PL', '{SALARIED}', false, $5, $5)`,
    [product, t.tenantId, lender, `Application Product ${seq}`, t.userIds[0]],
  );
  await env.admin.query(
    `insert into app.loan_product_version (id, tenant_id, product_id, version_no, effective_from, amount_min, amount_max,
                                           currency, tenure_min_months, tenure_max_months, created_by)
     values ($1, $2, $3, 1, '2026-01-01T00:00:00Z', 50000, 1000000, 'INR', 12, 60, $4)`,
    [version, t.tenantId, product, t.userIds[0]],
  );
  return version;
}

/** Inserts an application directly, as the origination flow would have, and returns its id. */
async function seedApp(
  t: TenantFixture,
  n: string,
  opts: {
    branch?: string;
    sales?: string;
    ops?: string;
    queue?: string;
    status?: string;
  } = {},
): Promise<string> {
  const id = `app_int_${n}_${seq}`;
  seq += 1;
  const customer = `cust_app_int_${n}_${seq}`;
  const status = opts.status ?? 'DRAFT';
  const productVersionId = status === 'DRAFT' || status === 'CANCELLED' ? null : await productVersion(t);
  await env.admin.query(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Application Customer', $3, $4, $4)`,
    [customer, t.tenantId, t.branchId, t.userIds[0]],
  );
  await env.admin.query(
    `insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, product_version_id,
        requested_amount, applicant_type, status, cancel_reason, sales_owner_id, ops_owner_id, ops_queue_id,
        created_by, updated_by)
     values ($1, $2, $3, $4, 'PL', $5, 300000.00, 'SALARIED', $6, $7, $8, $9, $10, $11, $11)`,
    [
      id,
      t.tenantId,
      opts.branch ?? t.branchId,
      customer,
      productVersionId,
      status,
      status === 'CANCELLED' ? 'OTHER' : null,
      opts.sales ?? t.userIds[0],
      opts.ops ?? null,
      opts.queue ?? null,
      t.userIds[0],
    ],
  );
  return id;
}

const readGrants = tenantGrants('application.read');
const writeGrants = tenantGrants('application.read', 'application.update');

describe('TEST-APP-INT loan applications against the database', () => {
  it('TEST-APP-INT-01 tenant scope lists and reads the tenant applications; another tenant reads none of them', async () => {
    const id = await seedApp(env.A, 'tenant');
    const a = scopedApp(env.A, readGrants);
    const list = await request(a).get('/v1/applications?limit=200');
    expect(list.status).toBe(200);
    expect(list.body.data.map((x: { id: string }) => x.id)).toContain(id);
    expect((await request(a).get(`/v1/applications/${id}`)).status).toBe(200);

    const b = scopedApp(env.B, readGrants);
    expect((await request(b).get(`/v1/applications/${id}`)).status).toBe(404);
    const bList = await request(b).get('/v1/applications?limit=200');
    expect(bList.body.data.map((x: { id: string }) => x.id)).not.toContain(id);
  });

  it('TEST-APP-INT-02 own scope (RM) sees only applications they own; another owner reads as 404, not 403', async () => {
    const mine = await seedApp(env.A, 'own-mine', { sales: env.A.userIds[0] });
    const theirs = await seedApp(env.A, 'own-theirs', { sales: env.A.userIds[1] });
    const rm = scopedApp(
      env.A,
      [{ code: 'application.read', scope: 'OWN', branchIds: [] }],
      env.A.userIds[0],
    );
    const list = await request(rm).get('/v1/applications?limit=200');
    const ids = list.body.data.map((x: { id: string }) => x.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
    expect((await request(rm).get(`/v1/applications/${theirs}`)).status).toBe(404);
  });

  it('TEST-APP-INT-03 branch scope sees its branch only; a branch it does not hold reads as 404', async () => {
    const inBranch = await seedApp(env.A, 'branch-in', { branch: env.A.branchId });
    const branchMgr = scopedApp(env.A, [
      { code: 'application.read', scope: 'BRANCH', branchIds: [env.A.branchId] },
    ]);
    expect((await request(branchMgr).get(`/v1/applications/${inBranch}`)).status).toBe(200);

    const elsewhere = scopedApp(env.A, [
      { code: 'application.read', scope: 'BRANCH', branchIds: ['br_app_int_other'] },
    ]);
    expect((await request(elsewhere).get(`/v1/applications/${inBranch}`)).status).toBe(404);
    const none = await request(elsewhere).get('/v1/applications?limit=200');
    expect(none.body.data.map((x: { id: string }) => x.id)).not.toContain(inBranch);
  });

  it('TEST-APP-INT-04 a principal with no grant for the permission gets 403 on the list', async () => {
    const none = scopedApp(env.A, [{ code: 'application.update', scope: 'TENANT', branchIds: [] }]);
    expect((await request(none).get('/v1/applications')).status).toBe(403);
  });

  it('TEST-APP-INT-05 an edit changes the fields, moves the version on, and is audited with before and after', async () => {
    const id = await seedApp(env.A, 'edit');
    const a = scopedApp(env.A, writeGrants);
    const before = await request(a).get(`/v1/applications/${id}`);
    const res = await request(a)
      .patch(`/v1/applications/${id}`)
      .set('If-Match', etag(before))
      .send({ requestedAmount: '250000.00', tenureMonths: 36, purposeCode: 'EDUCATION' });
    expect(res.status).toBe(200);
    expect(res.body.requestedAmount).toBe('250000.00');
    expect(res.body.tenureMonths).toBe(36);
    expect(res.body.purposeCode).toBe('EDUCATION');
    expect(res.body.version).toBe(1);
    expect(etag(res)).toBe('"1"');

    const audit = await env.admin.query(
      `select action, before, after from app.audit_event where entity_id = $1 and action = 'application.updated'`,
      [id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].before).toMatchObject({ requestedAmount: '300000.00', tenureMonths: null });
    expect(audit.rows[0].after).toMatchObject({ requestedAmount: '250000.00', tenureMonths: 36 });
  });

  it('TEST-APP-INT-06 a stale If-Match is 409 and changes nothing', async () => {
    const id = await seedApp(env.A, 'stale');
    const a = scopedApp(env.A, writeGrants);
    const v0 = await request(a).get(`/v1/applications/${id}`);
    const first = await request(a)
      .patch(`/v1/applications/${id}`)
      .set('If-Match', etag(v0))
      .send({ tenureMonths: 24 });
    expect(first.status).toBe(200);
    const stale = await request(a)
      .patch(`/v1/applications/${id}`)
      .set('If-Match', etag(v0))
      .send({ tenureMonths: 48 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect((await request(a).get(`/v1/applications/${id}`)).body.tenureMonths).toBe(24);
  });

  it('TEST-APP-INT-07 two parallel edits with the same If-Match: exactly one succeeds', async () => {
    const id = await seedApp(env.A, 'race');
    const a = scopedApp(env.A, writeGrants);
    const v0 = await request(a).get(`/v1/applications/${id}`);
    const results = await Promise.all([
      request(a).patch(`/v1/applications/${id}`).set('If-Match', etag(v0)).send({ tenureMonths: 24 }),
      request(a).patch(`/v1/applications/${id}`).set('If-Match', etag(v0)).send({ tenureMonths: 36 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('TEST-APP-INT-08 an edit after the application is no longer editable is 409 INVALID_STATE', async () => {
    const id = await seedApp(env.A, 'uw', { status: 'UNDER_REVIEW' });
    const a = scopedApp(env.A, writeGrants);
    const v0 = await request(a).get(`/v1/applications/${id}`);
    const res = await request(a)
      .patch(`/v1/applications/${id}`)
      .set('If-Match', etag(v0))
      .send({ tenureMonths: 24 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('TEST-APP-INT-09 a hold is set with a reason, audited, and cleared; the reason is kept in the audit trail', async () => {
    const id = await seedApp(env.A, 'hold');
    const a = scopedApp(env.A, writeGrants);
    const v0 = await request(a).get(`/v1/applications/${id}`);
    const set = await request(a)
      .put(`/v1/applications/${id}/hold`)
      .set('If-Match', etag(v0))
      .send({ onHold: true, reason: 'Waiting on bank statements', until: '2026-11-30T00:00:00Z' });
    expect(set.status).toBe(200);
    expect(set.body.onHold).toBe(true);
    expect(set.body.holdReason).toBe('Waiting on bank statements');
    expect(set.body.holdUntil).toBe('2026-11-30T00:00:00.000Z');

    const cleared = await request(a)
      .put(`/v1/applications/${id}/hold`)
      .set('If-Match', etag(set))
      .send({ onHold: false });
    expect(cleared.status).toBe(200);
    expect(cleared.body.onHold).toBe(false);
    expect(cleared.body.holdReason).toBeNull();

    const again = await request(a)
      .put(`/v1/applications/${id}/hold`)
      .set('If-Match', etag(cleared))
      .send({ onHold: false });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE');

    const audit = await env.admin.query(
      `select action, reason from app.audit_event where entity_id = $1 and action like 'application.hold_%' order by occurred_at`,
      [id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['application.hold_set', 'application.hold_cleared']);
    expect(audit.rows[0].reason).toBe('Waiting on bank statements');
  });

  it('TEST-APP-INT-10 a hold on a cancelled application is 409 INVALID_STATE', async () => {
    const id = await seedApp(env.A, 'cancelled', { status: 'CANCELLED' });
    const a = scopedApp(env.A, writeGrants);
    const v0 = await request(a).get(`/v1/applications/${id}`);
    const res = await request(a)
      .put(`/v1/applications/${id}/hold`)
      .set('If-Match', etag(v0))
      .send({ onHold: true, reason: 'Should not be allowed' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('TEST-APP-INT-11 tenant B with full permissions cannot read, edit or hold tenant A applications (404)', async () => {
    const id = await seedApp(env.A, 'isolation');
    const b = scopedApp(env.B, writeGrants);
    expect((await request(b).get(`/v1/applications/${id}`)).status).toBe(404);
    const v0 = await request(scopedApp(env.A, writeGrants)).get(`/v1/applications/${id}`);
    expect(
      (await request(b).patch(`/v1/applications/${id}`).set('If-Match', etag(v0)).send({ tenureMonths: 12 }))
        .status,
    ).toBe(404);
    expect(
      (
        await request(b)
          .put(`/v1/applications/${id}/hold`)
          .set('If-Match', etag(v0))
          .send({ onHold: true, reason: 'Hostile hold' })
      ).status,
    ).toBe(404);
    const row = await env.admin.query(
      `select tenure_months, on_hold from app.loan_application where id = $1`,
      [id],
    );
    expect(row.rows[0]).toMatchObject({ tenure_months: null, on_hold: false });
  });
});
