// TEST-SEC-001 cases for origination/verifications credit reports (owner: Prathamesh, MOD-VER, task P1-05: API-CRP-001 POST
// /v1/customers/{id}/credit-reports, API-CRP-002 GET .../latest, API-CRP-003 GET .../credit-reports). Tenant B holds every credit-report
// permission and still must not pull for, read or list the reports of a tenant A customer, nor use tenant A's bureau connection. Tenant A
// reads its own report as a control, so a 404 for B cannot be a route that is simply broken. No bureau is ever called: tenant A's
// connection points at a host that cannot resolve (.invalid), and tenant B has none.
import type { PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_ADMIN, startIsolationEnv, type IsolationEnv, type TenantFixture } from '../harness';

const CRP: PermissionCode[] = [...ALL_ADMIN, 'credit_report.pull', 'credit_report.read'];
const PAN = 'JQXWV5182D';

let env: IsolationEnv;
beforeAll(async () => {
  env = await startIsolationEnv();
});
afterAll(async () => {
  await env?.stop();
});

const consentId = (tag: string) => `cnst_${tag.padEnd(26, '0')}`;

async function seedCustomer(t: TenantFixture, customerId: string, consent: string) {
  const user = t.userIds[0];
  await env.admin.query(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Isolation Customer', $3, $4, $4)`,
    [customerId, t.tenantId, t.branchId, user],
  );
  await env.admin.query(
    `insert into app.consent_record (id, tenant_id, subject_type, subject_id, purpose, purpose_target, notice_version, channel,
                                     captured_by, captured_at)
     values ($1, $2, 'CUSTOMER', $3, 'BUREAU_PULL', 'CIBIL', 'V1', 'OTP', $4, now())`,
    [consent, t.tenantId, customerId, user],
  );
}

async function seedReport(t: TenantFixture, id: string, customerId: string, consent: string) {
  await env.admin.query(
    `insert into app.credit_report (id, tenant_id, customer_id, consent_record_id, bureau, provider, outcome, report_date, score,
                                    active_accounts, monthly_emi_amount, max_dpd_12m, enquiries_6m, pulled_by, pulled_at)
     values ($1, $2, $3, $4, 'CIBIL', 'CRIF', 'SCORED', '2026-11-28', 742, 3, 18400.00, 0, 1, $5, now())`,
    [id, t.tenantId, customerId, consent, t.userIds[0]],
  );
}

const reportCount = async (customerId: string) =>
  (
    await env.admin.query('select count(*)::int as n from app.credit_report where customer_id = $1', [
      customerId,
    ])
  ).rows[0].n;

const pullBody = { bureau: 'CIBIL', name: 'Isolation Customer', pan: PAN, dateOfBirth: '1987-06-23' };

