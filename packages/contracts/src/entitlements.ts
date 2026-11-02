// packages/contracts/src/entitlements.ts — owner: Dev 1 — additive (migration M-098 change set)
// The modules a tenant can be entitled to or not (MOD-TEN SUB-TEN.03). The API gate (apps/api/src/http/module-gate.ts) answers 403
// MODULE_NOT_ENABLED for a request to a module whose entitlement is an explicit false, and GET /v1/me returns those modules as
// `disabledModules`, so the web hides what the API would refuse. The route-to-module map stays in the API (it is keyed by API paths).

export const GATED_MODULES = [
  'MOD-WFA',
  'MOD-COM',
  'MOD-PAY',
  'MOD-REC',
  'MOD-INV',
  'MOD-RPT',
  'MOD-IMP',
  'MOD-CON',
  'MOD-CPT',
  'MOD-PERF',
  'MOD-VER',
  'MOD-DSH',
  'MOD-API',
] as const;

export type GatedModule = (typeof GATED_MODULES)[number];

/**
 * The gated modules a tenant's entitlements switch off. Only an explicit false disables a module, so a tenant with no entitlements set
 * keeps everything (the pilot default). The module gate and GET /v1/me both use this rule, so the web hides what the API would refuse.
 */
export function disabledModulesOf(entitlements: unknown): GatedModule[] {
  if (!entitlements || typeof entitlements !== 'object') return [];
  const e = entitlements as Record<string, unknown>;
  return GATED_MODULES.filter((m) => e[m] === false);
}
