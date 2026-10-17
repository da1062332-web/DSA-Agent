// MOD-ELG Eligibility against a real database (owner: Dev 3). Covers running and replaying an assessment, the UNKNOWN
// rule while no eligibility rule set exists, record scope, overrides (only a FAIL result, with a reason), tenant isolation
// and the audit trail. Synthetic data only.
import type { PermissionCode, PermissionGrant } from '@dsa/contracts';
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

function appFor(t: TenantFixture, grants: PermissionGrant[], userId = t.userIds[0]) {
  const ids = createIdGenerator();
  return createApp({
    deps: {
      txRunner: createTxRunner(env.db),
      authz: createAuthz(),
      audit: createAuditPort(ids),
      ids,
      userDirectory: createUserDirectory(),
    },
    corsAllowedOrigins: [],
    auth: fakeAuth(testPrincipal({ tenantId: t.tenantId, id: userId, primaryBranchId: t.branchId, grants })),
  });
}
const tenantGrants = (...codes: PermissionCode[]): PermissionGrant[] =>
  codes.map((code) => ({ code, scope: 'TENANT', branchIds: [] }));

let seq = 0;
const key = () => ({ 'Idempotency-Key': `elg-int-${Date.now()}-${(seq += 1)}` });

/** An application, optionally with a product version, owned by the given sales user. */
async function seedApp(
  t: TenantFixture,
  opts: { withProduct: boolean; sales?: string },
): Promise<{ id: string; version: string | null }> {
  seq += 1;
  const id = `app_elg_int_${seq}`;
  const customer = `cust_elg_int_${seq}`;
  let version: string | null = null;
  if (opts.withProduct) {
    version = `prv_elg_int_${seq}`;
    const lender = `lnd_elg_int_${seq}`;
    const product = `prd_elg_int_${seq}`;
    await env.admin.query(
      `insert into app.lender (id, tenant_id, name, lender_type, created_by, updated_by) values ($1, $2, $3, 'NBFC', $4, $4)`,
      [lender, t.tenantId, `Eligibility Lender ${seq}`, t.userIds[0]],
    );
    await env.admin.query(
      `insert into app.loan_product (id, tenant_id, lender_id, name, category, applicant_types, secured, created_by, updated_by)
       values ($1, $2, $3, $4, 'PL', '{SALARIED}', false, $5, $5)`,
      [product, t.tenantId, lender, `Eligibility Product ${seq}`, t.userIds[0]],
    );
    await env.admin.query(
      `insert into app.loan_product_version (id, tenant_id, product_id, version_no, effective_from, amount_min, amount_max,
                                             currency, tenure_min_months, tenure_max_months, created_by)
       values ($1, $2, $3, 1, '2026-01-01T00:00:00Z', 50000, 1000000, 'INR', 12, 60, $4)`,
      [version, t.tenantId, product, t.userIds[0]],
    );
  }
  await env.admin.query(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Eligibility Customer', $3, $4, $4)`,
    [customer, t.tenantId, t.branchId, t.userIds[0]],
  );
  await env.admin.query(
    `insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, product_version_id,
        requested_amount, applicant_type, status, sales_owner_id, created_by, updated_by)
     values ($1, $2, $3, $4, 'PL', $5, 300000.00, 'SALARIED', $6, $7, $8, $8)`,
    [
      id,
      t.tenantId,
      t.branchId,
      customer,
      version,
      version ? 'DOCUMENTS_PENDING' : 'DRAFT',
      opts.sales ?? t.userIds[0],
      t.userIds[0],
    ],
  );
  return { id, version };
}

const runAssessment = (a: Parameters<typeof request>[0], id: string, headers = key()) =>
  request(a).post(`/v1/applications/${id}/eligibility-assessments`).set(headers).send({});