describe('TEST-SEC-001 origination/verifications credit reports: tenants never cross', () => {
  it('API-CRP-001: tenant B cannot pull a report for a tenant A customer with tenant A consent (404, not 403) and nothing is stored', async () => {
    const consent = consentId('01JCRPA1');
    await seedCustomer(env.A, 'cust_iso_crp_a1', consent);
    const b = env.appAs(env.B, CRP);

    const res = await request(b)
      .post('/v1/customers/cust_iso_crp_a1/credit-reports')
      .set('Idempotency-Key', 'iso-crp-pull-01')
      .send(pullBody);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(res.body)).not.toContain(env.A.tenantId);
    expect(res.text).not.toContain(PAN);
    expect(await reportCount('cust_iso_crp_a1')).toBe(0);
  });

  it("API-CRP-001: tenant B cannot use tenant A's bureau connection: B has a customer and consent of its own and no connection, so the answer is 422 NO_ACTIVE_CONNECTION", async () => {
    await env.admin.query(
      `insert into app.integration_connection (id, tenant_id, provider, capability, environment, credential_ref, config, status,
                                               created_by, updated_by)
       values ('itc_iso_crp_a1', $1, 'CRIF', 'BUREAU.SOFT_PULL', 'SANDBOX', $2, $3::jsonb, 'ACTIVE', $4, $4)`,
      [
        env.A.tenantId,
        `vault://tenants/${env.A.tenantId}/sandbox/crif/credentials`,
        JSON.stringify({ apiEndpoint: 'https://bureau.example.invalid/v1/pull' }),
        env.A.userIds[0],
      ],
    );
    const consent = consentId('01JCRPB1');
    await seedCustomer(env.B, 'cust_iso_crp_b1', consent);
    const b = env.appAs(env.B, CRP);

    const res = await request(b)
      .post('/v1/customers/cust_iso_crp_b1/credit-reports')
      .set('Idempotency-Key', 'iso-crp-pull-02')
      .send(pullBody);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([{ field: 'bureau', issue: 'NO_ACTIVE_CONNECTION' }]);
    expect(JSON.stringify(res.body)).not.toContain(env.A.tenantId);
    expect(await reportCount('cust_iso_crp_b1')).toBe(0);
  });

  it('API-CRP-002: tenant B cannot read the latest report of a tenant A customer (404), while tenant A reads its own (control)', async () => {
    const consent = consentId('01JCRPA2');
    await seedCustomer(env.A, 'cust_iso_crp_a2', consent);
    await seedReport(env.A, 'crp_iso_a2', 'cust_iso_crp_a2', consent);

    const b = await request(env.appAs(env.B, CRP)).get('/v1/customers/cust_iso_crp_a2/credit-reports/latest');
    const a = await request(env.appAs(env.A, CRP)).get('/v1/customers/cust_iso_crp_a2/credit-reports/latest');

    expect(b.status).toBe(404);
    expect(b.body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(b.body)).not.toContain(env.A.tenantId);
    expect(JSON.stringify(b.body)).not.toContain('crp_iso_a2');
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({
      id: 'crp_iso_a2',
      customerId: 'cust_iso_crp_a2',
      score: 742,
      bureau: 'CIBIL',
    });
    // The summary holds no PAN, date of birth or name, in either answer.
    expect(JSON.stringify(a.body)).not.toContain(PAN);
  });

  it('API-CRP-003: tenant B cannot list the reports of a tenant A customer (404), while tenant A lists its own (control)', async () => {
    const consent = consentId('01JCRPA3');
    await seedCustomer(env.A, 'cust_iso_crp_a3', consent);
    await seedReport(env.A, 'crp_iso_a3', 'cust_iso_crp_a3', consent);

    const b = await request(env.appAs(env.B, CRP)).get('/v1/customers/cust_iso_crp_a3/credit-reports');
    const a = await request(env.appAs(env.A, CRP)).get('/v1/customers/cust_iso_crp_a3/credit-reports');

    expect(b.status).toBe(404);
    expect(JSON.stringify(b.body)).not.toContain('crp_iso_a3');
    expect(a.status).toBe(200);
    expect(a.body.data.map((r: { id: string }) => r.id)).toEqual(['crp_iso_a3']);
    expect(a.body.meta).toMatchObject({ nextCursor: null });
  });

  it("API-CRP-003: a tenant B customer's own list never shows a tenant A report, even when the customer ids are guessed", async () => {
    const consent = consentId('01JCRPB4');
    await seedCustomer(env.B, 'cust_iso_crp_b4', consent);

    const res = await request(env.appAs(env.B, CRP)).get('/v1/customers/cust_iso_crp_b4/credit-reports');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('API-CRP-001: a user without credit_report.pull is refused (403) before anything is read, in either tenant; reading needs credit_report.read', async () => {
    const consent = consentId('01JCRPB2');
    await seedCustomer(env.B, 'cust_iso_crp_b2', consent);
    const readOnly = env.appAs(env.B, [...ALL_ADMIN, 'credit_report.read']);
    const pullOnly = env.appAs(env.B, [...ALL_ADMIN, 'credit_report.pull']);

    const pull = await request(readOnly)
      .post('/v1/customers/cust_iso_crp_b2/credit-reports')
      .set('Idempotency-Key', 'iso-crp-pull-03')
      .send(pullBody);
    const latest = await request(pullOnly).get('/v1/customers/cust_iso_crp_b2/credit-reports/latest');
    const list = await request(pullOnly).get('/v1/customers/cust_iso_crp_b2/credit-reports');

    expect(pull.status).toBe(403);
    expect(latest.status).toBe(403);
    expect(list.status).toBe(403);
    expect(await reportCount('cust_iso_crp_b2')).toBe(0);
  });
});
