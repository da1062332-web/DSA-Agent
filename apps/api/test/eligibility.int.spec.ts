// MOD-ELG Eligibility against a real database (owner: Dev 3). The assessment runs the approved rule set through the decision
// engine, stores its provenance, refuses to pass on missing or unusable information, and keeps overrides to one per product
// result and input set. Covers scope, tenant isolation, concurrency, the latest assessment after many records, the applicant
// inputs and the audit trail. Synthetic data only; the approved definition is read from the migration itself.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AppError, type PermissionCode, type PermissionGrant } from '@dsa/contracts';
import { computeContentHash, type RuleSetDefinition } from '@dsa/bre-core';
import { createAuditPort, createAuthz, createIdGenerator, createUserDirectory } from '@dsa/kernel';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { LiveDecisionEngine } from '../src/modules/rules/engine/decision-engine';
import { fakeAuth, testPrincipal } from './support/fake-auth';
import { startIsolationEnv, type IsolationEnv, type TenantFixture } from '../../../tests/isolation/harness';

let env: IsolationEnv;
beforeAll(async () => {
  env = await startIsolationEnv();
  // The approved rule set and the credit-entry switch are tenant settings: set once here, not inside each test.
  await seedRuleSet(env.A, { type: 'TENANT_DEFAULT' });
  await setCreditFlag(env.A, true);
}, 180_000);
afterAll(async () => {
  await env?.stop();
});

const ROOT = path.resolve(__dirname, '../../..');

