// Flow-wise demo seed: builds every table's synthetic rows for the local database. Owner: Dev 1 (platform lane).
// Two demo tenants (alpha, beta) carry the full flow with identical natural keys for the isolation suite; eight pilot
// tenants exist as tenant rows only. Nothing here touches hosted data: tools/seed-local-flow.ts refuses non-loopback hosts.
import { Tables, ix } from './types';
import { PILOT_TENANTS, buildTenantCore, buildTenantRegistry, makeTenant } from './tenant-core';
import { buildOrigination } from './origination';
import { buildFinance } from './finance';
import { buildOperations } from './operations';
import { buildGlobal, buildGovernance } from './governance';

export { PILOT_TENANTS };

export function buildFlowSeed(): Tables {
  const out = new Tables();
  buildGlobal(out);
  buildTenantRegistry(out);

  const demo = [
    makeTenant('alpha', '9', 'demo-alpha', 'Alpha Demo Finserv'),
    makeTenant('beta', '8', 'demo-beta', 'Beta Demo Loans'),
  ];
  for (const t of demo) {
    buildTenantCore(t, out);
    const staff = {
      owner: ix(t.users, 'owner'),
      loanops: ix(t.users, 'loanops'),
      branchmgr: ix(t.users, 'branchmgr'),
      compliance: ix(t.users, 'compliance'),
      rm1: ix(t.users, 'rm1'),
      rm2: ix(t.users, 'rm2'),
      sales1: ix(t.users, 'sales1'),
      teammgr: ix(t.users, 'teammgr'),
      ruleauthor: ix(t.users, 'ruleauthor'),
    };
    const origination = buildOrigination(t, out, staff);
    buildFinance(t, out, origination, staff);
    buildOperations(t, out, origination, staff);
    buildGovernance(t, out, origination, staff);
  }
  return out;
}
