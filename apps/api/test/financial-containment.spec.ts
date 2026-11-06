// Regression tests for the 2026-11-04 containment of sensitive financial operations (docs/PRODUCTION_SECURITY_CONTAINMENT.md).
//
// Three things are proven for every gated route:
//   1. With the project second factor off (SUPABASE_MFA_ENABLED=false), the route is refused with 403 FORBIDDEN and the containment issue,
//      even when the caller has no step-up at all. The kernel's own step-up check is a no-op in that state, so this is what closes it.
//   2. With the second factor on, a caller without a recent step-up is refused with 401 STEP_UP_REQUIRED.
//   3. With the second factor on and a recent step-up, the gate lets the call through.
// The refusals are decided before any handler or service runs, so the response itself shows that no financial work happened.
import type { PermissionCode, RequestContext, Tx, TxRunner } from '@dsa/contracts';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_SECOND_FACTOR_OFF, requireFinancialStepUp } from '../src/http/financial-step-up';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const stubTx: TxRunner = {
  async withTenantTx<T>(_ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return fn({} as Tx);
  },
};

const IF_MATCH = { 'If-Match': '"1"' };
const ID = {
  commissionPlan: 'cpl_01JTESTCOMMISSIONPLAN000',
  clawback: 'adj_01JTESTCLAWBACK000000000',
  recalc: 'rcp_01JTESTRECALCPROPOSAL00000',
  payout: 'prq_01JTESTPAYOUTREQUEST0000000',
  batch: 'pbt_01JTESTPAYOUTBATCH00000000',
  adjustment: 'adj_01JTESTADJUSTMENT0000000',
  exception: 'rex_01JTESTEXCEPTION000000000',
  dispute: 'dsp_01JTESTRECONDISPUTE0000000',
  connector: 'con_01JTESTCONNECTOR00000000',
  bankAccount: 'cba_01JTESTBANKACCOUNT0000000',
  attribution: 'acr_01JTESTATTRIBUTION000000',
  attributionDispute: 'atd_01JTESTATTRDISPUTE00000',
};

interface GatedRoute {
  name: string;
  method: 'get' | 'post' | 'patch';
  path: string;
  /** The permission the route checks. A caller holding only this code gets past the permission check. */
  grants: PermissionCode[];
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}

