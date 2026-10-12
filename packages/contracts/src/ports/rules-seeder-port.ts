// packages/contracts/src/ports/rules-seeder-port.ts — owner: Dev 2 — frozen at Gate 1 (Contracts §4.2)
// Consumer: Dev 1 (provisioning CLI). Default selection is a no-op (PORT_RULES_SEEDER=noop).
import type { RequestContext, Tx } from '../kernel';

export interface RulesSeederPort {
  /** Installs DEMO platform-approved ACTIVE versions for the 6 MVP decision keys (FR-BRE-033). Idempotent per tenant. */
  seedTenant(
    tx: Tx,
    ctx: RequestContext,
    input: { branches: { branchId: string; salesQueueId: string }[] },
  ): Promise<{ ruleSetVersionIds: string[] }>;
}
