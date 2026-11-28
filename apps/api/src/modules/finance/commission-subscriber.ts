// apps/api/src/modules/finance/commission-subscriber.ts — owner: Devyani — P2-01 automatic commission on a verified tranche.
//
// The outbox relay hands every published event to every subscriber. This one reacts to disbursement.verified, the
// qualifying event, and prices it from the lender's payout grid. The manual route stays for corrections.
import { AppError, LOAN_CATEGORIES, type DomainEventEnvelope, type RequestContext } from '@dsa/contracts';
import type { ApiDeps } from '../types';
import { FinanceService } from './finance-service';
import { SqlFinanceRepository, type FinanceRepository } from './repository';

type ProductCategory = (typeof LOAN_CATEGORIES)[number];

const text = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

const asCategory = (v: unknown): ProductCategory | null =>
  typeof v === 'string' && (LOAN_CATEGORIES as readonly string[]).includes(v) ? (v as ProductCategory) : null;

/**
 * The context the automatic calculation runs under.
 *
 * The relay builds its subscriber context with `grants: []` (see relayContext in platform/outbox-relay.ts), so calling
 * calculateCommission with it would throw FORBIDDEN, be retried five times and then dead-lettered -- silently, for every
 * disbursement. Rather than loosen the permission check or give the relay blanket grants, this mints a service identity
 * holding exactly the one permission the call needs, which is the pattern finance/connector-portal.ts already uses for
 * the portal's lead creation.
 */
export const commissionAutoContext = (ctx: RequestContext): RequestContext => ({
  ...ctx,
  principal: {
    kind: 'SERVICE',
    id: 'SYSTEM:commission-auto',
    tenantId: ctx.principal.tenantId,
    primaryBranchId: null,
    managedTeamMemberIds: [],
    queueIds: [],
    grants: [{ code: 'commission.calculate', scope: 'TENANT', branchIds: [] }],
    authTime: null,
  },
});

/** `repository` is injectable so the subscriber can be exercised against the in-memory repository without a database. */
export function createCommissionSubscriber(
  deps: ApiDeps,
  repository: FinanceRepository = new SqlFinanceRepository(),
) {
  const service = new FinanceService({
    repository,
    audit: deps.audit,
    outbox: deps.outboxPort,
  });

  return async (ctx: RequestContext, event: DomainEventEnvelope): Promise<void> => {
    if (event.type !== 'disbursement.verified') return;

    const data = event.data as Record<string, unknown>;
    const trancheId = text(data.trancheId);
    if (!trancheId) return;

    const lenderId = text(data.lenderId);
    const basisAmount = text(data.basisAmount);
    const productCategory = asCategory(data.productCategory);
    const verifiedAt = text(data.verifiedAt);

    const autoCtx = commissionAutoContext(ctx);

    await deps.txRunner.withTenantTx(autoCtx, async (tx) => {
      // Idempotency (spec step 8: "double event creates one calculation"). calculateCommission throws INVALID_STATE on a
      // duplicate tranche, which is right for a person clicking twice but wrong here: an error dead-letters an event that
      // was in fact handled. Checking first makes a redelivery a no-op that reports success.
      const existing = await repository.findEarnedCalculationByTranche(tx, autoCtx.principal.tenantId, trancheId);
      if (existing) return;

      if (!lenderId || !basisAmount || !productCategory) {
        // Deliberately an error, not a quiet skip. The relay records it on the outbox row and parks the event after five
        // attempts, so an unpriceable disbursement is visible. Silently dropping it would lose revenue invisibly.
        const missing = [
          !lenderId ? 'lenderId' : null,
          !basisAmount ? 'basisAmount' : null,
          !productCategory ? 'productCategory' : null,
        ]
          .filter(Boolean)
          .join(', ');
        throw AppError.of(
          'INVALID_STATE',
          `Cannot price tranche ${trancheId} automatically: the verified event is missing ${missing}. Calculate it by hand with a custom rate.`,
        );
      }

      await service.calculateCommission(tx, autoCtx, {
        lenderId,
        trancheId,
        basisAmount,
        productCategory,
        applicationId: text(data.applicationId),
        lenderCaseId: text(data.lenderCaseId),
        currency: text(data.currency) ?? 'INR',
        ...(verifiedAt ? { eventDate: verifiedAt.slice(0, 10) } : {}),
        // No connectorId: the event does not say which partner sourced the case, so this creates the calculation but no
        // payable. Partner attribution and the split are P2-03; until then a partner payout is raised from the manual
        // route, which still accepts connectorId.
      });
    });
  };
}
