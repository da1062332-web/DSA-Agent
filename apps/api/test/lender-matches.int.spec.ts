// P1-04 multi-lender matching against a real database (owner: Dipanshu). A throwaway PostgreSQL 16 container with every migration
// applied, connected as dsa_api with the production dependencies (LenderPolicyPort included), so RLS, the result CHECKs, audit and
// idempotency behave as deployed. The catalogue is seeded as the superuser; the spec example (Notion P1-04) is lender A:
// ₹10,00,000 over 60 months, income ₹60,000, obligations ₹10,000, FOIR cap 50 % at 12 % → eligible ₹8,99,100 (FOIR-limited).
// Synthetic data only.
import { LenderMatchPrefillSchema, LenderMatchRunSchema, type PermissionCode } from '@dsa/contracts';
import { createIdGenerator } from '@dsa/kernel';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv, type TenantFixture } from '../../../tests/isolation/harness';

let env: IsolationEnv;
const ids = createIdGenerator();
const RUN: PermissionCode[] = ['lender_match.run'];
let appId: string;
let bareAppId: string;
const policy: Record<'A' | 'B' | 'C' | 'D', string> = { A: '', B: '', C: '', D: '' };
let n = 0;
const key = () => `lmr-int-${String(++n).padStart(6, '0')}`;

async function lender(
  t: TenantFixture,
  name: string,
  opts: { category?: string; empanelled?: boolean } = {},
): Promise<{ lenderId: string; versionId: string }> {
  const lenderId = ids.next('lnd');
  const productId = ids.next('prd');
  const versionId = ids.next('prv');
  const u = t.userIds[0];
  await env.admin.query(
    `insert into app.lender (id, tenant_id, name, lender_type, created_by, updated_by) values ($1, $2, $3, 'NBFC', $4, $4)`,
    [lenderId, t.tenantId, name, u],
  );
  await env.admin.query(
    `insert into app.loan_product (id, tenant_id, lender_id, name, category, applicant_types, secured, created_by, updated_by)
     values ($1, $2, $3, $4, $5, '{SALARIED}', false, $6, $6)`,
    [productId, t.tenantId, lenderId, `${name} PL`, opts.category ?? 'PL', u],
  );
  await env.admin.query(
    `insert into app.loan_product_version (id, tenant_id, product_id, version_no, effective_from, amount_min, amount_max, currency,
                                           tenure_min_months, tenure_max_months, created_by)
     values ($1, $2, $3, 1, '2026-01-01T00:00:00Z', 50000, 1500000, 'INR', 12, 60, $4)`,
    [versionId, t.tenantId, productId, u],
  );
  if (opts.empanelled !== false) {
    await env.admin.query(
      `insert into app.empanelment (id, tenant_id, organisation_id, lender_id, dsa_code, valid_range, permitted_categories, status,
                                    created_by, updated_by)
       values ($1, $2, $3, $4, $5, daterange(current_date - 30, current_date + 365), '{PL,HL}', 'ACTIVE', $6, $6)`,
      [ids.next('emp'), t.tenantId, t.orgId, lenderId, `DSA-${name.replace(/\W/g, '')}`, u],
    );
  }
  return { lenderId, versionId };
}

async function activePolicy(
  t: TenantFixture,
  l: { lenderId: string; versionId: string },
  terms: Record<string, unknown>,
): Promise<string> {
  const id = ids.next('lpo');
  const cols = Object.keys(terms);
  await env.admin.query(
    `insert into app.lender_policy (id, tenant_id, lender_id, product_version_id, status, version_no, rate_min_bps, rate_max_bps,
                                    effective_from, editors, approved_by, approved_at, created_by, updated_by
                                    ${cols.map((c) => `, ${c}`).join('')})
     values ($1, $2, $3, $4, 'ACTIVE', 1, 1050, 1200, '2026-01-01T00:00:00Z', $5, $6, now(), $7, $7
             ${cols.map((_, i) => `, $${i + 8}`).join('')})`,
    [
      id,
      t.tenantId,
      l.lenderId,
      l.versionId,
      [t.userIds[0]],
      t.userIds[1],
      t.userIds[0],
      ...Object.values(terms),
    ],
  );
  return id;
}

