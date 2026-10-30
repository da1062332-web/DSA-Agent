// MOD-APP transitions against a real database (owner: Dev 3). T-APP-01 (select product, start documents), T-APP-02 (send
// to review), T-APP-03 (rework), T-APP-05 (send back to review), T-APP-07 (close), T-APP-08 (withdraw), T-APP-09 (reopen)
// and T-APP-10 (cancel). Covers the product-version rules, the history, the outbox and audit rows, scope, tenant isolation,
// concurrency and idempotency.
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
    const app = await env.admin.query(
      `select last_checklist_decision_ids from app.loan_application where id = $1`,
      [id],
    );
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
  // ---- Withdraw (T-APP-08) and reopen (T-APP-09): the from-states are the agreed assumptions in transitions.ts. ----
  const lifecycle = tenantGrants(
    'application.read',
    'application.update',
    'application.review',
    'application.cancel',
    'application.withdraw',
    'application.reopen',
  );

  it('TEST-APP-TRN-INT-12 T-APP-08 withdraws from Documents pending, Under review and Ready for submission, with history, outbox and audit', async () => {
    const a = scopedApp(env.A, lifecycle);
    for (const from of ['DOCUMENTS_PENDING', 'UNDER_REVIEW', 'READY_FOR_SUBMISSION']) {
      const id = await seedApp(env.A, from);
      const res = await trn(
        a,
        id,
        await etagOf(a, id),
        { transitionCode: 'T-APP-08', reason: 'Customer no longer needs the loan' },
        `trn-int-12-${from}`,
      );
      expect(res.status, `${from}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.status).toBe('WITHDRAWN');
      const history = await env.admin.query(
        `select from_status, to_status, reason_code from app.application_status_history
          where application_id = $1 and transition_code = 'T-APP-08'`,
        [id],
      );
      expect(history.rows).toEqual([
        { from_status: from, to_status: 'WITHDRAWN', reason_code: 'Customer no longer needs the loan' },
      ]);
      const outbox = await env.admin.query(
        `select payload from app.outbox_event where subject_id = $1 and event_type = 'application.state_changed'`,
        [id],
      );
      expect(outbox.rows.map((r) => r.payload)).toEqual([
        { applicationId: id, from, to: 'WITHDRAWN', transitionCode: 'T-APP-08' },
      ]);
      const audit = await env.admin.query(
        `select reason, permission_used from app.audit_event where entity_id = $1 and action = 'application.state_changed'`,
        [id],
      );
      expect(audit.rows).toEqual([
        { reason: 'Customer no longer needs the loan', permission_used: 'application.withdraw' },
      ]);
    }
  });

  it('TEST-APP-TRN-INT-13 T-APP-08 is refused from Draft, Submitted, Cancelled and Withdrawn (409), and changes nothing', async () => {
    const a = scopedApp(env.A, lifecycle);
    for (const from of ['DRAFT', 'SUBMITTED', 'CANCELLED', 'WITHDRAWN']) {
      const id = await seedApp(env.A, from);
      const res = await trn(
        a,
        id,
        await etagOf(a, id),
        { transitionCode: 'T-APP-08', reason: 'Customer no longer needs the loan' },
        `trn-int-13-${from}`,
      );
      expect(res.status, from).toBe(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
      const row = await env.admin.query(`select status from app.loan_application where id = $1`, [id]);
      expect(row.rows[0].status).toBe(from);
    }
  });

  it('TEST-APP-TRN-INT-14 T-APP-09 reopens a cancelled or withdrawn application as a draft; the cancel reason is cleared', async () => {
    const a = scopedApp(env.A, lifecycle);
    for (const from of ['CANCELLED', 'WITHDRAWN']) {
      const id = await seedApp(env.A, from);
      const res = await trn(
        a,
        id,
        await etagOf(a, id),
        { transitionCode: 'T-APP-09', reason: 'Customer came back' },
        `trn-int-14-${from}`,
      );
      expect(res.status, `${from}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.status).toBe('DRAFT');
      const row = await env.admin.query(
        `select status, cancel_reason from app.loan_application where id = $1`,
        [id],
      );
      expect(row.rows[0]).toEqual({ status: 'DRAFT', cancel_reason: null });
      const audit = await env.admin.query(
        `select reason, permission_used from app.audit_event where entity_id = $1 and action = 'application.state_changed'`,
        [id],
      );
      expect(audit.rows).toEqual([{ reason: 'Customer came back', permission_used: 'application.reopen' }]);
    }
  });

  it('TEST-APP-TRN-INT-15 T-APP-09 is refused for an application that is still open or has reached a lender outcome (409)', async () => {
    const a = scopedApp(env.A, lifecycle);
    // Reopening a terminal lender outcome (REOPEN_TERMINAL) is not built, so REJECTED and CLOSED stay where they are.
    for (const from of ['DRAFT', 'UNDER_REVIEW', 'SUBMITTED', 'REJECTED', 'CLOSED']) {
      const id = await seedApp(env.A, from);
      const res = await trn(
        a,
        id,
        await etagOf(a, id),
        { transitionCode: 'T-APP-09', reason: 'Customer came back' },
        `trn-int-15-${from}`,
      );
      expect(res.status, from).toBe(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
      const row = await env.admin.query(`select status from app.loan_application where id = $1`, [id]);
      expect(row.rows[0].status).toBe(from);
    }
  });

  it('TEST-APP-TRN-INT-16 tenant B with withdraw and reopen rights cannot withdraw or reopen a tenant A application (404)', async () => {
    const b = scopedApp(env.B, lifecycle);
    const a = scopedApp(env.A, lifecycle);
    const open = await seedApp(env.A, 'UNDER_REVIEW');
    const closed = await seedApp(env.A, 'WITHDRAWN');
    const withdraw = await trn(
      b,
      open,
      await etagOf(a, open),
      { transitionCode: 'T-APP-08', reason: 'Hostile withdraw attempt' },
      'trn-int-16-a',
    );
    expect(withdraw.status).toBe(404);
    const reopen = await trn(
      b,
      closed,
      await etagOf(a, closed),
      { transitionCode: 'T-APP-09', reason: 'Hostile reopen attempt' },
      'trn-int-16-b',
    );
    expect(reopen.status).toBe(404);
    const rows = await env.admin.query(
      `select id, status from app.loan_application where id = any($1::text[]) order by id`,
      [[open, closed]],
    );
    expect(Object.fromEntries(rows.rows.map((r) => [r.id, r.status]))).toEqual({
      [open]: 'UNDER_REVIEW',
      [closed]: 'WITHDRAWN',
    });
  });
  const closing = tenantGrants('application.read', 'application.review', 'application.close');
  const status = async (id: string) =>
    (await env.admin.query(`select status, rework_reason from app.loan_application where id = $1`, [id]))
      .rows[0];

  it('TEST-APP-TRN-INT-17 T-APP-03 sends a file under review back for rework and keeps the reason until T-APP-02 sends it back to review', async () => {
    const a = scopedApp(env.A, closing);
    const id = await seedApp(env.A, 'UNDER_REVIEW');
    const reason = 'Bank statement is for the wrong period';
    const rework = await trn(
      a,
      id,
      await etagOf(a, id),
      { transitionCode: 'T-APP-03', reason },
      'trn-int-17-a',
    );
    expect(rework.status, JSON.stringify(rework.body)).toBe(200);
    expect(rework.body).toMatchObject({ status: 'DOCUMENTS_PENDING', reworkReason: reason });
    const history = await env.admin.query(
      `select from_status, to_status, reason_code from app.application_status_history
        where application_id = $1 and transition_code = 'T-APP-03'`,
      [id],
    );
    expect(history.rows).toEqual([
      { from_status: 'UNDER_REVIEW', to_status: 'DOCUMENTS_PENDING', reason_code: reason },
    ]);
    const audit = await env.admin.query(
      `select reason, permission_used from app.audit_event where entity_id = $1 and action = 'application.state_changed'`,
      [id],
    );
    expect(audit.rows).toEqual([{ reason, permission_used: 'application.review' }]);

    const back = await trn(a, id, await etagOf(a, id), { transitionCode: 'T-APP-02' }, 'trn-int-17-b');
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ status: 'UNDER_REVIEW', reworkReason: null });
    expect(await status(id)).toEqual({ status: 'UNDER_REVIEW', rework_reason: null });
  });

  it('TEST-APP-TRN-INT-18 T-APP-05 sends a ready file back to review with a reason; it is refused from any other status (409)', async () => {
    const a = scopedApp(env.A, closing);
    const ready = await seedApp(env.A, 'READY_FOR_SUBMISSION');
    const res = await trn(
      a,
      ready,
      await etagOf(a, ready),
      { transitionCode: 'T-APP-05', reason: 'Income proof needs a second look' },
      'trn-int-18-a',
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('UNDER_REVIEW');
    for (const from of ['DOCUMENTS_PENDING', 'UNDER_REVIEW', 'SUBMITTED']) {
      const id = await seedApp(env.A, from);
      const refused = await trn(
        a,
        id,
        await etagOf(a, id),
        { transitionCode: 'T-APP-05', reason: 'Income proof needs a second look' },
        `trn-int-18-${from}`,
      );
      expect(refused.status, from).toBe(409);
      expect((await status(id)).status).toBe(from);
    }
    const stillReady = await seedApp(env.A, 'READY_FOR_SUBMISSION');
    const wrong = await trn(
      a,
      stillReady,
      await etagOf(a, stillReady),
      { transitionCode: 'T-APP-03', reason: 'Bank statement is for the wrong period' },
      'trn-int-18-b',
    );
    expect(wrong.status).toBe(409);
  });

  it('TEST-APP-TRN-INT-19 T-APP-07 closes a disbursed, rejected, withdrawn or cancelled file, with history and audit', async () => {
    const a = scopedApp(env.A, closing);
    for (const from of ['DISBURSED', 'REJECTED', 'WITHDRAWN', 'CANCELLED']) {
      const id = await seedApp(env.A, from);
      const body =
        from === 'DISBURSED'
          ? { transitionCode: 'T-APP-07', reason: 'Loan fully disbursed' }
          : { transitionCode: 'T-APP-07' };
      const res = await trn(a, id, await etagOf(a, id), body, `trn-int-19-${from}`);
      expect(res.status, `${from}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.status).toBe('CLOSED');
      const history = await env.admin.query(
        `select from_status, to_status from app.application_status_history
          where application_id = $1 and transition_code = 'T-APP-07'`,
        [id],
      );
      expect(history.rows).toEqual([{ from_status: from, to_status: 'CLOSED' }]);
      const audit = await env.admin.query(
        `select reason, permission_used from app.audit_event where entity_id = $1 and action = 'application.state_changed'`,
        [id],
      );
      expect(audit.rows).toEqual([
        {
          reason: from === 'DISBURSED' ? 'Loan fully disbursed' : null,
          permission_used: 'application.close',
        },
      ]);
    }
  });

  it('TEST-APP-TRN-INT-20 T-APP-07 is refused while the file is open or partly disbursed (409), and a closed file cannot be reopened', async () => {
    const a = scopedApp(env.A, [...closing, ...tenantGrants('application.reopen')]);
    for (const from of [
      'DRAFT',
      'UNDER_REVIEW',
      'SUBMITTED',
      'SANCTIONED',
      'PARTIALLY_DISBURSED',
      'CLOSED',
    ]) {
      const id = await seedApp(env.A, from);
      const res = await trn(a, id, await etagOf(a, id), { transitionCode: 'T-APP-07' }, `trn-int-20-${from}`);
      expect(res.status, from).toBe(409);
      expect((await status(id)).status).toBe(from);
    }
    const closed = await seedApp(env.A, 'CLOSED');
    const reopen = await trn(
      a,
      closed,
      await etagOf(a, closed),
      { transitionCode: 'T-APP-09', reason: 'Customer came back' },
      'trn-int-20-reopen',
    );
    expect(reopen.status).toBe(409);
  });

  it('TEST-APP-TRN-INT-21 tenant B with review and close rights cannot rework, send back or close a tenant A application (404)', async () => {
    const a = scopedApp(env.A, closing);
    const b = scopedApp(env.B, closing);
    const cases: [string, Record<string, unknown>][] = [
      ['UNDER_REVIEW', { transitionCode: 'T-APP-03', reason: 'Hostile rework attempt' }],
      ['READY_FOR_SUBMISSION', { transitionCode: 'T-APP-05', reason: 'Hostile send back attempt' }],
      ['DISBURSED', { transitionCode: 'T-APP-07' }],
    ];
    for (const [from, body] of cases) {
      const id = await seedApp(env.A, from);
      const res = await trn(b, id, await etagOf(a, id), body, `trn-int-21-${from}`);
      expect(res.status, from).toBe(404);
      expect((await status(id)).status).toBe(from);
    }
  });
});
