// packages/contracts/src/ports/lender-port.ts — owner: Dev 3 (MOD-LND Lenders provides). Lets other modules confirm a lender
// exists in the caller's tenant without reading the lender tables. Runs inside the caller's transaction.
import type { Tx } from '../kernel';

export interface LenderPort {
  /** False when the lender does not exist in the caller's tenant (row-level security hides other tenants). */
  exists(tx: Tx, lenderId: string): Promise<boolean>;
}
