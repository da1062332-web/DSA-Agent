// Lender gates (owner: Dev 3; DSA Notion MODULE 14, SUB-LND.02 and SUB-LND.05). Called when a lender case is created.
// Lender cases belong to Dev 4 and must not import this module directly: the call goes through a port in
// @dsa/contracts once that port is agreed (eslint boundary rule). Until then this is the single implementation.
import { AppError, type Tx } from '@dsa/contracts';
import { sql } from 'kysely';

export interface LenderGateInput {
  lenderId: string;
  category: string; // product category, e.g. 'PL'
  on: string; // business date, YYYY-MM-DD
}

/**
 * Throws when a lender case may not be created:
 *  - 422 LENDER_PAUSED: the lender is PAUSED or TERMINATED (the spec defines only this code for both).
 *  - 422 EMPANELMENT_INACTIVE: no ACTIVE empanelment covers the category on the date.
 */
export async function assertLenderOpenForCases(tx: Tx, input: LenderGateInput): Promise<void> {
  const lender = await sql<{
    status: string;
  }>`select status from lender where id = ${input.lenderId}`.execute(tx);
  const status = lender.rows[0]?.status;
  if (!status) throw AppError.of('NOT_FOUND', 'Lender not found.');
  if (status !== 'ACTIVE') {
    throw AppError.of('LENDER_PAUSED', 'This lender is not accepting new cases.', [
      { field: 'lenderId', issue: 'LENDER_NOT_ACTIVE', meta: { status } },
    ]);
  }

  const emp = await sql<{ id: string }>`
    select id from empanelment
     where lender_id = ${input.lenderId}
       and status = 'ACTIVE'
       and valid_range @> ${input.on}::date
       and ${input.category}::text = any(permitted_categories)
     limit 1`.execute(tx);
  if (!emp.rows[0]) {
    throw AppError.of(
      'EMPANELMENT_INACTIVE',
      'The DSA is not empanelled with this lender for this product on this date.',
      [
        {
          field: 'lenderId',
          issue: 'NO_ACTIVE_EMPANELMENT',
          meta: { category: input.category, on: input.on },
        },
      ],
    );
  }
}
