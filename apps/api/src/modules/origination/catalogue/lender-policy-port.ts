// LenderPolicyPort (owner: Dipanshu; task P1-04). The policies a match run evaluates, for the applications module, which never
// reads the catalogue tables itself. Runs inside the caller's transaction; row-level security limits it to the caller's tenant.
// A policy is matchable when the policy, its lender, product and product version are all ACTIVE and the lender holds an ACTIVE
// empanelment valid on `now` that permits the application's product category. Whether the policy is in its effective window is
// left to bre-core (POLICY_NOT_EFFECTIVE), so the result says why a lender was skipped rather than hiding it.
import type { LenderPolicyPort, MatchablePolicy, PolicyLabel, Tx } from '@dsa/contracts';
import { moneyToPaise } from '@dsa/contracts';
import { sql } from 'kysely';
import { iso, type Row } from './db';

const paise = (v: unknown) => moneyToPaise({ amount: String(v), currency: 'INR' });
const intOrNull = (v: unknown) => (v == null ? null : Number(v));

export function createLenderPolicyPort(): LenderPolicyPort {
  return {
    async matchablePolicies(tx: Tx, category: string, now: Date): Promise<MatchablePolicy[]> {
      const r = await sql<Row>`
        select lp.*, l.name as lender_name, p.name as product_name,
               v.amount_min, v.amount_max, v.tenure_min_months, v.tenure_max_months
          from lender_policy lp
          join lender l on l.id = lp.lender_id and l.tenant_id = lp.tenant_id
          join loan_product_version v on v.id = lp.product_version_id and v.tenant_id = lp.tenant_id
          join loan_product p on p.id = v.product_id and p.tenant_id = v.tenant_id
         where lp.status = 'ACTIVE' and l.status = 'ACTIVE' and p.status = 'ACTIVE' and v.status = 'ACTIVE'
           and p.category = ${category}
           and exists (
             select 1 from empanelment e
              where e.tenant_id = lp.tenant_id and e.lender_id = lp.lender_id and e.status = 'ACTIVE'
                and e.valid_range @> (${now}::timestamptz at time zone 'Asia/Kolkata')::date
                and ${category} = any(e.permitted_categories))
         order by lp.id`.execute(tx);
      return r.rows.map((row) => ({
        policyId: String(row.id),
        lenderId: String(row.lender_id),
        lenderName: String(row.lender_name),
        productVersionId: String(row.product_version_id),
        productName: String(row.product_name),
        amountMinPaise: paise(row.amount_min),
        amountMaxPaise: paise(row.amount_max),
        tenureMinMonths: Number(row.tenure_min_months),
        tenureMaxMonths: Number(row.tenure_max_months),
        minBureauScore: intOrNull(row.min_bureau_score),
        minAge: intOrNull(row.min_age),
        maxAgeAtMaturity: intOrNull(row.max_age_at_maturity),
        minIncomePaise: row.min_income == null ? null : paise(row.min_income),
        foirCapBps: intOrNull(row.foir_cap_bps),
        ltvCapBps: intOrNull(row.ltv_cap_bps),
        rateMinBps: Number(row.rate_min_bps),
        rateMaxBps: Number(row.rate_max_bps),
        processingFeeBps: intOrNull(row.processing_fee_bps),
        serviceablePincodes: (row.serviceable_pincodes as string[]) ?? [],
        allowedConstitutions: (row.allowed_constitutions as string[]) ?? [],
        allowedEmployment: (row.allowed_employment as string[]) ?? [],
        minVintageMonths: intOrNull(row.min_vintage_months),
        effectiveFrom: iso(row.effective_from),
        effectiveTo: row.effective_to == null ? null : iso(row.effective_to),
      }));
    },

    async describePolicies(tx: Tx, policyIds: readonly string[]): Promise<Map<string, PolicyLabel>> {
      const out = new Map<string, PolicyLabel>();
      if (policyIds.length === 0) return out;
      const r = await sql<Row>`
        select lp.id, lp.rate_min_bps, lp.rate_max_bps, l.name as lender_name, p.name as product_name
          from lender_policy lp
          join lender l on l.id = lp.lender_id and l.tenant_id = lp.tenant_id
          join loan_product_version v on v.id = lp.product_version_id and v.tenant_id = lp.tenant_id
          join loan_product p on p.id = v.product_id and p.tenant_id = v.tenant_id
         where lp.id = any(${[...policyIds]}::text[])`.execute(tx);
      for (const row of r.rows) {
        out.set(String(row.id), {
          lenderName: String(row.lender_name),
          productName: String(row.product_name),
          rateMinBps: Number(row.rate_min_bps),
          rateMaxBps: Number(row.rate_max_bps),
        });
      }
      return out;
    },
  };
}