async function application(t: TenantFixture, withFigures: boolean): Promise<string> {
  const id = ids.next('app');
  const customer = ids.next('cust');
  const u = t.userIds[0];
  await env.admin.query(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Match Customer', $3, $4, $4)`,
    [customer, t.tenantId, t.branchId, u],
  );
  await env.admin.query(
    `insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, requested_amount, tenure_months,
                                       applicant_type, status, sales_owner_id, created_by, updated_by)
     values ($1, $2, $3, $4, 'PL', 1000000.00, 60, 'SALARIED', 'DRAFT', $5, $5, $5)`,
    [id, t.tenantId, t.branchId, customer, u],
  );
  if (withFigures) {
    await env.admin.query(
      `insert into app.applicant_financial_input (id, tenant_id, application_id, declared_monthly_income_amount,
                                                  declared_income_source, declared_at, declared_by, credit_score,
                                                  credit_report_reference, credit_report_date, created_by, updated_by)
       values ($1, $2, $3, 60000.00, 'APPLICANT_STATED', now(), $4, 742, 'SYN-REPORT-1', current_date - 5, $4, $4)`,
      [ids.next('elg'), t.tenantId, id, u],
    );
  }
  return id;
}

beforeAll(async () => {
  env = await startIsolationEnv();
  const A = env.A;
  policy.A = await activePolicy(A, await lender(A, 'Lender A'), { foir_cap_bps: 5000 });
  policy.B = await activePolicy(A, await lender(A, 'Lender B'), { min_bureau_score: 760 });
  policy.C = await activePolicy(A, await lender(A, 'Lender C'), { serviceable_pincodes: ['411'] });
  policy.D = await activePolicy(A, await lender(A, 'Lender D'), { ltv_cap_bps: 7000 });
  // Never evaluated: no empanelment, another category, and tenant B's own lender.
  await activePolicy(A, await lender(A, 'Lender E', { empanelled: false }), {});
  await activePolicy(A, await lender(A, 'Lender F', { category: 'HL' }), {});
  await activePolicy(env.B, await lender(env.B, 'Lender B-tenant'), {});
  appId = await application(A, true);
  bareAppId = await application(A, false);
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

const runMatch = (body: Record<string, unknown>, k = key(), app = env.appAs(env.A, RUN)) =>
  request(app).post(`/v1/applications/${appId}/lender-matches`).set('Idempotency-Key', k).send(body);

describe('P1-04 lender matching against PostgreSQL', () => {
  it('TEST-LMR-INT-001 the prefill reads the application and its recorded figures, and says where each came from', async () => {
    const res = await request(env.appAs(env.A, RUN)).get(`/v1/applications/${appId}/lender-matches/inputs`);
    expect(res.status).toBe(200);
    const body = LenderMatchPrefillSchema.parse(res.body);
    expect(body.inputs).toMatchObject({
      requestedAmount: { amount: '1000000.00', currency: 'INR' },
      tenureMonths: 60,
      employmentType: 'SALARIED',
      monthlyIncome: { amount: '60000.00', currency: 'INR' },
      bureauScore: 742,
      monthlyObligations: null,
      pincode: null,
    });
    expect(body.sources).toMatchObject({
      requestedAmount: 'APPLICATION',
      monthlyIncome: 'FINANCIAL_INPUT',
      bureauScore: 'FINANCIAL_INPUT',
      pincode: null,
    });
  });

  it('TEST-LMR-INT-002 the spec example: A is eligible for ₹8,99,100 (FOIR), D needs data, B and C are refused with reasons', async () => {
    const res = await runMatch({
      monthlyObligations: { amount: '10000.00', currency: 'INR' },
      pincode: '560034',
    });
    expect(res.status).toBe(201);
    const run = LenderMatchRunSchema.parse(res.body);
    expect(run.policyCount).toBe(4);
    expect(run.eligibleCount).toBe(1);
    expect(run.results[0]).toMatchObject({
      rank: 1,
      policyId: policy.A,
      lenderName: 'Lender A',
      outcome: 'ELIGIBLE',
      eligibleAmount: { amount: '899100.00', currency: 'INR' },
      limitedBy: 'FOIR',
    });
    expect(run.results[1]).toMatchObject({
      policyId: policy.D,
      outcome: 'NEEDS_DATA',
      missingFields: ['collateralValue'],
    });
    const refused = Object.fromEntries(run.results.slice(2).map((r) => [r.policyId, r.reasons]));
    expect(refused).toEqual({
      [policy.B]: ['BUREAU_SCORE_BELOW_MIN'],
      [policy.C]: ['PINCODE_NOT_SERVICEABLE'],
    });

    const stored = await env.admin.query(
      `select rank, outcome, eligible_amount::text from app.lender_match_result where run_id = $1 order by rank`,
      [run.id],
    );
    expect(stored.rows.map((r) => r.outcome)).toEqual([
      'ELIGIBLE',
      'NEEDS_DATA',
      'NOT_ELIGIBLE',
      'NOT_ELIGIBLE',
    ]);
    expect(stored.rows[0].eligible_amount).toBe('899100.00');

    // The audit trail holds the hash and the counts, never the figures (personal financial data).
    const audit = await env.admin.query(
      `select action, after::text as after from app.audit_event where entity_id = $1 and action = 'lender_match.run'`,
      [appId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].after).toContain(run.inputsHash);
    expect(audit.rows[0].after).not.toContain('60000');
  });

  it('TEST-LMR-INT-003 a replay with the same Idempotency-Key returns the stored run and stores nothing new', async () => {
    const k = key();
    const first = await runMatch({ monthlyObligations: { amount: '10000.00', currency: 'INR' } }, k);
    const again = await runMatch({ monthlyObligations: { amount: '10000.00', currency: 'INR' } }, k);
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body.id).toBe(first.body.id);
    const runs = await env.admin.query(`select count(*)::int as n from app.lender_match_run where id = $1`, [
      first.body.id,
    ]);
    expect(runs.rows[0].n).toBe(1);
  });

  it('TEST-LMR-INT-004 latest returns the most recent run exactly as it was stored', async () => {
    const posted = await runMatch({
      monthlyObligations: { amount: '10000.00', currency: 'INR' },
      pincode: '411001',
      collateralValue: { amount: '2000000.00', currency: 'INR' },
    });
    const latest = await request(env.appAs(env.A, RUN)).get(
      `/v1/applications/${appId}/lender-matches/latest`,
    );
    expect(latest.status).toBe(200);
    expect(LenderMatchRunSchema.parse(latest.body)).toEqual(posted.body);
    // Pincode 411001 is served by C, and collateral lets D size the loan: three eligible now, B still refused on score.
    expect(posted.body.eligibleCount).toBe(3);
  });

  it('TEST-LMR-INT-005 a null override clears a prefilled value for this run only', async () => {
    const res = await runMatch({
      bureauScore: null,
      monthlyObligations: { amount: '10000.00', currency: 'INR' },
    });
    const b = res.body.results.find((r: { policyId: string }) => r.policyId === policy.B);
    expect(b).toMatchObject({ outcome: 'NEEDS_DATA', missingFields: ['bureauScore'] });
    const prefill = await request(env.appAs(env.A, RUN)).get(
      `/v1/applications/${appId}/lender-matches/inputs`,
    );
    expect(prefill.body.inputs.bureauScore).toBe(742);
  });

  it('TEST-LMR-INT-006 before the first run, latest is 404 NO_MATCH_RUN; without figures, the prefill leaves them empty', async () => {
    const latest = await request(env.appAs(env.A, RUN)).get(
      `/v1/applications/${bareAppId}/lender-matches/latest`,
    );
    expect(latest.status).toBe(404);
    expect(latest.body.error.details[0].issue).toBe('NO_MATCH_RUN');
    const prefill = await request(env.appAs(env.A, RUN)).get(
      `/v1/applications/${bareAppId}/lender-matches/inputs`,
    );
    expect(prefill.body.inputs).toMatchObject({ monthlyIncome: null, bureauScore: null, tenureMonths: 60 });
  });

  it('TEST-LMR-INT-007 an unknown application is 404, and a caller without lender_match.run is 403', async () => {
    const unknown = await request(env.appAs(env.A, RUN))
      .post(`/v1/applications/${ids.next('app')}/lender-matches`)
      .set('Idempotency-Key', key())
      .send({});
    expect(unknown.status).toBe(404);
    const denied = await request(env.appAs(env.A, ['application.read', 'lender_policy.read'])).get(
      `/v1/applications/${appId}/lender-matches/latest`,
    );
    expect(denied.status).toBe(403);
  });

  it('TEST-LMR-INT-008 the EMI calculator gives the spec EMI for ₹10,00,000 at 12 % over 60 months', async () => {
    const res = await request(env.appAs(env.A, RUN))
      .post('/v1/emi-calculations')
      .send({ principal: { amount: '1000000.00', currency: 'INR' }, annualRateBps: 1200, tenureMonths: 60 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      emi: { amount: '22244.45', currency: 'INR' },
      totalPayable: { amount: '1334667.00', currency: 'INR' },
      totalInterest: { amount: '334667.00', currency: 'INR' },
    });
  });
});
