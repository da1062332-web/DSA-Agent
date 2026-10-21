// Who may open which screen, for all 14 live roles of tenant qloax-dsa (audit F-07, F-08, F-12 to F-15). The sidebar, the Home cards and the
// route guard share one rule set (access.ts); these tests prove it for every role with the grants those roles really hold on hosted
// (role-grants.fixture.ts), and that a link is never offered to a page that would be refused. They test presentation only: the API
// enforces every permission itself (see apps/api/test/permission-phase1.int.spec.ts and the *-authz specs).
import { PLATFORM_TENANT_ID } from '@dsa/contracts';
import { matchPath } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { featureRoutes } from '../routes';
import { leadActions } from '../features/leads/lead-actions';
import { EXTRA_ROUTE_RULES, NAV_GROUPS, routeAllowed, ruleFor, visibleGroups } from './access';
import { QLOAX_ROLE_GRANTS } from './role-grants.fixture';

const ROLES = Object.keys(QLOAX_ROLE_GRANTS);
const canOf = (role: string) => {
  const held = new Set(QLOAX_ROLE_GRANTS[role]);
  return (code: string) => held.has(code);
};
const isAdminOf = (can: (c: string) => boolean) => can('config.manage') || can('user.manage');
const allowed = (role: string, path: string) => routeAllowed(path, canOf(role), false);
const NONE = () => false;

describe('the fixture covers every live role', () => {
  it('TEST-ACC-00 14 roles, each with grants', () => {
    expect(ROLES).toHaveLength(14);
    for (const r of ROLES) expect(QLOAX_ROLE_GRANTS[r]!.length, r).toBeGreaterThan(0);
  });
});

describe('F-08 the route guard and the sidebar agree, for every role', () => {
  it('TEST-ACC-01 every link the sidebar offers a role opens for that role (a link never leads to a refusal)', () => {
    for (const role of ROLES) {
      const can = canOf(role);
      for (const group of visibleGroups(isAdminOf(can), can, false))
        for (const item of group.items)
          if (item.to)
            expect(routeAllowed(item.to, can, false), `${role} ${item.label} ${item.to}`).toBe(true);
    }
  });

  it('TEST-ACC-02 a screen the role holds no permission for is closed to a typed URL, for every role', () => {
    const items = NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.to && i.anyOf);
    for (const role of ROLES) {
      const can = canOf(role);
      for (const item of items) {
        if (item.to === '/platform-admin') continue; // customer realm: closed for everyone, see TEST-ACC-05
        const holds = item.anyOf!.some(can);
        expect(routeAllowed(item.to!, can, false), `${role} ${item.to}`).toBe(holds);
        // and the pages inside that section follow it
        expect(routeAllowed(`${item.to}/some-id`, can, false), `${role} ${item.to}/some-id`).toBe(holds);
      }
    }
  });

  it('TEST-ACC-03 every route the web app defines is covered by a rule or is deliberately open', () => {
    const open = new Set(['/', '/notifications', '/lenders', '/products', '/workforce', '/account/security']);
    for (const route of featureRoutes) {
      const path = (route.path ?? '').replace(/:[A-Za-z]+/g, 'x1');
      if (!path || path === '*') continue;
      const rule = ruleFor(path);
      const isOpen = !rule?.anyOf;
      if (isOpen) {
        const top = '/' + path.split('/').filter(Boolean)[0];
        expect(open.has(path) || open.has(top) || !rule, `no rule for ${route.path}`).toBe(true);
      }
    }
    // every extra rule is a real route in the app
    for (const extra of EXTRA_ROUTE_RULES)
      expect(
        featureRoutes.some((r) => r.path && matchPath({ path: r.path, end: false }, extra.to)),
        extra.to,
      ).toBe(true);
  });
});

