// MOD-APP transitions against a real database (owner: Dev 3). T-APP-01 (select product, start documents), T-APP-02 (send
// to review) and T-APP-10 (cancel). Covers the product-version rules, the history, the outbox and audit rows, scope,
// tenant isolation, concurrency and idempotency.
import type { PermissionCode, PermissionGrant } from '@dsa/contracts';
import { createAuditPort, createAuthz, createIdGenerator, createUserDirectory } from '@dsa/kernel';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { createProductVersionPort } from '../src/modules/origination/catalogue/product-version-port';
import { LiveDecisionEngine } from '../src/modules/rules/engine/decision-engine';
import { fakeAuth, testPrincipal } from './support/fake-auth';
import { startIsolationEnv, type IsolationEnv, type TenantFixture } from '../../../tests/isolation/harness';

let env: IsolationEnv;
beforeAll(async () => {
  env = await startIsolationEnv();
}, 180_000);
afterAll(async () => {
  await env?.stop();
});

let seq = 0;
const tenantGrants = (...codes: PermissionCode[]): PermissionGrant[] =>
  codes.map((code) => ({ code, scope: 'TENANT', branchIds: [] }));

function scopedApp(t: TenantFixture, grants: PermissionGrant[], userId = t.userIds[0]) {
  const ids = createIdGenerator();
  return createApp({
    deps: {
      txRunner: createTxRunner(env.db),
      authz: createAuthz(),
      audit: createAuditPort(ids),
      ids,
      userDirectory: createUserDirectory(),
      productVersionPort: createProductVersionPort(),
      // T-APP-01 generates the document checklist through DK-document.requirements (SUB-DOC.02).
      decisionPort: new LiveDecisionEngine(),
    },
    corsAllowedOrigins: [],
    auth: fakeAuth(testPrincipal({ tenantId: t.tenantId, id: userId, primaryBranchId: t.branchId, grants })),
  });
}

/** A product of the given category with one version that takes effect on `effectiveFrom`. Synthetic data only. */
async function productVersion(
  t: TenantFixture,
  opts: { category?: string; effectiveFrom?: string; productStatus?: string } = {},
): Promise<string> {
  seq += 1;
  const lender = `lnd_trn_int_${seq}`;
  const product = `prd_trn_int_${seq}`;
  const version = `prv_trn_int_${seq}`;
  await env.admin.query(
    `insert into app.lender (id, tenant_id, name, lender_type, created_by, updated_by) values ($1, $2, $3, 'NBFC', $4, $4)`,
    [lender, t.tenantId, `Transition Lender ${seq}`, t.userIds[0]],
  );
  await env.admin.query(
    `insert into app.loan_product (id, tenant_id, lender_id, name, category, applicant_types, secured, status, created_by, updated_by)
     values ($1, $2, $3, $4, $5, '{SALARIED}', false, $6, $7, $7)`,
    [
      product,
      t.tenantId,
      lender,
      `Transition Product ${seq}`,
      opts.category ?? 'PL',
      opts.productStatus ?? 'ACTIVE',
      t.userIds[0],
    ],
  );
  await env.admin.query(
    `insert into app.loan_product_version (id, tenant_id, product_id, version_no, effective_from, amount_min, amount_max,
                                           currency, tenure_min_months, tenure_max_months, created_by)
     values ($1, $2, $3, 1, $4, 50000, 1000000, 'INR', 12, 60, $5)`,
    [version, t.tenantId, product, opts.effectiveFrom ?? '2026-01-01T00:00:00Z', t.userIds[0]],
  );
  return version;
}