describe('TEST-ELG-INT eligibility against the database', () => {
  it('TEST-ELG-INT-01 an assessment needs a chosen product; with one it is recorded as UNKNOWN because no rule set exists', async () => {
    const a = appFor(env.A, tenantGrants('application.read'));
    const bare = await seedApp(env.A, { withProduct: false });
    const refused = await runAssessment(a, bare.id);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('INVALID_STATE');

    const app = await seedApp(env.A, { withProduct: true });
    const res = await runAssessment(a, app.id);
    expect(res.status).toBe(201);
    expect(res.body.applicationId).toBe(app.id);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({ productVersionId: app.version, result: 'UNKNOWN' });
    expect(res.body.results[0].criteria[0].reason).toContain('NO_RULE_SET_PUBLISHED');
    expect(res.headers.etag).toBe('"0"');
  });

  it('TEST-ELG-INT-02 the same Idempotency-Key replays the first assessment; a new key makes a second; history lists both', async () => {
    const a = appFor(env.A, tenantGrants('application.read'));
    const app = await seedApp(env.A, { withProduct: true });
    const headers = key();
    const first = await runAssessment(a, app.id, headers);
    const replay = await runAssessment(a, app.id, headers);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.id).toBe(first.body.id);
    const second = await runAssessment(a, app.id);
    expect(second.body.id).not.toBe(first.body.id);

    const history = await request(a).get(`/v1/applications/${app.id}/eligibility-assessments`);
    expect(history.status).toBe(200);
    expect(history.body.data.map((x: { id: string }) => x.id)).toEqual(
      [first.body.id, second.body.id].sort(),
    );
  });

  it('TEST-ELG-INT-03 running an assessment is audited', async () => {
    const a = appFor(env.A, tenantGrants('application.read'));
    const app = await seedApp(env.A, { withProduct: true });
    await runAssessment(a, app.id);
    const audit = await env.admin.query(
      `select action from app.audit_event where entity_id = $1 and action = 'eligibility.assessed'`,
      [app.id],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('TEST-ELG-INT-04 record scope: an OWN-scope user cannot assess or read another user application (404); the owner can', async () => {
    const app = await seedApp(env.A, { withProduct: true, sales: env.A.userIds[0] });
    const own: PermissionGrant[] = [{ code: 'application.read', scope: 'OWN', branchIds: [] }];
    const other = appFor(env.A, own, env.A.userIds[1]);
    expect((await runAssessment(other, app.id)).status).toBe(404);
    expect((await request(other).get(`/v1/applications/${app.id}/eligibility-assessments`)).status).toBe(404);
    const owner = appFor(env.A, own, env.A.userIds[0]);
    expect((await runAssessment(owner, app.id)).status).toBe(201);
  });

  it('TEST-ELG-INT-05 an override needs eligibility.override, a failed result and a reason', async () => {
    const app = await seedApp(env.A, { withProduct: true });
    const reader = appFor(env.A, tenantGrants('application.read'));
    const assessed = await runAssessment(reader, app.id);
    const url = `/v1/eligibility-assessments/${assessed.body.id}/overrides`;
    const body = { productVersionId: app.version, reason: 'Branch manager reviewed the income proof' };

    expect((await request(reader).post(url).set(key()).send(body)).status).toBe(403);

    const approver = appFor(env.A, tenantGrants('eligibility.override'));
    const unknownOnly = await request(approver).post(url).set(key()).send(body);
    expect(unknownOnly.status).toBe(409);
    expect(unknownOnly.body.error.code).toBe('INVALID_STATE');

    // Make the result a FAIL the way a published rule set would, then override it.
    await env.admin.query(
      `update app.eligibility_assessment set results = jsonb_set(results, '{0,result}', '"FAIL"') where id = $1`,
      [assessed.body.id],
    );
    const short = await request(approver)
      .post(url)
      .set(key())
      .send({ ...body, reason: 'too short' });
    expect(short.status).toBe(422);
    const wrongVersion = await request(approver)
      .post(url)
      .set(key())
      .send({ ...body, productVersionId: 'prv_not_in_assessment' });
    expect(wrongVersion.status).toBe(422);

    const ok = await request(approver).post(url).set(key()).send(body);
    expect(ok.status).toBe(201);
    expect(ok.body.overrides).toHaveLength(1);
    expect(ok.body.overrides[0]).toMatchObject({ productVersionId: app.version, reason: body.reason });

    const audit = await env.admin.query(
      `select reason from app.audit_event where entity_id = $1 and action = 'eligibility.overridden'`,
      [app.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].reason).toBe(body.reason);
  });

  it('TEST-ELG-INT-06 tenant isolation: another tenant cannot assess, read or override', async () => {
    const app = await seedApp(env.A, { withProduct: true });
    const a = appFor(env.A, tenantGrants('application.read'));
    const assessed = await runAssessment(a, app.id);

    const b = appFor(env.B, tenantGrants('application.read', 'eligibility.override'));
    expect((await runAssessment(b, app.id)).status).toBe(404);
    expect((await request(b).get(`/v1/applications/${app.id}/eligibility-assessments`)).status).toBe(404);
    const override = await request(b)
      .post(`/v1/eligibility-assessments/${assessed.body.id}/overrides`)
      .set(key())
      .send({ productVersionId: app.version, reason: 'Trying from another tenant' });
    expect(override.status).toBe(404);
  });
});
