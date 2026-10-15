// LenderPort (owner: Dev 3). Answers "does this lender exist for this tenant?" for other modules, such as grievances
// (lender referral). Runs inside the caller's transaction; row-level security limits the lookup to the caller's tenant.
import type { LenderPort, Tx } from '@dsa/contracts';
import { sql } from 'kysely';

export function createLenderPort(): LenderPort {
  return {
    async exists(tx: Tx, lenderId: string): Promise<boolean> {
      const r = await sql<{ id: string }>`select id from lender where id = ${lenderId}`.execute(tx);
      return r.rows.length > 0;
    },
  };
}