/** A PL application in the given status, with a product version only when the status requires one. */
async function seedApp(
  t: TenantFixture,
  status = 'DRAFT',
  opts: { sales?: string; productVersionId?: string | null } = {},
): Promise<string> {
  seq += 1;
  const id = `app_trn_int_${seq}`;
  const customer = `cust_trn_int_${seq}`;
  const pv =
    opts.productVersionId !== undefined
      ? opts.productVersionId
      : status === 'DRAFT'
        ? null
        : await productVersion(t);
  await env.admin.query(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Transition Customer', $3, $4, $4)`,
    [customer, t.tenantId, t.branchId, t.userIds[0]],
  );
  await env.admin.query(
    `insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, product_version_id,
        requested_amount, applicant_type, status, cancel_reason, sales_owner_id, created_by, updated_by)
     values ($1, $2, $3, $4, 'PL', $5, 300000.00, 'SALARIED', $6, $7, $8, $9, $9)`,
    [
      id,
      t.tenantId,
      t.branchId,
      customer,
      pv,
      status,
      status === 'CANCELLED' ? 'OTHER' : null,
      opts.sales ?? t.userIds[0],
      t.userIds[0],
    ],
  );
  await env.admin.query(
    `insert into app.application_party (id, tenant_id, application_id, customer_id, role, party_type, created_by)
     values ($1, $2, $3, $4, 'PRIMARY', 'INDIVIDUAL', $5)`,
    [`pty_trn_int_${seq}`, t.tenantId, id, customer, t.userIds[0]],
  );
  return id;
}

const etagOf = async (app: ReturnType<typeof scopedApp>, id: string) =>
  (await request(app).get(`/v1/applications/${id}`)).headers.etag as string;

const trn = (
  app: ReturnType<typeof scopedApp>,
  id: string,
  etag: string,
  body: Record<string, unknown>,
  key: string,
) =>
  request(app)
    .post(`/v1/applications/${id}/transitions`)
    .set('If-Match', etag)
    .set('Idempotency-Key', key)
    .send(body);

const ops = tenantGrants(
  'application.read',
  'application.update',
  'application.review',
  'application.cancel',
);

