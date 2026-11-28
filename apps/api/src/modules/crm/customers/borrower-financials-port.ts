// BorrowerFinancialsPort (owner: Bhushan, customers lane; 2026-11-28). What a lender looks at for each borrower on a file, read from the
// customer profile (P1-02, migration 0110): income, existing EMIs, employment or constitution, vintage, birth year and pincode. It runs
// inside the caller's transaction, so row-level security keeps it to the caller's tenant. The PAN and the date of birth are never read:
// the age comes from the birth year kept beside the encrypted date.
import type { BorrowerFinancials, BorrowerFinancialsPort, Tx } from '@dsa/contracts';
import { sql } from 'kysely';

type Row = Record<string, unknown>;

const money = (amount: unknown, currency: unknown) =>
  amount === null || amount === undefined
    ? null
    : { amount: Number(amount).toFixed(2), currency: String(currency ?? 'INR') };

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function createBorrowerFinancialsPort(): BorrowerFinancialsPort {
  return {
    async getFinancials(tx: Tx, customerIds: readonly string[]): Promise<BorrowerFinancials[]> {
      if (customerIds.length === 0) return [];
      const ids = [...new Set(customerIds)];
      const r = await sql<Row>`
        select c.id, c.party_type,
               p.monthly_income, p.monthly_obligations, p.currency, p.employment_type, p.constitution, p.vintage_months,
               i.birth_year,
               (select a.pincode from customer_address a
                 where a.tenant_id = c.tenant_id and a.customer_id = c.id and a.removed_at is null
                 order by case a.address_type when 'CURRENT' then 1 when 'OFFICE' then 2 else 3 end
                 limit 1) as pincode
          from customer c
          left join customer_profile p on p.tenant_id = c.tenant_id and p.customer_id = c.id
          left join customer_identity i on i.tenant_id = c.tenant_id and i.customer_id = c.id
         where c.id = any(${ids}::text[])`.execute(tx);
      return r.rows.map((row) => ({
        customerId: String(row.id),
        partyType: row.party_type as BorrowerFinancials['partyType'],
        monthlyIncome: money(row.monthly_income, row.currency),
        monthlyObligations: money(row.monthly_obligations, row.currency),
        employmentType: (row.employment_type as string | null) ?? null,
        constitution: (row.constitution as string | null) ?? null,
        vintageMonths: num(row.vintage_months),
        birthYear: num(row.birth_year),
        pincode: (row.pincode as string | null) ?? null,
      }));
    },
  };
}
