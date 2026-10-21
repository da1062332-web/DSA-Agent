// Tenant entitlements gate (owner: Dev 1; MOD-TEN SUB-TEN.03, M-082). A /v1 request for a module the tenant is not entitled
// to answers 403 MODULE_NOT_ENABLED. Only an explicit false disables a module, so a tenant with no entitlements set keeps
// everything (the pilot default). The core Workflow A modules (leads, customers, tasks, applications, documents, lender
// cases, rules, users, configuration) are never gated. Entitlements are read once per tenant per 30 seconds.
import { AppError, type TxRunner } from '@dsa/contracts';
import type { RequestHandler } from 'express';
import { sql } from 'kysely';

const PREFIXES: [RegExp, string][] = [
  [/^\/(automations|automation-versions|automation-executions)(\/|$)/, 'MOD-WFA'],
  [
    /^\/(commission|commission-plans|commission-calculations|clawbacks|recalculation-proposals)(\/|-|$)/,
    'MOD-COM',
  ],
  [/^\/(payout-requests|payout-batches|payouts)(\/|$)/, 'MOD-PAY'],
  [/^\/(reconciliation|reconciliation-exceptions|lender-statements|disputes|adjustments)(\/|$)/, 'MOD-REC'],
  [/^\/(invoices)(\/|$)/, 'MOD-INV'],
  [/^\/(ledger|accounts|periods)(\/|$)/, 'MOD-LED'],
  [/^\/(reports|report-runs|report-schedules|metric-definitions|dashboards|exports)(\/|$)/, 'MOD-RPT'],
  [/^\/(imports)(\/|$)/, 'MOD-IMP'],
  [/^\/(connectors|attribution-change-requests|attribution-disputes)(\/|$)/, 'MOD-CON'],
  [/^\/(portal)(\/|$)/, 'MOD-CPT'],
  [/^\/(targets|leaderboards)(\/|$)/, 'MOD-PERF'],
  [/^\/(verifications|verification-requests)(\/|$)/, 'MOD-VER'],
  [/^\/(shares|upload-links)(\/|$)/, 'MOD-DSH'],
  [/^\/(api-clients|webhook-subscriptions|webhook-deliveries)(\/|$)/, 'MOD-API'],
];

const TTL_MS = 30_000;

export function moduleOf(path: string): string | null {
  return PREFIXES.find(([re]) => re.test(path))?.[1] ?? null;
}

export function moduleGate(txRunner: TxRunner, now: () => number = Date.now): RequestHandler {
  const cache = new Map<string, { at: number; modules: Record<string, boolean> }>();
  return (req, _res, next) => {
    const module = moduleOf(req.path);
    const ctx = req.ctx;
    if (!module || !ctx || ctx.principal.kind !== 'USER') return next();
    const tenantId = ctx.principal.tenantId;
    const hit = cache.get(tenantId);
    const check = (modules: Record<string, boolean>) =>
      modules[module] === false
        ? next(
            AppError.of('MODULE_NOT_ENABLED', `${module} is not enabled for this tenant.`, [
              { issue: 'MODULE_NOT_ENABLED', meta: { module } },
            ]),
          )
        : next();
    if (hit && now() - hit.at < TTL_MS) return check(hit.modules);
    txRunner
      .withTenantTx(ctx, async (tx) => {
        const r = await sql<{ entitlements: Record<string, boolean> }>`
          select entitlements from tenant where id = ${tenantId}`.execute(tx);
        return r.rows[0]?.entitlements ?? {};
      })
      .then((modules) => {
        if (cache.size > 10_000) cache.clear();
        cache.set(tenantId, { at: now(), modules });
        return modules;
      })
      // A commercial gate, not an isolation control: if the lookup fails the request goes on, and the module's own data
      // access meets the same database (and RLS) next. Nothing is cached, so the next request asks again.
      .catch(() => ({}))
      .then(check);
  };
}
