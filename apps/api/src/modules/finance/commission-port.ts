// CommissionPort, real implementation (owner: Devyani; P2-01, Contracts §4). The invoices module bills a lender for a
// month's commission and reconciliation matches a lender's statement against it; both live outside finance, so this is
// how they read commission_calculation without touching it.
import type {
  CommissionInvoiceTerms,
  CommissionPort,
  EarnedCommissionLine,
  ProductCategory,
  RequestContext,
  Tx,
} from '@dsa/contracts';
import type { CommissionCalculationRow, FinanceRepository } from './repository';
import { SqlFinanceRepository } from './repository';

/** The calendar month named by `YYYY-MM`, in UTC, as [start, endExclusive). event_date is a DATE column. */
function monthBounds(month: string): { start: Date; endExclusive: Date } {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return {
    start: new Date(Date.UTC(year, m - 1, 1)),
    endExclusive: new Date(Date.UTC(year, m, 1)),
  };
}

const toLine = (row: CommissionCalculationRow): EarnedCommissionLine => ({
  calculationId: row.id,
  lenderId: row.lender_id,
  trancheId: row.tranche_id,
  applicationId: row.application_id,
  productCategory: (row.product_category as ProductCategory | null) ?? null,
  eventDate: row.event_date.toISOString().slice(0, 10),
  basisAmount: String(row.basis_amount),
  rate: String(row.rate),
  rateType: row.rate_type,
  grossAmount: String(row.gross_amount),
  currency: row.currency,
  slabId: row.slab_id,
});

export function createCommissionPort(
  repository: FinanceRepository = new SqlFinanceRepository(),
): CommissionPort {
  return {
    async listEarnedForMonth(
      tx: Tx,
      ctx: RequestContext,
      query: { lenderId: string; month: string },
    ): Promise<EarnedCommissionLine[]> {
      const { start, endExclusive } = monthBounds(query.month);
      const rows = await repository.listEarnedCalculationsForMonth(
        tx,
        ctx.principal.tenantId,
        query.lenderId,
        start,
        endExclusive,
      );
      return rows.map(toLine);
    },

    async getInvoiceTerms(
      tx: Tx,
      ctx: RequestContext,
      lenderId: string,
    ): Promise<CommissionInvoiceTerms | null> {
      const plan = await repository.findActiveCommissionPlan(tx, ctx.principal.tenantId, lenderId);
      if (!plan) return null;
      return {
        taxTreatment: plan.tax_treatment as CommissionInvoiceTerms['taxTreatment'],
        gstRateBps: plan.gst_rate_bps,
        tdsRateBps: plan.tds_rate_bps,
        roundingMode: plan.rounding_mode,
      };
    },
  };
}