/** Every route that the containment gates, as shipped on 2026-11-04. */
const GATED: GatedRoute[] = [
  // Commission and clawback approvals
  {
    name: 'commission plan approval',
    method: 'post',
    path: `/v1/commission-plans/${ID.commissionPlan}/approval`,
    grants: ['commission.plan.approve'],
    headers: IF_MATCH,
  },
  {
    name: 'clawback approval',
    method: 'post',
    path: `/v1/clawbacks/${ID.clawback}/approval`,
    grants: ['adjustment.approve'],
  },
  {
    name: 'clawback rejection',
    method: 'post',
    path: `/v1/clawbacks/${ID.clawback}/rejection`,
    grants: ['adjustment.approve'],
  },
  {
    name: 'recalculation proposal approval',
    method: 'post',
    path: `/v1/recalculation-proposals/${ID.recalc}/approval`,
    grants: ['adjustment.approve'],
  },
  // Payout lifecycle
  {
    name: 'payout approval',
    method: 'post',
    path: `/v1/payout-requests/${ID.payout}/approval`,
    grants: ['payout.approve'],
  },
  {
    name: 'payout payment record',
    method: 'post',
    path: `/v1/payout-requests/${ID.payout}/payment`,
    grants: ['payout.record_payment'],
  },
  {
    name: 'payout payment failure',
    method: 'post',
    path: `/v1/payout-requests/${ID.payout}/payment-failure`,
    grants: ['payout.record_payment'],
  },
  { name: 'payout batch creation', method: 'post', path: '/v1/payout-batches', grants: ['payout.disburse'] },
  {
    name: 'payout batch bank file',
    method: 'get',
    path: `/v1/payout-batches/${ID.batch}/bank-file`,
    grants: ['payout.disburse'],
  },
  {
    name: 'payout gateway disbursement',
    method: 'post',
    path: `/v1/payout-requests/${ID.payout}/disburse-gateway`,
    grants: ['payout.disburse'],
  },
  {
    name: 'payout batch gateway dispatch',
    method: 'post',
    path: `/v1/payout-batches/${ID.batch}/dispatch-gateway`,
    grants: ['payout.disburse'],
  },
  // Reconciliation: adjustment approval, bank settlement, write-off, and dispute releases
  {
    name: 'adjustment approval',
    method: 'post',
    path: `/v1/adjustments/${ID.adjustment}/approval`,
    grants: ['adjustment.approve'],
  },
  {
    name: 'payout bank reconciliation',
    method: 'post',
    path: `/v1/reconciliation/payouts/${ID.payout}/bank-reconcile`,
    grants: ['finance.reconcile'],
  },
  {
    name: 'exception write-off',
    method: 'post',
    path: `/v1/reconciliation-exceptions/${ID.exception}/resolution`,
    grants: ['finance.reconcile'],
    body: { status: 'WRITTEN_OFF' },
  },
  {
    name: 'dispute that releases held payables',
    method: 'patch',
    path: `/v1/disputes/${ID.dispute}`,
    grants: ['finance.reconcile'],
    headers: IF_MATCH,
    body: { status: 'RESOLVED', releaseHolds: true },
  },
  // Connector approvals that decide a payee or a commission owner
  {
    name: 'connector bank account approval',
    method: 'post',
    path: `/v1/connectors/${ID.connector}/bank-accounts/${ID.bankAccount}/approval`,
    grants: ['connector.bank_change_approve'],
  },
  {
    name: 'attribution change approval',
    method: 'post',
    path: `/v1/attribution-change-requests/${ID.attribution}/approval`,
    grants: ['connector.attribution_change'],
    headers: IF_MATCH,
  },
  {
    name: 'attribution dispute resolution',
    method: 'post',
    path: `/v1/attribution-disputes/${ID.attributionDispute}/resolution`,
    grants: ['connector.dispute_resolve'],
    headers: IF_MATCH,
  },
  // Partner portal payout request (the partner's own payout)
  { name: 'partner payout request', method: 'post', path: '/portal/v1/payout-requests', grants: [] },
];

/** Routes outside the gate. Containment must not touch them: a refusal here is a regression. */
const NOT_GATED: GatedRoute[] = [
  {
    name: 'payout request creation (maker step)',
    method: 'post',
    path: '/v1/payout-requests',
    grants: ['payout.request'],
  },
  {
    name: 'payout request cancellation',
    method: 'post',
    path: `/v1/payout-requests/${ID.payout}/cancel`,
    grants: ['payout.request'],
  },
  { name: 'payout request list', method: 'get', path: '/v1/payout-requests', grants: ['payout.view'] },
  { name: 'clawback creation', method: 'post', path: '/v1/clawbacks', grants: ['adjustment.create'] },
  { name: 'adjustment proposal', method: 'post', path: '/v1/adjustments', grants: ['adjustment.create'] },
  {
    name: 'exception resolution that is not a write-off',
    method: 'post',
    path: `/v1/reconciliation-exceptions/${ID.exception}/resolution`,
    grants: ['finance.reconcile'],
    body: { status: 'RESOLVED' },
  },
  {
    name: 'dispute update that does not release payables',
    method: 'patch',
    path: `/v1/disputes/${ID.dispute}`,
    grants: ['finance.reconcile'],
    headers: IF_MATCH,
    body: { status: 'RESOLVED' },
  },
  {
    name: 'connector activation',
    method: 'post',
    path: `/v1/connectors/${ID.connector}/activation`,
    grants: ['connector.manage'],
  },
];

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

const grantsOf = (codes: PermissionCode[]) =>
  codes.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] }));

/** A caller holding the route's permission, with or without a recent second factor. */
function appFor(codes: PermissionCode[], authTime: string | null) {
  return createTestApp({
    auth: fakeAuth(testPrincipal({ grants: grantsOf(codes), authTime })),
    deps: { txRunner: stubTx },
  });
}

function call(route: GatedRoute, codes: PermissionCode[], authTime: string | null) {
  const req = request(appFor(codes, authTime))[route.method](route.path);
  return req.set(route.headers ?? {}).send(route.body ?? {});
}

