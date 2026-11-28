// apps/api/test/commission-slab-api.spec.ts — owner: Devyani — P2-01 editing a lender's payout grid.
import type { RequestContext, Tx } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';
import { FinanceService } from '../src/modules/finance/finance-service';
import type { CommissionPlanRow } from '../src/modules/finance/repository';
import { InMemoryFinanceRepository } from './finance-test-repo';
import { testPrincipal } from './support/fake-auth';

const TENANT = 'ten_01J00000000000000000000001';
const PLAN = 'cpl_01J00000000000000000000001';
const tx = {} as Tx;

const ctxWith = (...codes: string[]): RequestContext => ({
  principal: testPrincipal({
    tenantId: TENANT,
    grants: codes.map((code) => ({ code: code as never, scope: 'TENANT' as const, branchIds: [] })),
  }),
  correlationId: 'corr-slab-api',
  now: new Date('2026-11-10T00:00:00.000Z'),
});

const editor = () => ctxWith('commission.plan.edit');
const viewer = () => ctxWith('commission.view');

const plan = (status = 'DRAFT'): CommissionPlanRow => ({
  id: PLAN,
  tenant_id: TENANT,
  lender_id: 'lnd_01J00000000000000000000001',
  qualifying_event: 'DISBURSEMENT',
  basis: 'DISBURSED_AMOUNT',
  rounding_mode: 'ROUND_HALF_UP',
  clawback_window_days: 90,
  rule_set_id: null,
  tax_treatment: 'FORWARD_CHARGE',
  gst_rate_bps: 1800,
  tds_rate_bps: 200,
  status,
  lock_version: 0,
  created_at: new Date('2026-10-01T00:00:00.000Z'),
  created_by: 'usr_seed',
  updated_at: new Date('2026-10-01T00:00:00.000Z'),
  updated_by: 'usr_seed',
});

function harness(planStatus = 'DRAFT') {
  const repo = new InMemoryFinanceRepository();
  repo.plans.push(plan(planStatus));
  return { repo, service: new FinanceService({ repository: repo }) };
}

const band = (over: Record<string, unknown> = {}) => ({
  productCategory: 'PL' as const,
  volumeFrom: '0',
  volumeTo: '500000.00',
  rateBps: 100,
  effectiveFrom: '2026-01-01',
  ...over,
});

describe('P2-01 commission plan slabs (API)', () => {
  it('TC-COM-SLAB-API-01 editing the grid needs commission.plan.edit', async () => {
    const { service } = harness();
    await expect(
      service.createCommissionPlanSlab(tx, viewer(), PLAN, band()),
    ).rejects.toThrowError(/commission\.plan\.edit/);
  });

  it('TC-COM-SLAB-API-02 a band can be added to a DRAFT plan and read back', async () => {
    const { service } = harness();
    const created = await service.createCommissionPlanSlab(tx, editor(), PLAN, band());

    expect(created.rateBps).toBe(100);
    expect(created.volumeTo).toBe('500000.00');

    const listed = await service.listCommissionPlanSlabs(tx, viewer(), PLAN);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(created.id);
  });

  it('TC-COM-SLAB-API-03 the grid is frozen once the plan leaves DRAFT', async () => {
    // An ACTIVE plan's rates are what past calculations were priced on; changing them would make an invoice
    // disagree with the calculation behind it.
    const { service } = harness('ACTIVE');
    await expect(service.createCommissionPlanSlab(tx, editor(), PLAN, band())).rejects.toThrowError(/DRAFT/i);
  });

  it('TC-COM-SLAB-API-04 adjacent bands are fine, because volumeTo is exclusive', async () => {
    const { service } = harness();
    await service.createCommissionPlanSlab(tx, editor(), PLAN, band({ volumeFrom: '0', volumeTo: '500000.00' }));
    const upper = await service.createCommissionPlanSlab(
      tx,
      editor(),
      PLAN,
      band({ volumeFrom: '500000.00', volumeTo: null, rateBps: 125 }),
    );
    expect(upper.volumeFrom).toBe('500000.00');
  });

  it('TC-COM-SLAB-API-05 overlapping bands are refused', async () => {
    const { service } = harness();
    await service.createCommissionPlanSlab(tx, editor(), PLAN, band({ volumeFrom: '0', volumeTo: '500000.00' }));

    await expect(
      service.createCommissionPlanSlab(tx, editor(), PLAN, band({ volumeFrom: '400000.00', volumeTo: '900000.00' })),
    ).rejects.toThrowError(/overlaps/i);
  });

  it('TC-COM-SLAB-API-06 a band of another product category never clashes', async () => {
    const { service } = harness();
    await service.createCommissionPlanSlab(tx, editor(), PLAN, band());
    const hl = await service.createCommissionPlanSlab(tx, editor(), PLAN, band({ productCategory: 'HL' }));
    expect(hl.productCategory).toBe('HL');
  });

  it('TC-COM-SLAB-API-07 a band needs exactly one of a rate or a flat amount', async () => {
    const { service } = harness();
    await expect(
      service.createCommissionPlanSlab(tx, editor(), PLAN, band({ rateBps: 100, flatAmount: '500.00' })),
    ).rejects.toThrow();
    await expect(
      service.createCommissionPlanSlab(tx, editor(), PLAN, band({ rateBps: null, flatAmount: null })),
    ).rejects.toThrow();
  });

  it('TC-COM-SLAB-API-08 updating takes the current version and refuses a stale one', async () => {
    const { service } = harness();
    const created = await service.createCommissionPlanSlab(tx, editor(), PLAN, band());

    const updated = await service.updateCommissionPlanSlab(tx, editor(), PLAN, created.id, created.lockVersion, {
      rateBps: 125,
    });
    expect(updated.rateBps).toBe(125);
    expect(updated.lockVersion).toBe(created.lockVersion + 1);

    await expect(
      service.updateCommissionPlanSlab(tx, editor(), PLAN, created.id, created.lockVersion, { rateBps: 150 }),
    ).rejects.toThrowError(/version conflict/i);
  });

  it('TC-COM-SLAB-API-09 the preview shows the band a volume would land in, and what it pays', async () => {
    const { service } = harness();
    await service.createCommissionPlanSlab(tx, editor(), PLAN, band({ volumeFrom: '0', volumeTo: '500000.00' }));
    await service.createCommissionPlanSlab(
      tx,
      editor(),
      PLAN,
      band({ volumeFrom: '500000.00', volumeTo: null, rateBps: 125 }),
    );

    const preview = await service.previewCommissionSlab(tx, viewer(), PLAN, {
      productCategory: 'PL',
      monthlyVolume: '1000000.00',
      basisAmount: '1000000.00',
      asOf: '2026-11-10',
    });

    expect(preview.matched).toBe(true);
    expect(preview.rateBps).toBe(125);
    expect(preview.grossAmount).toBe('12500.00');
  });

  it('TC-COM-SLAB-API-10 a volume no band covers previews as unmatched, not as zero', async () => {
    const { service } = harness();
    await service.createCommissionPlanSlab(tx, editor(), PLAN, band({ volumeFrom: '0', volumeTo: '100000.00' }));

    const preview = await service.previewCommissionSlab(tx, viewer(), PLAN, {
      productCategory: 'PL',
      monthlyVolume: '900000.00',
      basisAmount: '900000.00',
      asOf: '2026-11-10',
    });

    expect(preview.matched).toBe(false);
    expect(preview.grossAmount).toBeNull();
  });
});