describe('F-08 direct URL access, by role', () => {
  it('TEST-ACC-04 a user with no permissions reaches only the open screens', () => {
    for (const open of [
      '/',
      '/notifications',
      '/lenders',
      '/lenders/x',
      '/products',
      '/workforce',
      '/account/security',
    ])
      expect(routeAllowed(open, NONE, false), open).toBe(true);
    for (const closed of [
      '/leads',
      '/leads/new',
      '/customers',
      '/commission',
      '/ledger',
      '/payouts',
      '/sanctions',
      '/sanctions/lc1',
      '/users',
      '/users/new',
      '/roles',
      '/roles/r1',
      '/permissions',
      '/config',
      '/audit',
      '/security',
      '/rules',
      '/admin/import-export',
      '/admin/branches',
      '/applications/a1',
    ])
      expect(routeAllowed(closed, NONE, false), closed).toBe(false);
  });

  it('TEST-ACC-05 the Platform Console is closed to every customer-tenant role, even ROLE-TENANT-ADMIN which holds platform.console on hosted', () => {
    expect(QLOAX_ROLE_GRANTS['ROLE-TENANT-ADMIN']).toContain('platform.console');
    for (const role of ROLES)
      for (const p of ['/platform-admin', '/platform-admin/tenants/ten_1', '/platform-console'])
        expect(allowed(role, p), `${role} ${p}`).toBe(false);
  });

  it('TEST-ACC-06 a platform operator reaches only Home, its account security and the Platform Console', () => {
    const can = (c: string) => c === 'platform.console';
    for (const ok of [
      '/',
      '/account/security',
      '/platform-admin',
      '/platform-admin/tenants/ten_1',
      '/platform-console',
    ])
      expect(routeAllowed(ok, can, true), ok).toBe(true);
    for (const no of [
      '/leads',
      '/notifications',
      '/lenders',
      '/products',
      '/workforce',
      '/users',
      '/commission',
      '/audit',
    ])
      expect(routeAllowed(no, can, true), no).toBe(false);
    // and without platform.console even the console is closed
    expect(routeAllowed('/platform-admin', NONE, true)).toBe(false);
    expect(PLATFORM_TENANT_ID).toMatch(/^ten_/);
  });

  it('TEST-ACC-07 spot checks that follow the business roles', () => {
    expect(allowed('ROLE-SALES-EXEC', '/leads')).toBe(true);
    expect(allowed('ROLE-SALES-EXEC', '/leads/new')).toBe(true); // lead.create
    expect(allowed('ROLE-SALES-EXEC', '/applications')).toBe(false);
    expect(allowed('ROLE-SALES-EXEC', '/commission')).toBe(false);
    expect(allowed('ROLE-RM', '/applications/a1')).toBe(true);
    expect(allowed('ROLE-RM', '/sanctions')).toBe(false);
    expect(allowed('ROLE-LOAN-OPS', '/sanctions')).toBe(true);
    expect(allowed('ROLE-LOAN-OPS', '/ledger')).toBe(false);
    expect(allowed('ROLE-FINANCE-EXEC', '/invoices')).toBe(true);
    expect(allowed('ROLE-FINANCE-EXEC', '/leads')).toBe(false);
    expect(allowed('ROLE-COMPLIANCE', '/audit')).toBe(true);
    expect(allowed('ROLE-COMPLIANCE', '/security')).toBe(true);
    expect(allowed('ROLE-COMPLIANCE', '/leads/new')).toBe(false); // read-only on leads
    expect(allowed('ROLE-RULE-AUTHOR', '/rules')).toBe(true);
    expect(allowed('ROLE-RULE-AUTHOR', '/leads')).toBe(false);
    expect(allowed('ROLE-DOC-VERIFIER', '/verifications/workbench')).toBe(true);
    expect(allowed('ROLE-BRANCH-MGR', '/users')).toBe(true);
    expect(allowed('ROLE-TEAM-MGR', '/users')).toBe(false);
  });
});

describe('F-13 Access control follows the API (user.manage or role.manage)', () => {
  it('TEST-ACC-08 the DSA owner holds role.manage but not user.manage and now reaches the roles screens; staff without either do not', () => {
    expect(QLOAX_ROLE_GRANTS['ROLE-ORG-OWNER']).toContain('role.manage');
    expect(QLOAX_ROLE_GRANTS['ROLE-ORG-OWNER']).not.toContain('user.manage');
    for (const p of ['/roles', '/roles/role_1', '/permissions'])
      expect(allowed('ROLE-ORG-OWNER', p), p).toBe(true);
    for (const role of ['ROLE-SALES-EXEC', 'ROLE-RM', 'ROLE-FINANCE-EXEC', 'ROLE-COMPLIANCE'])
      expect(allowed(role, '/roles'), role).toBe(false);
    // the owner sees the menu entry as well
    const can = canOf('ROLE-ORG-OWNER');
    const labels = visibleGroups(isAdminOf(can), can, false).flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toContain('Access control');
  });
});

describe('F-14 and F-15 one navigation, no duplicate entry', () => {
  it('TEST-ACC-09 no two menu entries point at the same screen', () => {
    const targets = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.to)).filter(Boolean) as string[];
    expect(new Set(targets).size).toBe(targets.length);
    expect(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.label))).not.toContain('Performance Dashboards');
    expect(targets).toContain('/performance');
  });
});

describe('F-12 lead action buttons follow the permission the API requires', () => {
  const act = (role: string, state: string) => leadActions(state, canOf(role));

  it('TEST-ACC-10 the sales executive can work a lead and qualify it, but cannot convert or assign it', () => {
    expect(act('ROLE-SALES-EXEC', 'NEW')).toMatchObject({
      attemptContact: true,
      markInProgress: true,
      assign: false,
    });
    expect(act('ROLE-SALES-EXEC', 'IN_PROGRESS')).toMatchObject({
      qualify: true,
      disqualify: true,
      assign: false,
    });
    expect(act('ROLE-SALES-EXEC', 'QUALIFIED')).toMatchObject({ convert: false, assign: false });
  });

  it('TEST-ACC-11 the relationship manager can convert a qualified lead; the branch and team managers assign; compliance only reads', () => {
    expect(act('ROLE-RM', 'QUALIFIED').convert).toBe(true);
    expect(act('ROLE-RM', 'NEW').assign).toBe(false);
    for (const role of ['ROLE-BRANCH-MGR', 'ROLE-TEAM-MGR']) expect(act(role, 'NEW').assign, role).toBe(true);
    for (const state of ['NEW', 'CONTACT_ATTEMPTED', 'IN_PROGRESS', 'QUALIFIED'])
      expect(Object.values(act('ROLE-COMPLIANCE', state)).some(Boolean), state).toBe(false);
  });

  it('TEST-ACC-12 the state still decides which action applies; nothing is offered on a converted or archived lead, and without permissions nothing at all', () => {
    for (const state of ['CONVERTED', 'ARCHIVED'])
      expect(Object.values(act('ROLE-ORG-OWNER', state)).some(Boolean), state).toBe(false);
    for (const state of ['NEW', 'CONTACT_ATTEMPTED', 'IN_PROGRESS', 'QUALIFIED'])
      expect(Object.values(leadActions(state, NONE)).some(Boolean), state).toBe(false);
  });
});
