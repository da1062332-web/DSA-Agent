// TEST-LMR-DSA-INT the lender-match inputs worked out the way a DSA does (2026-11-28), against a real database with the production
// wiring: the borrower's and the co-applicants' incomes clubbed, a guarantor's left out, everyone's EMIs counted, the age, pincode,
// constitution and vintage from the borrower's profile, and the property value from the file's collateral. Synthetic data only.
import type { PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

let env: IsolationEnv;
const APP = 'app_lmr_dsa_1';
const BORROWER = 'cust_lmr_dsa_1';
const SPOUSE = 'cust_lmr_dsa_2';
const GUARANTOR = 'cust_lmr_dsa_3';
const CODES: PermissionCode[] = ['application.read', 'application.update', 'lender_match.run'];

beforeAll(async () => {
  env = await startIsolationEnv();
  const a = env.A;
  const u = a.userIds[0];
  const q = (text: string, values: unknown[] = []) => env.admin.query(text, values);
  for (const [id, name] of [
    [BORROWER, 'Borrower Synthetic'],
    [SPOUSE, 'Spouse Synthetic'],
    [GUARANTOR, 'Guarantor Synthetic'],
  ]) {
    await q(
      `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
       values ($1, $2, 'INDIVIDUAL', $3, $4, $5, $5)`,
      [id, a.tenantId, name, a.branchId, u],
    );
  }
  const profile = (id: string, income: string | null, emis: string | null, extra = '') =>
    q(
      `insert into app.customer_profile (tenant_id, customer_id, employment_type, monthly_income, monthly_obligations,
                                          vintage_months, created_by, updated_by)
       values ($1, $2, 'SALARIED', $3, $4, ${extra || 'null'}, $5, $5)`,
      [a.tenantId, id, income, emis, u],
    );
  await profile(BORROWER, '60000.00', '10000.00', '40');
  await profile(SPOUSE, '40000.50', '5000.00');
  await profile(GUARANTOR, '900000.00', '20000.00');
  // The birth year sits beside the encrypted date of birth (both or neither, M-110); the bytes are a synthetic placeholder.
  await q(
    `insert into app.customer_identity (tenant_id, customer_id, dob_ciphertext, birth_year, created_by, updated_by)
     values ($1, $2, '\\x00'::bytea, 1990, $3, $3)`,
    [a.tenantId, BORROWER, u],
  );
  await q(
    `insert into app.customer_address (id, tenant_id, customer_id, address_type, line1, city, state, pincode, created_by, updated_by)
     values ('cad_lmr_dsa_1', $1, $2, 'PERMANENT', 'House 3, Synthetic Lane', 'Nashik', 'Maharashtra', '422001', $3, $3),
            ('cad_lmr_dsa_2', $1, $2, 'CURRENT', 'Flat 12, Shanti Heights', 'Pune', 'Maharashtra', '411045', $3, $3)`,
    [a.tenantId, BORROWER, u],
  );
  await q(
    `insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, requested_amount, tenure_months,
        applicant_type, sales_owner_id, created_by, updated_by)
     values ($1, $2, $3, $4, 'HL', 3750000.00, 240, 'SALARIED', $5, $5, $5)`,
    [APP, a.tenantId, a.branchId, BORROWER, u],
  );
  await q(
    `insert into app.application_party (id, tenant_id, application_id, customer_id, role, party_type, relationship_to_primary, created_by)
     values ('pty_lmr_dsa_1', $1, $2, $3, 'PRIMARY', 'INDIVIDUAL', null, $6),
            ('pty_lmr_dsa_2', $1, $2, $4, 'CO_APPLICANT', 'INDIVIDUAL', 'SPOUSE', $6),
            ('pty_lmr_dsa_3', $1, $2, $5, 'GUARANTOR', 'INDIVIDUAL', 'OTHER', $6)`,
    [a.tenantId, APP, BORROWER, SPOUSE, GUARANTOR, u],
  );
  await q(
    `insert into app.application_collateral (id, tenant_id, application_id, property_type, address_line1, city, state, pincode,
        estimated_market_value_paise, ownership_type, created_by, updated_by)
     values ('acol_lmr_dsa_1', $1, $2, 'RESIDENTIAL_FLAT', 'Flat 12, Shanti Heights', 'Pune', 'Maharashtra', '411045',
             500000000, 'FREEHOLD', $3, $3),
            ('acol_lmr_dsa_2', $1, $2, 'RESIDENTIAL_PLOT', 'Plot 7, Synthetic Nagar', 'Pune', 'Maharashtra', '411046',
             100000050, 'FREEHOLD', $3, $3)`,
    [a.tenantId, APP, u],
  );
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

describe('TEST-LMR-DSA-INT lender-match inputs, the DSA way', () => {
  it('TEST-LMR-DSA-INT-01 clubs borrower and co-applicant income, counts both EMIs, and leaves the guarantor out', async () => {
    const res = await request(env.appAs(env.A, CODES)).get(`/v1/applications/${APP}/lender-matches/inputs`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { inputs, sources, borrowers, collateralItems } = res.body;
    expect(inputs.monthlyIncome).toEqual({ amount: '100000.50', currency: 'INR' });
    expect(sources.monthlyIncome).toBe('CO_APPLICANTS');
    expect(inputs.monthlyObligations).toEqual({ amount: '15000.00', currency: 'INR' });
    expect(sources.monthlyObligations).toBe('CO_APPLICANTS');
    expect(
      borrowers.map((b: { customerId: string; role: string; counted: boolean }) => [
        b.customerId,
        b.role,
        b.counted,
      ]),
    ).toEqual([
      [BORROWER, 'PRIMARY', true],
      [SPOUSE, 'CO_APPLICANT', true],
      [GUARANTOR, 'GUARANTOR', false],
    ]);
    expect(borrowers[1]).toMatchObject({ relationshipToPrimary: 'SPOUSE', incomeSource: 'CUSTOMER_PROFILE' });
    expect(collateralItems).toBe(2);
    expect(inputs.collateralValue).toEqual({ amount: '6000000.50', currency: 'INR' });
    expect(sources.collateralValue).toBe('COLLATERAL');
  });

  it('TEST-LMR-DSA-INT-02 age, pincode (CURRENT before PERMANENT) and vintage come from the borrower’s profile', async () => {
    const res = await request(env.appAs(env.A, CODES)).get(`/v1/applications/${APP}/lender-matches/inputs`);
    const { inputs, sources } = res.body;
    expect(inputs.ageYears).toBeGreaterThanOrEqual(35);
    expect(sources.ageYears).toBe('CUSTOMER_PROFILE');
    expect(inputs.pincode).toBe('411045');
    expect(inputs.vintageMonths).toBe(40);
    // Never the date of birth or a PAN.
    expect(JSON.stringify(res.body)).not.toMatch(/dateOfBirth|dob|pan/i);
  });

  it('TEST-LMR-DSA-INT-03 the borrower’s own figure on the application wins over the profile', async () => {
    await env.admin.query(
      `insert into app.applicant_financial_input (id, tenant_id, application_id, declared_monthly_income_amount,
                                                  declared_income_source, declared_at, declared_by, created_by, updated_by)
       values ('afi_lmr_dsa_1', $1, $2, 70000.00, 'APPLICANT_STATED', now(), $3, $3, $3)`,
      [env.A.tenantId, APP, env.A.userIds[0]],
    );
    const res = await request(env.appAs(env.A, CODES)).get(`/v1/applications/${APP}/lender-matches/inputs`);
    expect(res.body.borrowers[0]).toMatchObject({
      monthlyIncome: { amount: '70000.00', currency: 'INR' },
      incomeSource: 'FINANCIAL_INPUT',
    });
    expect(res.body.inputs.monthlyIncome).toEqual({ amount: '110000.50', currency: 'INR' });
  });

  it('TEST-LMR-DSA-INT-04 another tenant cannot read the inputs (404)', async () => {
    const res = await request(env.appAs(env.B, CODES)).get(`/v1/applications/${APP}/lender-matches/inputs`);
    expect(res.status).toBe(404);
  });
});