interface ErrorBody {
  error?: { code?: string; details?: { issue?: string }[] };
}

const issuesOf = (body: unknown): string[] =>
  ((body as ErrorBody | undefined)?.error?.details ?? []).map((d) => d.issue ?? '');

describe('the containment gate', () => {
  it('TEST-FSU-01 with the project second factor off, the gate refuses and never asks for a step-up', () => {
    process.env.SUPABASE_MFA_ENABLED = 'false';
    const authz = { requireStepUp: vi.fn() };
    const ctx = {
      principal: testPrincipal(),
      correlationId: 'c',
      now: new Date(),
    } as unknown as RequestContext;

    let caught: unknown;
    try {
      requireFinancialStepUp(authz, ctx);
    } catch (err) {
      caught = err;
    }
    const thrown = caught as { code?: string; details?: { issue?: string }[] } | undefined;
    expect(thrown?.code).toBe('FORBIDDEN');
    expect(thrown?.details?.[0]?.issue).toBe(PROJECT_SECOND_FACTOR_OFF);
    expect(authz.requireStepUp).not.toHaveBeenCalled();
  });

  it('TEST-FSU-02 with the setting unset or true, the gate falls through to the normal step-up check', () => {
    const ctx = {
      principal: testPrincipal(),
      correlationId: 'c',
      now: new Date(),
    } as unknown as RequestContext;

    delete process.env.SUPABASE_MFA_ENABLED;
    const unset = { requireStepUp: vi.fn() };
    requireFinancialStepUp(unset, ctx);
    expect(unset.requireStepUp).toHaveBeenCalledTimes(1);

    process.env.SUPABASE_MFA_ENABLED = 'true';
    const on = { requireStepUp: vi.fn() };
    requireFinancialStepUp(on, ctx);
    expect(on.requireStepUp).toHaveBeenCalledTimes(1);
  });

  it('TEST-FSU-03 the developer switch DISABLE_MFA does not lift the containment', () => {
    process.env.SUPABASE_MFA_ENABLED = 'false';
    process.env.DISABLE_MFA = 'true';
    const authz = { requireStepUp: vi.fn() };
    const ctx = {
      principal: testPrincipal(),
      correlationId: 'c',
      now: new Date(),
    } as unknown as RequestContext;

    expect(() => requireFinancialStepUp(authz, ctx)).toThrow();
    expect(authz.requireStepUp).not.toHaveBeenCalled();
  });
});

describe('gated routes while the project second factor is OFF', () => {
  for (const route of GATED) {
    it(`TEST-FSU-10 ${route.name} is refused with 403 FORBIDDEN and the containment issue, with no step-up at all`, async () => {
      process.env.SUPABASE_MFA_ENABLED = 'false';
      const res = await call(route, route.grants, null);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(issuesOf(res.body)).toContain(PROJECT_SECOND_FACTOR_OFF);
    });
  }
});

describe('gated routes while the project second factor is ON', () => {
  for (const route of GATED) {
    it(`TEST-FSU-20 ${route.name} without a recent step-up is refused with 401 STEP_UP_REQUIRED`, async () => {
      delete process.env.SUPABASE_MFA_ENABLED;
      const res = await call(route, route.grants, null);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('STEP_UP_REQUIRED');
    });

    it(`TEST-FSU-21 ${route.name} with a recent step-up gets past the gate`, async () => {
      delete process.env.SUPABASE_MFA_ENABLED;
      const res = await call(route, route.grants, new Date().toISOString());

      expect(res.body.error?.code).not.toBe('STEP_UP_REQUIRED');
      expect(issuesOf(res.body)).not.toContain(PROJECT_SECOND_FACTOR_OFF);
    });
  }
});

describe('routes outside the gate are not refused by containment', () => {
  for (const route of NOT_GATED) {
    it(`TEST-FSU-30 ${route.name} is not refused by the containment`, async () => {
      process.env.SUPABASE_MFA_ENABLED = 'false';
      const res = await call(route, route.grants, null);

      expect(issuesOf(res.body)).not.toContain(PROJECT_SECOND_FACTOR_OFF);
      expect(res.body.error?.code).not.toBe('STEP_UP_REQUIRED');
    });
  }
});