describe('TEST-APP-TRN loan application transitions against the database', () => {
  it('TEST-APP-TRN-INT-01 T-APP-01 selects the product version and moves Draft to Documents pending, with history, outbox and audit', async () => {
    const id = await seedApp(env.A, 'DRAFT');
    const pv = await productVersion(env.A);
    const a = scopedApp(env.A, ops);
    const res = await trn(
      a,
      id,
      await etagOf(a, id),
      { transitionCode: 'T-APP-01', productVersionId: pv },
      'trn-int-01-a',
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DOCUMENTS_PENDING');
    expect(res.body.productVersionId).toBe(pv);
    expect(res.body.version).toBe(1);

    const hist = await env.admin.query(
      `select from_status, to_status, transition_code, actor from app.application_status_history where application_id = $1`,
      [id],
    );
    expect(hist.rows).toEqual([
      {
        from_status: 'DRAFT',
        to_status: 'DOCUMENTS_PENDING',
        transition_code: 'T-APP-01',
        actor: env.A.userIds[0],
      },
    ]);
    const outbox = await env.admin.query(
      `select event_type from app.outbox_event where subject_id = $1 and event_type = 'application.state_changed'`,
      [id],
    );
    expect(outbox.rows).toHaveLength(1);
    const audit = await env.admin.query(
      `select action, permission_used from app.audit_event where entity_id = $1 and action = 'application.state_changed'`,
      [id],
    );
    expect(audit.rows[0]).toMatchObject({
      action: 'application.state_changed',
      permission_used: 'application.update',
    });

    // SUB-DOC.02: the checklist is generated from DK-document.requirements (no rule set published, so the registry's
    // default output applies: one mandatory PAN card for the primary party), and the decision is kept on the application.
    const checklist = await env.admin.query(
      `select document_type_code, mandatory, status, source_decision_id from app.checklist_item where application_id = $1`,
      [id],
    );
    expect(checklist.rows).toEqual([
      expect.objectContaining({ document_type_code: 'PAN_CARD', mandatory: true, status: 'PENDING' }),
    ]);
    const app = await env.admin.query(`select last_checklist_decision_ids from app.loan_application where id = $1`, [id]);
    expect(app.rows[0].last_checklist_decision_ids).toEqual([checklist.rows[0].source_decision_id]);
    const changed = await env.admin.query(
      `select count(*)::int as n from app.outbox_event where subject_id = $1 and event_type = 'checklist.changed'`,
      [id],
    );
    expect(changed.rows[0].n).toBe(1);
  });

  it('TEST-APP-TRN-INT-02 T-APP-01 refuses an unknown product version, and a version of another category (422)', async () => {
    const id = await seedApp(env.A, 'DRAFT');
    const a = scopedApp(env.A, ops);
    const unknown = await trn(
      a,
      id,
      await etagOf(a, id),
      { transitionCode: 'T-APP-01', productVersionId: 'prv_missing_1' },
      'trn-int-02-a',
    );
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.details[0]).toMatchObject({ field: 'productVersionId', issue: 'NOT_FOUND' });

    const hl = await productVersion(env.A, { category: 'HL' });
    const mismatch = await trn(
      a,
      id,
      await etagOf(a, id),
      { transitionCode: 'T-APP-01', productVersionId: hl },
      'trn-int-02-b',
    );
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.details[0].issue).toBe('CATEGORY_MISMATCH');
  });

  it('TEST-APP-TRN-INT-03 T-APP-01 refuses a version not yet in force, or whose product is inactive (409)', async () => {
    const id = await seedApp(env.A, 'DRAFT');
    const a = scopedApp(env.A, ops);
    const future = await productVersion(env.A, { effectiveFrom: '2099-01-01T00:00:00Z' });
    const notYet = await trn(
      a,
      id,
      await etagOf(a, id),
      { transitionCode: 'T-APP-01', productVersionId: future },
      'trn-int-03-a',
    );
    expect(notYet.status).toBe(409);
    expect(notYet.body.error.code).toBe('INVALID_STATE');

    const inactive = await productVersion(env.A, { productStatus: 'INACTIVE' });
    const off = await trn(
      a,
      id,
      await etagOf(a, id),
      { transitionCode: 'T-APP-01', productVersionId: inactive },
      'trn-int-03-b',
    );
    expect(off.status).toBe(409);
    expect(off.body.error.code).toBe('INVALID_STATE');
  });

  it('TEST-APP-TRN-INT-04 T-APP-02 sends Documents pending to Under review; from Draft it is 409 INVALID_TRANSITION', async () => {
    const draft = await seedApp(env.A, 'DRAFT');
    const docs = await seedApp(env.A, 'DOCUMENTS_PENDING');
    const a = scopedApp(env.A, ops);
    const wrong = await trn(a, draft, await etagOf(a, draft), { transitionCode: 'T-APP-02' }, 'trn-int-04-a');
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.code).toBe('INVALID_TRANSITION');

    const ok = await trn(a, docs, await etagOf(a, docs), { transitionCode: 'T-APP-02' }, 'trn-int-04-b');
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('UNDER_REVIEW');
  });

  it('TEST-APP-TRN-INT-05 T-APP-10 cancels with a reason; the reason is stored and audited; nothing can move it afterwards', async () => {
    const id = await seedApp(env.A, 'UNDER_REVIEW');
    const a = scopedApp(env.A, ops);
    const res = await trn(
      a,
      id,
      await etagOf(a, id),
      { transitionCode: 'T-APP-10', cancelReason: 'INELIGIBLE' },
      'trn-int-05-a',
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
    const row = await env.admin.query(`select cancel_reason from app.loan_application where id = $1`, [id]);
    expect(row.rows[0].cancel_reason).toBe('INELIGIBLE');
    const audit = await env.admin.query(
      `select reason from app.audit_event where entity_id = $1 and action = 'application.state_changed'`,
      [id],
    );
    expect(audit.rows[0].reason).toBe('INELIGIBLE');

    const after = await trn(a, id, await etagOf(a, id), { transitionCode: 'T-APP-02' }, 'trn-int-05-b');
    expect(after.status).toBe(409);
    expect(after.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('TEST-APP-TRN-INT-06 a cancel is refused once the application has been submitted (409)', async () => {
    const id = await seedApp(env.A, 'SUBMITTED');
    const a = scopedApp(env.A, ops);
    const res = await trn(
      a,
      id,
      await etagOf(a, id),
      { transitionCode: 'T-APP-10', cancelReason: 'OTHER' },
      'trn-int-06-a',
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('TEST-APP-TRN-INT-07 a stale If-Match is 409 and changes nothing', async () => {
    const id = await seedApp(env.A, 'UNDER_REVIEW');
    const a = scopedApp(env.A, ops);
    const v0 = await etagOf(a, id);
    const first = await trn(
      a,
      id,
      v0,
      { transitionCode: 'T-APP-10', cancelReason: 'DUPLICATE' },
      'trn-int-07-a',
    );
    expect(first.status).toBe(200);
    const stale = await trn(a, id, v0, { transitionCode: 'T-APP-10', cancelReason: 'OTHER' }, 'trn-int-07-b');
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    const row = await env.admin.query(
      `select status, cancel_reason from app.loan_application where id = $1`,
      [id],
    );
    expect(row.rows[0]).toMatchObject({ status: 'CANCELLED', cancel_reason: 'DUPLICATE' });
  });

  it('TEST-APP-TRN-INT-08 two parallel cancels with the same If-Match: exactly one succeeds', async () => {
    const id = await seedApp(env.A, 'DOCUMENTS_PENDING');
    const a = scopedApp(env.A, ops);
    const v0 = await etagOf(a, id);
    const results = await Promise.all([
      trn(a, id, v0, { transitionCode: 'T-APP-10', cancelReason: 'DUPLICATE' }, 'trn-int-08-a'),
      trn(a, id, v0, { transitionCode: 'T-APP-10', cancelReason: 'OTHER' }, 'trn-int-08-b'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const hist = await env.admin.query(
      `select count(*)::int as n from app.application_status_history where application_id = $1`,
      [id],
    );
    expect(hist.rows[0].n).toBe(1);
  });

  it('TEST-APP-TRN-INT-09 the same Idempotency-Key replays the transition instead of running it twice', async () => {
    const id = await seedApp(env.A, 'DOCUMENTS_PENDING');
    const a = scopedApp(env.A, ops);
    const v0 = await etagOf(a, id);
    const first = await trn(a, id, v0, { transitionCode: 'T-APP-02' }, 'trn-int-09-key-1');
    const again = await trn(a, id, v0, { transitionCode: 'T-APP-02' }, 'trn-int-09-key-1');
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    const hist = await env.admin.query(
      `select count(*)::int as n from app.application_status_history where application_id = $1`,
      [id],
    );
    expect(hist.rows[0].n).toBe(1);
  });

  it('TEST-APP-TRN-INT-10 scope: an RM may cancel only their own applications; others are 404', async () => {
    const mine = await seedApp(env.A, 'DRAFT', { sales: env.A.userIds[0] });
    const theirs = await seedApp(env.A, 'DRAFT', { sales: env.A.userIds[1] });
    const rm = scopedApp(
      env.A,
      [{ code: 'application.cancel', scope: 'OWN', branchIds: [] }],
      env.A.userIds[0],
    );
    const denied = await trn(
      rm,
      theirs,
      await etagOf(scopedApp(env.A, ops), theirs),
      { transitionCode: 'T-APP-10', cancelReason: 'OTHER' },
      'trn-int-10-a',
    );
    expect(denied.status).toBe(404);
    const ok = await trn(
      rm,
      mine,
      await etagOf(scopedApp(env.A, ops), mine),
      { transitionCode: 'T-APP-10', cancelReason: 'OTHER' },
      'trn-int-10-b',
    );
    expect(ok.status).toBe(200);
  });

  it('TEST-APP-TRN-INT-11 tenant B with every permission cannot move a tenant A application (404)', async () => {
    const id = await seedApp(env.A, 'DRAFT');
    const b = scopedApp(env.B, ops);
    const res = await trn(
      b,
      id,
      await etagOf(scopedApp(env.A, ops), id),
      { transitionCode: 'T-APP-10', cancelReason: 'OTHER' },
      'trn-int-11-a',
    );
    expect(res.status).toBe(404);
    const row = await env.admin.query(`select status from app.loan_application where id = $1`, [id]);
    expect(row.rows[0].status).toBe('DRAFT');
  });
});
