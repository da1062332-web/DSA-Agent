// apps/api/test/commission-subscriber.spec.ts — owner: Devyani — P2-01 automatic commission on a verified tranche.
//
// These tests build their context with the real relayContext from the outbox relay rather than a convenient fake. The
// failure this guards against is invisible: the relay's principal holds no grants, so a subscriber that calls a
// permission-gated method is refused, retried five times and parked, with every disbursement silently unpriced.
import type { DomainEventEnvelope, RequestContext, Tx, TxRunner } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';
import { commissionAutoContext, createCommissionSubscriber } from '../src/modules/finance/commission-subscriber';
import type { CommissionPlanRow, CommissionPlanSlabRow } from '../src/modules/finance/repository';
import { relayContext } from '../src/modules/platform/outbox-relay';
import type { ApiDeps } from '../src/modules/types';
import { InMemoryFinanceRepository } from './finance-test-repo';

const TENANT = 'ten_01J00000000000000000000001';
const LENDER = 'lnd_01J00000000000000000000001';
const PLAN = 'cpl_01J00000000000000000000001';
const TRANCHE = 'trn_01J00000000000000000000001';
const SLAB = 'cslb_01J00000000000000000000001';

const fakeTxRunner: TxRunner = { withTenantTx: async (_ctx, fn) => fn({} as Tx) };

const plan = (): CommissionPlanRow => ({
  id: PLAN,
  tenant_id: TENANT,
  lender_id: LENDER,
  qualifying_event: 'DISBURSEMENT',
  basis: 'DISBURSED_AMOUNT',
  rounding_mode: 'ROUND_HALF_UP',
  clawback_window_days: 90,
  rule_set_id: null,
  tax_treatment: 'FORWARD_CHARGE',
  gst_rate_bps: 1800,
  tds_rate_bps: 200,
  status: 'ACTIVE',
  lock_version: 0,
  created_at: new Date('2026-10-01T00:00:00.000Z'),
  created_by: 'usr_seed',
  updated_at: new Date('2026-10-01T00:00:00.000Z'),
  updated_by: 'usr_seed',
});

const slab = (): CommissionPlanSlabRow => ({
  id: SLAB,
  tenant_id: TENANT,
  plan_id: PLAN,
  product_category: 'PL',
  volume_from: '0',
  volume_to: '500000.00',
  rate_bps: 100,
  flat_amount: null,
  effective_from: new Date('2026-01-01T00:00:00.000Z'),
  effective_to: null,
  lock_version: 0,
  created_at: new Date('2026-10-01T00:00:00.000Z'),
  created_by: 'usr_seed',
  updated_at: new Date('2026-10-01T00:00:00.000Z'),
  updated_by: 'usr_seed',
});

function harness() {
  const repo = new InMemoryFinanceRepository();
  repo.plans.push(plan());
  repo.slabs.push(slab());
  const deps = { txRunner: fakeTxRunner, audit: undefined, outboxPort: undefined } as unknown as ApiDeps;
  return { repo, subscriber: createCommissionSubscriber(deps, repo) };
}

const verifiedEvent = (over: Record<string, unknown> = {}): DomainEventEnvelope =>
  ({
    id: 'evt_01J00000000000000000000001',
    type: 'disbursement.verified',
    version: 1,
    tenantId: TENANT,
    occurredAt: '2026-11-10T00:00:00.000Z',
    correlationId: 'corr-1',
    causationId: null,
    chainDepth: 0,
    subject: { type: 'disbursement_tranche', id: TRANCHE },
    data: {
      trancheId: TRANCHE,
      sanctionId: 'snc_01J00000000000000000000001',
      trancheNo: 1,
      amount: 400000,
      basisAmount: '400000.00',
      currency: 'INR',
      verifiedBy: 'usr_checker',
      verifiedAt: '2026-11-10T09:00:00.000Z',
      lenderId: LENDER,
      lenderCaseId: 'lct_01J00000000000000000000001',
      applicationId: 'app_01J00000000000000000000001',
      productCategory: 'PL',
      ...over,
    },
  }) as DomainEventEnvelope;

/** Exactly what the relay passes its subscribers. */
const realRelayCtx = (): RequestContext => relayContext(TENANT, 'corr-1', new Date('2026-11-10T09:00:00.000Z'));

describe('P2-01 automatic commission on a verified disbursement', () => {
  it('TC-COM-AUTO-01 the relay hands subscribers a principal with no grants at all', () => {
    // The premise of this whole file. If someone later gives relayContext real grants, this test fails and points them
    // at the synthetic identity below, which would then be redundant rather than load-bearing.
    const ctx = realRelayCtx();
    expect(ctx.principal.kind).toBe('SERVICE');
    expect(ctx.principal.grants).toEqual([]);
  });

  it('TC-COM-AUTO-02 a verified tranche is priced from the slab without anyone calling calculate', async () => {
    const { repo, subscriber } = harness();

    await subscriber(realRelayCtx(), verifiedEvent());

    expect(repo.calculations).toHaveLength(1);
    const calc = repo.calculations[0]!;
    expect(calc.gross_amount).toBe('4000.00');
    expect(calc.slab_id).toBe(SLAB);
    expect(calc.tranche_id).toBe(TRANCHE);
    expect(calc.product_category).toBe('PL');
  });

  it('TC-COM-AUTO-03 it runs as a service identity holding only commission.calculate', () => {
    const grants = commissionAutoContext(realRelayCtx()).principal.grants;
    expect(grants).toEqual([{ code: 'commission.calculate', scope: 'TENANT', branchIds: [] }]);
    // SOD-02 and SOD-04: the automatic path must never carry an approval code.
    for (const code of ['commission.plan.approve', 'payout.approve', 'payout.disburse', 'payout.record_payment']) {
      expect(grants.map((g) => g.code)).not.toContain(code);
    }
  });

  it('TC-COM-AUTO-04 a redelivered event creates one calculation and does not throw', async () => {
    const { repo, subscriber } = harness();
    const event = verifiedEvent();

    await subscriber(realRelayCtx(), event);
    // The relay retries an event whose subscriber threw. A duplicate must be a quiet no-op, or a correctly handled
    // disbursement would be parked as dead-lettered.
    await expect(subscriber(realRelayCtx(), event)).resolves.toBeUndefined();

    expect(repo.calculations).toHaveLength(1);
  });

  it('TC-COM-AUTO-05 events of other types are ignored', async () => {
    const { repo, subscriber } = harness();

    await subscriber(realRelayCtx(), { ...verifiedEvent(), type: 'lead.created' } as DomainEventEnvelope);

    expect(repo.calculations).toHaveLength(0);
  });

  it('TC-COM-AUTO-06 an unpriceable tranche raises, so the event is parked and visible', async () => {
    const { repo, subscriber } = harness();

    await expect(
      subscriber(realRelayCtx(), verifiedEvent({ productCategory: null })),
    ).rejects.toThrowError(/productCategory/);

    expect(repo.calculations).toHaveLength(0);
  });

  it('TC-COM-AUTO-07 the calculation is dated by the verification, not by the clock', async () => {
    const { repo, subscriber } = harness();

    await subscriber(realRelayCtx(), verifiedEvent({ verifiedAt: '2026-10-31T18:30:00.000Z' }));

    expect(repo.calculations[0]!.event_date.toISOString().slice(0, 10)).toBe('2026-10-31');
  });
});