/** The approved eligibility definition, read from migration 55 so the test evaluates what was approved. */
function approvedDefinition(): RuleSetDefinition {
  const sql = readFileSync(
    path.join(ROOT, 'supabase/migrations/20261001000055_approved_eligibility_rules.sql'),
    'utf8',
  );
  const match = sql.match(/'(\{"schemaVersion":1[\s\S]*?)'::jsonb,\n {2}'\{"result":"REFER"/);
  if (!match) throw new Error('approved definition not found in migration 55');
  return JSON.parse(match[1]!) as RuleSetDefinition;
}
const APPROVED = approvedDefinition();

function appFor(t: TenantFixture, grants: PermissionGrant[], userId = t.userIds[0]) {
  const ids = createIdGenerator();
  return createApp({
    deps: {
      txRunner: createTxRunner(env.db),
      authz: createAuthz(),
      audit: createAuditPort(ids),
      ids,
      userDirectory: createUserDirectory(),
      decisionPort: new LiveDecisionEngine(),
    },
    corsAllowedOrigins: [],
    auth: fakeAuth(testPrincipal({ tenantId: t.tenantId, id: userId, primaryBranchId: t.branchId, grants })),
  });
}
const tenantGrants = (...codes: PermissionCode[]): PermissionGrant[] =>
  codes.map((code) => ({ code, scope: 'TENANT', branchIds: [] }));
const EDIT = tenantGrants('application.read', 'application.update', 'eligibility.override');
const READ_ONLY = tenantGrants('application.read');

let seq = 0;
const next = (label: string) => `${label}_${Date.now().toString(36)}_${(seq += 1)}`;
const key = () => ({ 'Idempotency-Key': next('elg-int') });

/** Seeds the approved rule set for a tenant (or a product-scoped one). The hash is the canonical hash of the definition. */
async function seedRuleSet(
  t: TenantFixture,
  scope: { type: 'TENANT_DEFAULT' } | { type: 'PRODUCT_VERSION'; ref: string },
  contentHash?: string,
): Promise<string> {
  const rs = next('rs_elg_int');
  const rsv = next('rsv_elg_int');
  await env.admin.query(
    `insert into app.rule_set (id, tenant_id, decision_key, scope_type, scope_ref, name, owner_user_id, origin, status,
                               created_by, updated_by)
     values ($1, $2, 'DK-application.eligibility', $3, $4, 'Eligibility (integration)', null, 'PLATFORM_SEED', 'ACTIVE',
             'test', 'test')`,
    [rs, t.tenantId, scope.type, scope.type === 'PRODUCT_VERSION' ? scope.ref : null],
  );
  await env.admin.query(
    `insert into app.rule_set_version (id, tenant_id, rule_set_id, version_no, status, hit_policy, authoring_form,
                                       definition, default_output, content_hash, effective_range, change_reason,
                                       created_by, published_by, published_at)
     values ($1, $2, $3, 1, 'ACTIVE', 'FIRST', 'RULES', $4::jsonb, $5::jsonb, $6,
             tstzrange(now() - interval '30 days', NULL, '[)'), 'integration test', 'test', 'test', now())`,
    [
      rsv,
      t.tenantId,
      rs,
      JSON.stringify(APPROVED),
      JSON.stringify(APPROVED.defaultOutput),
      contentHash ?? computeContentHash(APPROVED),
    ],
  );
  return rsv;
}

async function setCreditFlag(t: TenantFixture, on: boolean): Promise<void> {
  await env.admin.query(
    `insert into app.tenant_feature_flag (tenant_id, key, value, updated_by)
     values ($1, 'eligibility.manual_credit_entry', $2, 'test')
     on conflict (tenant_id, key) do update set value = excluded.value`,
    [t.tenantId, on],
  );
}

interface Seeded {
  id: string;
  version: string;
  partyId: string;
}

/** An application on a product version, with a primary party, optionally in a given status. Synthetic data only. */
async function seedApp(
  t: TenantFixture,
  opts: { status?: string; sales?: string; withProduct?: boolean } = {},
): Promise<Seeded> {
  const id = next('app_elg_int');
  const customer = next('cust_elg_int');
  const partyId = next('pty_elg_int');
  const lender = next('lnd_elg_int');
  const product = next('prd_elg_int');
  const version = next('prv_elg_int');
  await env.admin.query(
    `insert into app.lender (id, tenant_id, name, lender_type, created_by, updated_by) values ($1, $2, $3, 'NBFC', $4, $4)`,
    [lender, t.tenantId, `Eligibility Lender ${lender}`, t.userIds[0]],
  );
  await env.admin.query(
    `insert into app.loan_product (id, tenant_id, lender_id, name, category, applicant_types, secured, created_by, updated_by)
     values ($1, $2, $3, $4, 'PL', '{SALARIED}', false, $5, $5)`,
    [product, t.tenantId, lender, `Eligibility Product ${product}`, t.userIds[0]],
  );
  await env.admin.query(
    `insert into app.loan_product_version (id, tenant_id, product_id, version_no, effective_from, amount_min, amount_max,
                                           currency, tenure_min_months, tenure_max_months, created_by)
     values ($1, $2, $3, 1, '2026-01-01T00:00:00Z', 50000, 1000000, 'INR', 12, 60, $4)`,
    [version, t.tenantId, product, t.userIds[0]],
  );
  await env.admin.query(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Eligibility Customer', $3, $4, $4)`,
    [customer, t.tenantId, t.branchId, t.userIds[0]],
  );
  await env.admin.query(
    `insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, product_version_id,
        requested_amount, tenure_months, applicant_type, status, sales_owner_id, created_by, updated_by, cancel_reason)
     values ($1, $2, $3, $4, 'PL', $5, 300000.00, 36, 'SALARIED', $6, $7, $8, $8, $9)`,
    [
      id,
      t.tenantId,
      t.branchId,
      customer,
      opts.withProduct === false ? null : version,
      opts.status ?? 'DOCUMENTS_PENDING',
      opts.sales ?? t.userIds[0],
      t.userIds[0],
      // A cancelled application must carry its cancel reason (database check).
      opts.status === 'CANCELLED' ? 'OTHER' : null,
    ],
  );
  await env.admin.query(
    `insert into app.application_party (id, tenant_id, application_id, customer_id, role, party_type, created_by)
     values ($1, $2, $3, $4, 'PRIMARY', 'INDIVIDUAL', $5)`,
    [partyId, t.tenantId, id, customer, t.userIds[0]],
  );
  return { id, version, partyId };
}

/** A checklist item on the application's primary party, in the given status. */
async function seedChecklistItem(
  t: TenantFixture,
  app: Seeded,
  code: string,
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED',
): Promise<string> {
  const itemId = next('chk_elg_int');
  await env.admin.query(
    `insert into app.checklist_item (id, tenant_id, application_id, party_id, document_type_code, mandatory,
                                     source_decision_id, created_by, updated_by)
     values ($1, $2, $3, $4, $5, true, 'dr_elg_int', $6, $6)`,
    [itemId, t.tenantId, app.id, app.partyId, code, t.userIds[0]],
  );
  if (status === 'ACCEPTED') {
    await env.admin.query(
      `update app.checklist_item set status = 'ACCEPTED', reviewed_by = $2, reviewed_at = now() where id = $1`,
      [itemId, t.userIds[0]],
    );
  }
  if (status === 'REJECTED') {
    await env.admin.query(
      `update app.checklist_item set status = 'REJECTED', reviewed_by = $2, reviewed_at = now(), reject_reason = 'ILLEGIBLE'
        where id = $1`,
      [itemId, t.userIds[0]],
    );
  }
  return itemId;
}

const etagOf = async (a: ReturnType<typeof appFor>, id: string) =>
  (await request(a).get(`/v1/applications/${id}/eligibility-inputs`)).headers.etag as string;

async function putInputs(
  a: ReturnType<typeof appFor>,
  id: string,
  body: Record<string, unknown>,
): Promise<request.Response> {
  return request(a)
    .put(`/v1/applications/${id}/eligibility-inputs`)
    .set('If-Match', await etagOf(a, id))
    .send(body);
}

const run = (a: ReturnType<typeof appFor>, id: string, headers = key()) =>
  request(a).post(`/v1/applications/${id}/eligibility-assessments`).set(headers).send({});

const override = (
  a: ReturnType<typeof appFor>,
  assessmentId: string,
  productVersionId: string,
  reason: string,
) =>
  request(a)
    .post(`/v1/eligibility-assessments/${assessmentId}/overrides`)
    .set(key())
    .send({ productVersionId, reason });

const REASON = 'Reviewed the file with the applicant and the branch manager.';

describe('TEST-ELG-INT eligibility against the database', () => {
  it('TEST-ELG-INT-01 a qualifying applicant passes against the approved rule, with the decision record and the rule version kept', async () => {
    const a = appFor(env.A, EDIT);
    const app = await seedApp(env.A);
    const item = await seedChecklistItem(env.A, app, 'SALARY_SLIP', 'ACCEPTED');
    const inputs = await putInputs(a, app.id, {
      credit: {
        score: 780,
        reportReference: 'RPT-INT-01',
        reportDate: new Date().toISOString().slice(0, 10),
      },
      verifiedMonthlyIncome: { amount: '80000.00', currency: 'INR', checklistItemId: item },
    });
    expect(inputs.status, JSON.stringify(inputs.body)).toBe(200);

    const res = await run(a, app.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [result] = res.body.results;
    expect(result).toMatchObject({
      productVersionId: app.version,
      result: 'PASS',
      decisionResult: 'ELIGIBLE',
      missingData: [],
      indicativeMaxAmount: { amount: '2500000.00', currency: 'INR' },
    });
    expect(res.body.matchedRuleUids).toEqual(['RUL-ELG-003']);
    expect(res.body.ruleSetVersionNo).toBe(1);
    expect(res.body.decisionStatus).toBe('OK');
    expect(res.body.decisionRecordIds).toHaveLength(1);

    // The input fingerprint is kept for provenance and never returned to the caller.
    expect(res.body).not.toHaveProperty('inputHash');
    const stored = await env.admin.query(`select input_hash from app.eligibility_assessment where id = $1`, [
      res.body.id,
    ]);
    expect(stored.rows[0].input_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const decision = await env.admin.query(
      `select rule_set_version_id, input_hash, status from app.decision_record where id = $1`,
      [res.body.decisionRecordIds[0]],
    );
    expect(decision.rows[0]).toEqual({
      rule_set_version_id: res.body.ruleSetVersionId,
      input_hash: stored.rows[0].input_hash,
      status: 'OK',
    });
    // The record shows that the credit score and income were used, but keeps neither value. The request amount is kept.
    const snapshot = await env.admin.query(`select input_snapshot from app.decision_record where id = $1`, [
      res.body.decisionRecordIds[0],
    ]);
    const kept = snapshot.rows[0].input_snapshot;
    expect(kept.applicant).toMatchObject({ credit_score: '[redacted]', monthly_income: '[redacted]' });
    expect(kept.application.requested_amount).toEqual({ amount: '300000.00', currency: 'INR' });
    expect(JSON.stringify(kept)).not.toContain('780');
  });

  it('TEST-ELG-INT-02 a failed rule is a FAIL with its reason; a missing verified income is still listed', async () => {
    const a = appFor(env.A, EDIT);
    const app = await seedApp(env.A);
    await putInputs(a, app.id, {
      credit: {
        score: 550,
        reportReference: 'RPT-INT-02',
        reportDate: new Date().toISOString().slice(0, 10),
      },
    });
    const res = await run(a, app.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.results[0]).toMatchObject({ result: 'FAIL', decisionResult: 'INELIGIBLE' });
    expect(res.body.results[0].criteria).toEqual([
      expect.objectContaining({ code: 'CREDIT_SCORE_LOW', result: 'FAIL' }),
    ]);
    expect(res.body.missingData).toEqual(['VERIFIED_MONTHLY_INCOME_MISSING']);
  });

  it('TEST-ELG-INT-03 missing verified income never gives a pass, and a declared income is not used as verified', async () => {
    const a = appFor(env.A, EDIT);
    const app = await seedApp(env.A);
    await putInputs(a, app.id, {
      credit: {
        score: 780,
        reportReference: 'RPT-INT-03',
        reportDate: new Date().toISOString().slice(0, 10),
      },
      declaredMonthlyIncome: { amount: '150000.00', currency: 'INR' },
      declaredIncomeSource: 'APPLICANT_STATED',
    });
    const res = await run(a, app.id);
    expect(res.status).toBe(201);
    expect(res.body.results[0].result).toBe('UNKNOWN');
    expect(res.body.results[0].result).not.toBe('PASS');
    expect(res.body.results[0].decisionResult).toBe('REFER');
    expect(res.body.missingData).toEqual(['VERIFIED_MONTHLY_INCOME_MISSING']);
    expect(res.body.matchedRuleUids).toEqual([]);
  });

  it('TEST-ELG-INT-04 missing credit data is listed and never passed; the rule set is not asked to decide on it', async () => {
    const a = appFor(env.A, EDIT);
    const app = await seedApp(env.A);
    const item = await seedChecklistItem(env.A, app, 'ITR', 'ACCEPTED');
    await putInputs(a, app.id, {
      verifiedMonthlyIncome: { amount: '90000.00', currency: 'INR', checklistItemId: item },
    });
    const res = await run(a, app.id);
    expect(res.status).toBe(201);
    expect(res.body.results[0].result).toBe('UNKNOWN');
    expect(res.body.missingData).toEqual(['CREDIT_SCORE_MISSING']);
  });

  it('TEST-ELG-INT-05 a stale credit report is reported as stale, not as missing, and is not used', async () => {
    const a = appFor(env.A, EDIT);
    const app = await seedApp(env.A);
    const item = await seedChecklistItem(env.A, app, 'SALARY_SLIP', 'ACCEPTED');
    const old = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
    const set = await putInputs(a, app.id, {
      credit: { score: 790, reportReference: 'RPT-INT-05', reportDate: old },
      verifiedMonthlyIncome: { amount: '90000.00', currency: 'INR', checklistItemId: item },
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.credit.usable).toBe(false);
    const res = await run(a, app.id);
    expect(res.status).toBe(201);
    expect(res.body.results[0].result).toBe('UNKNOWN');
    expect(res.body.missingData).toEqual(['CREDIT_DATA_STALE']);
  });

  it('TEST-ELG-INT-06 evidence that is no longer accepted stops counting as verified income', async () => {
    const a = appFor(env.A, EDIT);
    const app = await seedApp(env.A);
    const item = await seedChecklistItem(env.A, app, 'SALARY_SLIP', 'ACCEPTED');
    await putInputs(a, app.id, {
      credit: {
        score: 780,
        reportReference: 'RPT-INT-06',
        reportDate: new Date().toISOString().slice(0, 10),
      },
      verifiedMonthlyIncome: { amount: '80000.00', currency: 'INR', checklistItemId: item },
    });
    expect((await run(a, app.id)).body.results[0].result).toBe('PASS');
    await env.admin.query(
      `update app.checklist_item set status = 'REJECTED', reject_reason = 'INCOMPLETE', reviewed_by = $2, reviewed_at = now()
        where id = $1`,
      [item, env.A.userIds[0]],
    );
    const res = await run(a, app.id);
    expect(res.body.results[0].result).toBe('UNKNOWN');
    expect(res.body.missingData).toEqual(['INCOME_EVIDENCE_NOT_ACCEPTED']);
  });

  it('TEST-ELG-INT-07 a tenant with no approved rule set gets UNKNOWN "no rule set", and the decision is still recorded', async () => {
    const a = appFor(env.B, EDIT);
    const app = await seedApp(env.B);
    const res = await run(a, app.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.results[0]).toMatchObject({ result: 'UNKNOWN', decisionResult: null });
    expect(res.body.results[0].criteria[0]).toMatchObject({ code: 'RULE_SET_UNAVAILABLE' });
    expect(res.body.ruleSetVersionId).toBeNull();
    expect(res.body.ruleSetVersionNo).toBeNull();
    expect(res.body.decisionStatus).toBe('NO_VERSION');
    expect(res.body.decisionRecordIds).toHaveLength(1);
  });

  it('TEST-ELG-INT-08 an approved rule set whose content no longer matches its hash is refused and nothing is recorded', async () => {
    const a = appFor(env.A, EDIT);
    const app = await seedApp(env.A);
    await seedRuleSet(env.A, { type: 'PRODUCT_VERSION', ref: app.version }, `sha256:${'0'.repeat(64)}`);
    const headers = key();
    const res = await run(a, app.id, headers);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error.code).toBe('CONTENT_HASH_MISMATCH');
    const rows = await env.admin.query(
      `select count(*)::int as n from app.eligibility_assessment where application_id = $1`,
      [app.id],
    );
    expect(rows.rows[0].n).toBe(0);
    const decisions = await env.admin.query(
      `select count(*)::int as n from app.decision_record where idempotency_key = $1`,
      [`elg:${app.id}:${headers['Idempotency-Key']}`],
    );
    expect(decisions.rows[0].n, 'no decision is kept for a refused run').toBe(0);
  });

  it('TEST-ELG-INT-09 a rule set scoped to the loan product is the one that is used', async () => {
    const app = await seedApp(env.B);
    const rsv = await seedRuleSet(env.B, { type: 'PRODUCT_VERSION', ref: app.version });
    const res = await run(appFor(env.B, EDIT), app.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.ruleSetVersionId).toBe(rsv);
    expect(res.body.ruleSetVersionNo).toBe(1);
  });

  it('TEST-ELG-INT-10 a failed result is overridden once per input set; a changed input allows a new override', async () => {
    const a = appFor(env.A, EDIT);
    const app = await seedApp(env.A);
    await putInputs(a, app.id, {
      credit: {
        score: 550,
        reportReference: 'RPT-INT-10',
        reportDate: new Date().toISOString().slice(0, 10),
      },
    });
    const first = await run(a, app.id);
    const ok = await override(a, first.body.id, app.version, REASON);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.overrides).toHaveLength(1);
    expect(ok.body.overrides[0]).toMatchObject({
      productVersionId: app.version,
      assessmentId: first.body.id,
    });
    expect(ok.body.overrides[0]).not.toHaveProperty('inputHash');

    const again = await override(a, first.body.id, app.version, REASON);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE');

    const second = await run(a, app.id);
    const sameInputs = await override(a, second.body.id, app.version, REASON);
    expect(sameInputs.status, 'same inputs after a new run').toBe(409);

    await putInputs(a, app.id, {
      credit: {
        score: 540,
        reportReference: 'RPT-INT-10B',
        reportDate: new Date().toISOString().slice(0, 10),
      },
    });
    const third = await run(a, app.id);
    const changed = await override(a, third.body.id, app.version, REASON);
    expect(changed.status, JSON.stringify(changed.body)).toBe(201);
    expect(changed.body.overrides.at(-1)).toMatchObject({ assessmentId: third.body.id });
  });

  it('TEST-ELG-INT-11 two concurrent overrides of the same result: one is recorded, the other is refused', async () => {
    const a = appFor(env.A, EDIT);
    const app = await seedApp(env.A);
    await putInputs(a, app.id, {
      credit: {
        score: 500,
        reportReference: 'RPT-INT-11',
        reportDate: new Date().toISOString().slice(0, 10),
      },
    });
    const assessed = await run(a, app.id);
    const [x, y] = await Promise.all([
      override(a, assessed.body.id, app.version, REASON),
      override(a, assessed.body.id, app.version, REASON),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    const stored = await env.admin.query(
      `select jsonb_array_length(overrides) as n from app.eligibility_assessment where id = $1`,
      [assessed.body.id],
    );
    expect(stored.rows[0].n).toBe(1);
  });

  it('TEST-ELG-INT-12 only the latest assessment can be overridden', async () => {
    const a = appFor(env.A, EDIT);
    const app = await seedApp(env.A);
    await putInputs(a, app.id, {
      credit: {
        score: 520,
        reportReference: 'RPT-INT-12',
        reportDate: new Date().toISOString().slice(0, 10),
      },
    });
    const older = await run(a, app.id);
    await run(a, app.id);
    const res = await override(a, older.body.id, app.version, REASON);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/latest assessment/);
  });

  it('TEST-ELG-INT-13 a closed, withdrawn, rejected or cancelled application takes no assessment and no override', async () => {
    const a = appFor(env.A, EDIT);
    for (const status of ['WITHDRAWN', 'CANCELLED', 'REJECTED', 'CLOSED']) {
      const app = await seedApp(env.A, { status });
      const assessed = await run(a, app.id);
      expect(assessed.status, `${status} run`).toBe(409);
      expect(assessed.body.error.code).toBe('INVALID_STATE');
    }
    const closed = await seedApp(env.A, { status: 'CLOSED' });
    const failed = await env.admin.query(
      `insert into app.eligibility_assessment (id, tenant_id, application_id, assessed_at, results, created_by, updated_by)
       values ($1, $2, $3, now(), $4::jsonb, $5, $5) returning id`,
      [
        next('elg_int_closed'),
        env.A.tenantId,
        closed.id,
        JSON.stringify([
          {
            productVersionId: closed.version,
            result: 'FAIL',
            decisionResult: 'INELIGIBLE',
            criteria: [],
            missingData: [],
          },
        ]),
        env.A.userIds[0],
      ],
    );
    const res = await override(a, failed.rows[0].id, closed.version, REASON);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('TEST-ELG-INT-14 the latest assessment is the newest by time, with id as the tie-breaker, however many there are', async () => {
    const a = appFor(env.A, READ_ONLY.concat(tenantGrants('application.update')));
    const app = await seedApp(env.A);
    const empty = await request(a).get(`/v1/applications/${app.id}/eligibility-assessments/latest`);
    expect(empty.status).toBe(404);
    const base = Date.now() - 60 * 60_000;
    for (let i = 1; i <= 55; i += 1) {
      await env.admin.query(
        `insert into app.eligibility_assessment (id, tenant_id, application_id, assessed_at, results, created_by, updated_by)
         values ($1, $2, $3, to_timestamp($4 / 1000.0), '[]'::jsonb, $5, $5)`,
        [
          `elg_int_latest_${String(i).padStart(3, '0')}`,
          env.A.tenantId,
          app.id,
          base + i * 1000,
          env.A.userIds[0],
        ],
      );
    }
    await env.admin.query(
      `insert into app.eligibility_assessment (id, tenant_id, application_id, assessed_at, results, created_by, updated_by)
       values ('elg_int_latest_zzz', $1, $2, to_timestamp($3 / 1000.0), '[]'::jsonb, $4, $4)`,
      [env.A.tenantId, app.id, base + 55 * 1000, env.A.userIds[0]],
    );
    const res = await request(a).get(`/v1/applications/${app.id}/eligibility-assessments/latest`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.id).toBe('elg_int_latest_zzz');
  });

  it('TEST-ELG-INT-15 applicant figures: reading and changing them needs application.update, the If-Match version, and an accepted income document', async () => {
    // Tenant B, where manual credit entry is off by default, so the flag check is exercised.
    const editor = appFor(env.B, EDIT);
    const reader = appFor(env.B, READ_ONLY);
    const app = await seedApp(env.B);
    expect((await request(reader).get(`/v1/applications/${app.id}/eligibility-inputs`)).status).toBe(403);
    expect(
      (
        await request(reader)
          .put(`/v1/applications/${app.id}/eligibility-inputs`)
          .set('If-Match', '"0"')
          .send({
            declaredMonthlyIncome: { amount: '1.00', currency: 'INR' },
            declaredIncomeSource: 'APPLICANT_STATED',
          })
      ).status,
    ).toBe(403);

    const first = await request(editor).get(`/v1/applications/${app.id}/eligibility-inputs`);
    expect(first.status).toBe(200);
    expect(first.headers.etag).toBe('"0"');
    expect(first.body.verifiedMonthlyIncome).toBeNull();

    const missingVersion = await request(editor)
      .put(`/v1/applications/${app.id}/eligibility-inputs`)
      .send({
        declaredMonthlyIncome: { amount: '50000.00', currency: 'INR' },
        declaredIncomeSource: 'SALES_ESTIMATE',
      });
    expect(missingVersion.status).toBe(400);

    const stale = await request(editor)
      .put(`/v1/applications/${app.id}/eligibility-inputs`)
      .set('If-Match', '"7"')
      .send({
        declaredMonthlyIncome: { amount: '50000.00', currency: 'INR' },
        declaredIncomeSource: 'SALES_ESTIMATE',
      });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');

    const declared = await putInputs(editor, app.id, {
      declaredMonthlyIncome: { amount: '50000.00', currency: 'INR' },
      declaredIncomeSource: 'SALES_ESTIMATE',
    });
    expect(declared.status, JSON.stringify(declared.body)).toBe(200);
    expect(declared.headers.etag).toBe('"1"');
    expect(declared.body.declaredMonthlyIncome).toEqual({ amount: '50000.00', currency: 'INR' });
    expect(declared.body.verifiedMonthlyIncome).toBeNull();

    const pan = await seedChecklistItem(env.B, app, 'PAN_CARD', 'ACCEPTED');
    const notIncome = await putInputs(editor, app.id, {
      verifiedMonthlyIncome: { amount: '60000.00', currency: 'INR', checklistItemId: pan },
    });
    expect(notIncome.status).toBe(422);
    expect(notIncome.body.error.details[0]).toMatchObject({ issue: 'NOT_INCOME' });

    const pending = await seedChecklistItem(env.B, app, 'SALARY_SLIP', 'PENDING');
    const notAccepted = await putInputs(editor, app.id, {
      verifiedMonthlyIncome: { amount: '60000.00', currency: 'INR', checklistItemId: pending },
    });
    expect(notAccepted.status).toBe(422);
    expect(notAccepted.body.error.details[0]).toMatchObject({ issue: 'NOT_ACCEPTED' });

    const creditWithFlagOff = await putInputs(editor, app.id, {
      credit: {
        score: 700,
        reportReference: 'RPT-INT-15',
        reportDate: new Date().toISOString().slice(0, 10),
      },
    });
    expect(creditWithFlagOff.status).toBe(409);
    expect(creditWithFlagOff.body.error.code).toBe('INVALID_STATE');

    // Clearing a figure with null is allowed, and it leaves no value behind.
    const cleared = await putInputs(editor, app.id, {
      declaredMonthlyIncome: null,
      declaredIncomeSource: null,
    });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(cleared.body.declaredMonthlyIncome).toBeNull();
  });

  it('TEST-ELG-INT-16 manual credit entry is refused unless the tenant has switched it on; when on, the score is kept with its report', async () => {
    const editor = appFor(env.B, EDIT);
    const app = await seedApp(env.B);
    const off = await putInputs(editor, app.id, {
      credit: { score: 700, reportReference: 'RPT-B-16', reportDate: new Date().toISOString().slice(0, 10) },
    });
    expect(off.status).toBe(409);
    await setCreditFlag(env.B, true);
    const on = await putInputs(editor, app.id, {
      credit: { score: 700, reportReference: 'RPT-B-16', reportDate: new Date().toISOString().slice(0, 10) },
    });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body.credit).toMatchObject({ score: 700, reportReference: 'RPT-B-16', usable: true });
    await setCreditFlag(env.B, false);
  });

  it('TEST-ELG-INT-17 another tenant cannot read, change, assess or override these records (404, the same answer as a missing id)', async () => {
    const a = appFor(env.A, EDIT);
    const b = appFor(env.B, EDIT);
    const app = await seedApp(env.A);
    await putInputs(a, app.id, {
      declaredMonthlyIncome: { amount: '40000.00', currency: 'INR' },
      declaredIncomeSource: 'APPLICANT_STATED',
    });
    const assessed = await run(a, app.id);
    expect((await request(b).get(`/v1/applications/${app.id}/eligibility-inputs`)).status).toBe(404);
    expect(
      (
        await request(b)
          .put(`/v1/applications/${app.id}/eligibility-inputs`)
          .set('If-Match', '"1"')
          .send({ declaredMonthlyIncome: null, declaredIncomeSource: null })
      ).status,
    ).toBe(404);
    expect((await request(b).get(`/v1/applications/${app.id}/eligibility-assessments/latest`)).status).toBe(
      404,
    );
    expect((await run(b, app.id)).status).toBe(404);
    const crossOverride = await override(b, assessed.body.id, app.version, REASON);
    const missingOverride = await override(b, 'elg_missing_0001', app.version, REASON);
    expect(crossOverride.status).toBe(404);
    expect(crossOverride.body.error.message).toBe(missingOverride.body.error.message);
  });

  it('TEST-ELG-INT-18 every assessment, override and input change is audited without the values', async () => {
    const a = appFor(env.A, EDIT);
    const app = await seedApp(env.A);
    await putInputs(a, app.id, {
      credit: {
        score: 515,
        reportReference: 'RPT-INT-18',
        reportDate: new Date().toISOString().slice(0, 10),
      },
    });
    const assessed = await run(a, app.id);
    await override(a, assessed.body.id, app.version, REASON);
    const audit = await env.admin.query(
      `select action, permission_used, after::text as after_text from app.audit_event
        where entity_id = $1 and action in ('eligibility.assessed', 'eligibility.overridden', 'eligibility.inputs_updated')
        order by occurred_at`,
      [app.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'eligibility.inputs_updated',
      'eligibility.assessed',
      'eligibility.overridden',
    ]);
    expect(audit.rows.map((r) => r.permission_used)).toEqual([
      'application.update',
      'application.update',
      'eligibility.override',
    ]);
    for (const row of audit.rows) expect(row.after_text ?? '').not.toContain('RPT-INT-18');
  });

  it('TEST-ELG-INT-19 a run with the same Idempotency-Key replays the first assessment; a new key makes a second one', async () => {
    const a = appFor(env.A, EDIT);
    const app = await seedApp(env.A);
    const headers = key();
    const first = await run(a, app.id, headers);
    const replay = await run(a, app.id, headers);
    expect(replay.status).toBe(first.status);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    const second = await run(a, app.id);
    expect(second.body.id).not.toBe(first.body.id);
  });

  it("TEST-ELG-INT-20 record scope: a user limited to their own applications cannot assess another owner's application (404)", async () => {
    const owner = appFor(env.A, tenantGrants('application.read', 'application.update'), env.A.userIds[0]);
    const scoped: PermissionGrant[] = [
      { code: 'application.read', scope: 'OWN', branchIds: [] },
      { code: 'application.update', scope: 'OWN', branchIds: [] },
    ];
    const other = appFor(env.A, scoped, env.A.userIds[1]);
    const app = await seedApp(env.A, { sales: env.A.userIds[0] });
    expect((await run(other, app.id)).status).toBe(404);
    expect((await run(owner, app.id)).status).toBe(201);
  });

  it("TEST-ELG-INT-21 a co-applicant's accepted income document does not verify the applicant's income, on entry or in a check", async () => {
    const a = appFor(env.A, EDIT);
    const app = await seedApp(env.A);
    const coCustomer = next('cust_elg_co');
    const coParty = next('pty_elg_co');
    await env.admin.query(
      `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
       values ($1, $2, 'INDIVIDUAL', 'Eligibility Co-applicant', $3, $4, $4)`,
      [coCustomer, env.A.tenantId, env.A.branchId, env.A.userIds[0]],
    );
    await env.admin.query(
      `insert into app.application_party (id, tenant_id, application_id, customer_id, role, party_type, created_by)
       values ($1, $2, $3, $4, 'CO_APPLICANT', 'INDIVIDUAL', $5)`,
      [coParty, env.A.tenantId, app.id, coCustomer, env.A.userIds[0]],
    );
    const coItem = next('chk_elg_co');
    await env.admin.query(
      `insert into app.checklist_item (id, tenant_id, application_id, party_id, document_type_code, mandatory,
                                       source_decision_id, status, reviewed_by, reviewed_at, created_by, updated_by)
       values ($1, $2, $3, $4, 'SALARY_SLIP', true, 'dr_elg_co', 'ACCEPTED', $5, now(), $5, $5)`,
      [coItem, env.A.tenantId, app.id, coParty, env.A.userIds[0]],
    );
    const refused = await putInputs(a, app.id, {
      verifiedMonthlyIncome: { amount: '90000.00', currency: 'INR', checklistItemId: coItem },
    });
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body.error.details[0]).toMatchObject({ issue: 'NOT_PRIMARY' });

    // Even if such a link were made directly, a check does not treat it as the applicant's verified income.
    await putInputs(a, app.id, {
      declaredMonthlyIncome: { amount: '1.00', currency: 'INR' },
      declaredIncomeSource: 'APPLICANT_STATED',
    });
    await env.admin.query(
      `update app.applicant_financial_input set verified_monthly_income_amount = 90000.00,
             verified_income_checklist_item_id = $2, verified_at = now(), verified_by = $3
       where application_id = $1`,
      [app.id, coItem, env.A.userIds[0]],
    );
    const res = await run(a, app.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.results[0].result).not.toBe('PASS');
    expect(res.body.missingData).toContain('INCOME_EVIDENCE_NOT_PRIMARY');
  });

  it('TEST-ELG-INT-22 without the decision definition the check says so (503), and records nothing', async () => {
    const app = await seedApp(env.A);
    const unavailable = createApp({
      deps: {
        txRunner: createTxRunner(env.db),
        authz: createAuthz(),
        audit: createAuditPort(createIdGenerator()),
        ids: createIdGenerator(),
        userDirectory: createUserDirectory(),
        decisionPort: {
          decide: async () => {
            throw AppError.of('DECISION_KEY_UNKNOWN', 'Decision key not found.');
          },
        } as unknown as LiveDecisionEngine,
      },
      corsAllowedOrigins: [],
      auth: fakeAuth(
        testPrincipal({
          tenantId: env.A.tenantId,
          id: env.A.userIds[0],
          primaryBranchId: env.A.branchId,
          grants: EDIT,
        }),
      ),
    });
    const res = await run(unavailable, app.id);
    expect(res.status, JSON.stringify(res.body)).toBe(503);
    expect(res.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(res.body.error.message).toMatch(/not set up in this environment/);
  });

  it('TEST-ELG-INT-23 switching manual credit entry off stops its data being used, even when it was recorded before', async () => {
    const a = appFor(env.A, EDIT);
    const app = await seedApp(env.A);
    const item = await seedChecklistItem(env.A, app, 'SALARY_SLIP', 'ACCEPTED');
    await putInputs(a, app.id, {
      credit: {
        score: 790,
        reportReference: 'RPT-INT-23',
        reportDate: new Date().toISOString().slice(0, 10),
      },
      verifiedMonthlyIncome: { amount: '90000.00', currency: 'INR', checklistItemId: item },
    });
    expect((await run(a, app.id)).body.results[0].result).toBe('PASS');
    await setCreditFlag(env.A, false);
    try {
      const off = await run(a, app.id);
      expect(off.status).toBe(201);
      expect(off.body.results[0].result).not.toBe('PASS');
      expect(off.body.missingData).toContain('CREDIT_ENTRY_NOT_ENABLED');
    } finally {
      await setCreditFlag(env.A, true);
    }
  });
});
