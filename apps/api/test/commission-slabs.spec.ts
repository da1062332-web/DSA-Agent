// apps/api/test/commission-slabs.spec.ts — owner: Devyani — P2-01 commission volume slabs (migration 0141)
// The arithmetic here is money, so every expectation is to the paisa.
import type { RequestContext, Tx } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';
import { FinanceService } from '../src/modules/finance/finance-service';
import type { CommissionPlanRow, CommissionPlanSlabRow } from '../src/modules/finance/repository';
import { InMemoryFinanceRepository } from './finance-test-repo';
import { testPrincipal } from './support/fake-auth';

const TENANT = 'ten_01J00000000000000000000001';
const LENDER = 'lnd_01J00000000000000000000001';
const PLAN = 'cpl_01J00000000000000000000001';
const tx = {} as Tx;

const ctx = (): RequestContext => ({
  principal: testPrincipal({
    tenantId: TENANT,
    grants: [{ code: 'commission.calculate', scope: 'TENANT', branchIds: [] }],
  }),
  correlationId: 'corr-slab',
  now: new Date('2026-11-10T00:00:00.000Z'),
});

const plan = (roundingMode = 'ROUND_HALF_UP'): CommissionPlanRow => ({
  id: PLAN,
  tenant_id: TENANT,
  lender_id: LENDER,
  qualifying_event: 'DISBURSEMENT',
  basis: 'DISBURSED_AMOUNT',
  rounding_mode: roundingMode,
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

const slab = (over: Partial<CommissionPlanSlabRow> & { id: string }): CommissionPlanSlabRow => ({
  tenant_id: TENANT,
  plan_id: PLAN,
  product_category: 'PL',
  volume_from: '0',
  volume_to: null,
  rate_bps: null,
  flat_amount: null,
  effective_from: new Date('2026-01-01T00:00:00.000Z'),
  effective_to: null,
  lock_version: 0,
  created_at: new Date('2026-10-01T00:00:00.000Z'),
  created_by: 'usr_seed',
  updated_at: new Date('2026-10-01T00:00:00.000Z'),
  updated_by: 'usr_seed',
  ...over,
});

/** The grid from the spec's step 5: personal loan, 0 to 5,00,000 at 1.00%, above that at 1.25%. */
function hdfcGrid(roundingMode = 'ROUND_HALF_UP') {
  const repo = new InMemoryFinanceRepository();
  repo.plans.push(plan(roundingMode));
  repo.slabs.push(
    slab({ id: 'cslb_01J00000000000000000000001', volume_from: '0', volume_to: '500000.00', rate_bps: 100 }),
    slab({ id: 'cslb_01J00000000000000000000002', volume_from: '500000.00', volume_to: null, rate_bps: 125 }),
  );
  return { repo, service: new FinanceService({ repository: repo }) };
}

const calcInput = (over: Record<string, unknown> = {}) => ({
  lenderId: LENDER,
  trancheId: `trn_${Math.random().toString(36).slice(2, 10)}`,
  eventDate: '2026-11-10',
  currency: 'INR' as const,
  basisAmount: '400000.00',
  productCategory: 'PL' as const,
  ...over,
});

describe('P2-01 commission slabs', () => {
  it('TC-COM-SLAB-01 the spec example: 4,00,000 verified in PL earns 4,000 at the 1.00% band', async () => {
    const { service } = hdfcGrid();
    const { calculation } = await service.calculateCommission(tx, ctx(), calcInput());

    expect(calculation.grossAmount).toBe('4000.00');
    expect(calculation.rateType).toBe('PERCENTAGE');
    expect(calculation.slabId).toBe('cslb_01J00000000000000000000001');
  });

  it('TC-COM-SLAB-02 month-to-date volume accumulates, so a later tranche is priced at the higher band', async () => {
    const { service } = hdfcGrid();
    const first = await service.calculateCommission(tx, ctx(), calcInput({ basisAmount: '400000.00' }));
    expect(first.calculation.grossAmount).toBe('4000.00');

    // 4,00,000 already earned this month + 2,00,000 now = 6,00,000, which is in the 1.25% band.
    const second = await service.calculateCommission(tx, ctx(), calcInput({ basisAmount: '200000.00' }));
    expect(second.calculation.grossAmount).toBe('2500.00');
    expect(second.calculation.slabId).toBe('cslb_01J00000000000000000000002');
  });

  it('TC-COM-SLAB-03 a volume exactly on a boundary matches one band only: volume_to is exclusive', async () => {
    const { service } = hdfcGrid();
    const { calculation } = await service.calculateCommission(
      tx,
      ctx(),
      calcInput({ basisAmount: '500000.00' }),
    );
    // 5,00,000 is the upper bound of the first band and the inclusive lower bound of the second.
    expect(calculation.slabId).toBe('cslb_01J00000000000000000000002');
    expect(calculation.grossAmount).toBe('6250.00');
  });

  it('TC-COM-SLAB-04 volume is counted per product category, so another product does not shift the band', async () => {
    const { repo, service } = hdfcGrid();
    repo.slabs.push(
      slab({
        id: 'cslb_01J00000000000000000000003',
        product_category: 'HL',
        volume_from: '0',
        volume_to: null,
        rate_bps: 50,
      }),
    );
    await service.calculateCommission(tx, ctx(), calcInput({ basisAmount: '900000.00', productCategory: 'HL' }));

    // 9,00,000 of home loan must not push the personal-loan band up.
    const pl = await service.calculateCommission(tx, ctx(), calcInput({ basisAmount: '400000.00' }));
    expect(pl.calculation.grossAmount).toBe('4000.00');
    expect(pl.calculation.slabId).toBe('cslb_01J00000000000000000000001');
  });

  it('TC-COM-SLAB-05 a flat band pays its amount whatever the basis is', async () => {
    const repo = new InMemoryFinanceRepository();
    repo.plans.push(plan());
    repo.slabs.push(slab({ id: 'cslb_01J0000000000000000000000F', flat_amount: '1500.00' }));
    const service = new FinanceService({ repository: repo });

    const { calculation } = await service.calculateCommission(tx, ctx(), calcInput({ basisAmount: '750000.00' }));
    expect(calculation.grossAmount).toBe('1500.00');
    expect(calculation.rateType).toBe('FLAT');
  });

  it('TC-COM-SLAB-06 no band covering the volume raises, never a silent fallback to the old 1.5%', async () => {
    const repo = new InMemoryFinanceRepository();
    repo.plans.push(plan());
    // A grid that stops at 1,00,000 leaves a larger disbursement uncovered.
    repo.slabs.push(
      slab({ id: 'cslb_01J0000000000000000000000X', volume_from: '0', volume_to: '100000.00', rate_bps: 100 }),
    );
    const service = new FinanceService({ repository: repo });

    await expect(
      service.calculateCommission(tx, ctx(), calcInput({ basisAmount: '400000.00' })),
    ).rejects.toThrowError(/No commission slab/);
  });

  it('TC-COM-SLAB-07 customRate still wins, and records no slab', async () => {
    const { service } = hdfcGrid();
    const { calculation } = await service.calculateCommission(
      tx,
      ctx(),
      calcInput({ customRate: 0.02 }),
    );
    expect(calculation.grossAmount).toBe('8000.00');
    expect(calculation.slabId).toBeNull();
  });

  it('TC-COM-SLAB-08 without a product category and without a custom rate, the call is refused', async () => {
    const { service } = hdfcGrid();
    const input = calcInput();
    delete (input as Record<string, unknown>).productCategory;

    await expect(service.calculateCommission(tx, ctx(), input)).rejects.toThrowError(/productCategory/);
  });

  it('TC-COM-SLAB-09 bands outside their effective dates are ignored', async () => {
    const repo = new InMemoryFinanceRepository();
    repo.plans.push(plan());
    repo.slabs.push(
      slab({
        id: 'cslb_01J0000000000000000000000E',
        rate_bps: 100,
        effective_to: new Date('2026-10-31T00:00:00.000Z'),
      }),
    );
    const service = new FinanceService({ repository: repo });

    // The only band expired on 31 October; a November event has no grid.
    await expect(service.calculateCommission(tx, ctx(), calcInput())).rejects.toThrowError(/No commission slab/);
  });

  it('TC-COM-SLAB-10 the plan rounding mode decides the half-paisa case', async () => {
    // 10.50 at 100 bps is exactly 10.5 paise, the one case where the modes disagree.
    const expected: Record<string, string> = {
      ROUND_HALF_UP: '0.11',
      ROUND_UP: '0.11',
      ROUND_DOWN: '0.10',
      ROUND_HALF_EVEN: '0.10',
    };

    for (const [mode, amount] of Object.entries(expected)) {
      const repo = new InMemoryFinanceRepository();
      repo.plans.push(plan(mode));
      repo.slabs.push(slab({ id: 'cslb_01J0000000000000000000000R', rate_bps: 100 }));
      const service = new FinanceService({ repository: repo });

      const { calculation } = await service.calculateCommission(
        tx,
        ctx(),
        calcInput({ basisAmount: '10.50' }),
      );
      expect(`${mode} -> ${calculation.grossAmount}`).toBe(`${mode} -> ${amount}`);
    }
  });

  it('TC-COM-SLAB-11 the calculation records the band and the product it was earned on', async () => {
    const { repo, service } = hdfcGrid();
    await service.calculateCommission(tx, ctx(), calcInput());

    const stored = repo.calculations[0]!;
    expect(stored.slab_id).toBe('cslb_01J00000000000000000000001');
    expect(stored.product_category).toBe('PL');
    expect(stored.rate).toBe('0.010000');
  });
});
