// packages/contracts/src/ports/commission-port.ts — owner: Devyani — added 2026-11-27 (P2-01, additive, Contracts §15).
//
// Consumers: the invoices module, which bills a lender for a month's commission (P2-01), and reconciliation, which
// matches a lender's payout statement against what was earned (P2-02). Both sit outside the finance module, so neither
// reads commission_calculation itself.
import type { RequestContext, Tx } from '../kernel';
import type { ProductCategory } from './decision-keys';

/** One earned commission line as a module outside finance sees it. Every amount is a decimal string, never a float. */
export interface EarnedCommissionLine {
  calculationId: string;
  lenderId: string;
  trancheId: string;
  applicationId: string | null;
  productCategory: ProductCategory | null;
  /** The qualifying event's date, YYYY-MM-DD. */
  eventDate: string;
  basisAmount: string;
  /** The rate applied, as a decimal fraction. 'FLAT' lines carry 0 here and the whole amount in grossAmount. */
  rate: string;
  rateType: string;
  grossAmount: string;
  currency: string;
  /** The payout-grid band that produced the rate; null for a hand-priced calculation or one made before slabs existed. */
  slabId: string | null;
}

/**
 * How a lender's commission invoice is taxed, from that lender's active commission plan.
 *
 * `taxTreatment` decides whether the invoice carries GST at all. Under Notification 13/2017-Central Tax (Rate) Sl. No. 11
 * an individual or proprietorship DSA billing a bank or NBFC is under reverse charge: the lender accounts for the tax and
 * the invoice shows none. A body corporate, partnership or LLP charges it under forward charge. Which applies follows
 * from the tenant's constitution and is confirmed per tenant rather than inferred, so it is stored on the plan.
 */
export interface CommissionInvoiceTerms {
  taxTreatment: 'FORWARD_CHARGE' | 'RCM_RECIPIENT_PAYS';
  /** Basis points: 1800 is 18.00%. */
  gstRateBps: number;
  /** Basis points for the lender's expected deduction (section 393(1), formerly 194H). Shown, never subtracted. */
  tdsRateBps: number;
  roundingMode: string;
}

export interface CommissionPort {
  /**
   * Inside the caller's transaction. Every EARNED calculation for one lender whose event date falls in `month`
   * (YYYY-MM), ordered by event date. Reversed and superseded calculations are left out. The caller applies its own
   * permission rules; this reads nothing it was not asked for.
   */
  listEarnedForMonth(
    tx: Tx,
    ctx: RequestContext,
    query: { lenderId: string; month: string },
  ): Promise<EarnedCommissionLine[]>;

  /** Inside the caller's transaction. The active plan's invoice terms for a lender, or null when it has no active plan. */
  getInvoiceTerms(tx: Tx, ctx: RequestContext, lenderId: string): Promise<CommissionInvoiceTerms | null>;
}
