import { describe, expect, it } from 'vitest';
import { ACTION_RULES, canPerformAction, routeAllowed, type ActionId } from './access';
import { QLOAX_ROLE_GRANTS } from './role-grants.fixture';
import { resolveUserRoles } from '../features/dashboard/role-routing';

describe('Phase 5: Persona Verification Matrix across 14 Live Roles', () => {
  const roles = Object.keys(QLOAX_ROLE_GRANTS);

  it('evaluates all 14 tenant roles from qloax-dsa fixture', () => {
    expect(roles).toHaveLength(14);
  });

  describe('Dashboard Persona Routing', () => {
    it('routes single-role users to their dedicated dashboard persona', () => {
      const expectedMapping: Record<string, string> = {
        'ROLE-SALES-EXEC': 'ROLE-SALES-EXEC',
        'ROLE-LOAN-OPS': 'ROLE-LOAN-OPS',
        'ROLE-DOC-VERIFIER': 'ROLE-DOC-VERIFIER',
        'ROLE-RM': 'ROLE-RM',
        'ROLE-BRANCH-MGR': 'ROLE-BRANCH-MGR',
        'ROLE-TEAM-MGR': 'ROLE-TEAM-MGR',
        'ROLE-FINANCE-EXEC': 'ROLE-FINANCE-EXEC',
        'ROLE-COMMISSION-APPROVER': 'ROLE-COMMISSION-APPROVER',
        'ROLE-COMPLIANCE': 'ROLE-COMPLIANCE',
        'ROLE-RULE-AUTHOR': 'ROLE-RULE-AUTHOR',
        'ROLE-RULE-APPROVER': 'ROLE-RULE-APPROVER',
        'ROLE-ORG-OWNER': 'ROLE-ORG-OWNER',
        'ROLE-TENANT-ADMIN': 'ROLE-TENANT-ADMIN',
      };

      for (const [role, expectedDashboard] of Object.entries(expectedMapping)) {
        const mockMe = {
          id: 'usr_test',
          tenantId: 'qloax-dsa',
          email: `${role.toLowerCase()}@qloax.com`,
          displayName: `Test ${role}`,
          primaryBranchId: 'br_01',
          queueIds: [],
          mfaVerifiedAt: null,
          roles: [role],
          grants: (QLOAX_ROLE_GRANTS[role] || []).map((code) => ({
            code,
            scope: 'TENANT',
            branchIds: [],
          })),
        };

        const resolved = resolveUserRoles(mockMe as any);
        expect(resolved[0], `${role} should resolve to ${expectedDashboard}`).toBe(expectedDashboard);
      }
    });
  });

  describe('Route Navigation Fail-Closed Verification', () => {
    it('never allows customer tenant roles to open the Platform Console', () => {
      for (const [role, grants] of Object.entries(QLOAX_ROLE_GRANTS)) {
        const has = (code: string) => grants.includes(code);
        const allowed = routeAllowed('/platform-admin', has, false);
        expect(allowed, `${role} must not access /platform-admin`).toBe(false);
      }
    });

    it('enforces that view-only users cannot access mutating routes', () => {
      // Sales Exec cannot access Admin / Config / Roles
      const salesGrants = QLOAX_ROLE_GRANTS['ROLE-SALES-EXEC']!;
      const hasSales = (code: string) => salesGrants.includes(code);
      expect(routeAllowed('/config', hasSales, false)).toBe(false);
      expect(routeAllowed('/roles', hasSales, false)).toBe(false);
      expect(routeAllowed('/users', hasSales, false)).toBe(false);
      expect(routeAllowed('/sanctions', hasSales, false)).toBe(false);

      // Compliance cannot mutate leads or origination
      const compGrants = QLOAX_ROLE_GRANTS['ROLE-COMPLIANCE']!;
      const hasComp = (code: string) => compGrants.includes(code);
      expect(routeAllowed('/leads/new', hasComp, false)).toBe(false);
      expect(routeAllowed('/commission', hasComp, false)).toBe(false);
    });
  });

  describe('Action-Level Button Guards across All Personas', () => {
    it('verifies lead.create permission gate', () => {
      const allowedRoles = roles.filter((r) =>
        canPerformAction('lead.create', (c) => QLOAX_ROLE_GRANTS[r]!.includes(c)),
      );
      // Sales Exec, RM, Team Mgr, Branch Mgr, Org Owner, Tenant Admin
      expect(allowedRoles).toContain('ROLE-SALES-EXEC');
      expect(allowedRoles).toContain('ROLE-RM');
      expect(allowedRoles).toContain('ROLE-ORG-OWNER');
      expect(allowedRoles).toContain('ROLE-TENANT-ADMIN');
      // Must not contain Compliance, Verifier, Finance Exec
      expect(allowedRoles).not.toContain('ROLE-COMPLIANCE');
      expect(allowedRoles).not.toContain('ROLE-DOC-VERIFIER');
      expect(allowedRoles).not.toContain('ROLE-FINANCE-EXEC');
    });

    it('verifies user.manage permission gate', () => {
      const allowedRoles = roles.filter((r) =>
        canPerformAction('user.manage', (c) => QLOAX_ROLE_GRANTS[r]!.includes(c)),
      );
      expect(allowedRoles).toContain('ROLE-TENANT-ADMIN');
      expect(allowedRoles).toContain('ROLE-BRANCH-MGR');
      // Sales Exec, RM, Team Mgr, Compliance must NOT manage users
      expect(allowedRoles).not.toContain('ROLE-SALES-EXEC');
      expect(allowedRoles).not.toContain('ROLE-RM');
      expect(allowedRoles).not.toContain('ROLE-TEAM-MGR');
      expect(allowedRoles).not.toContain('ROLE-COMPLIANCE');
    });

    it('verifies role.manage permission gate', () => {
      const allowedRoles = roles.filter((r) =>
        canPerformAction('role.manage', (c) => QLOAX_ROLE_GRANTS[r]!.includes(c)),
      );
      expect(allowedRoles).toContain('ROLE-ORG-OWNER');
      expect(allowedRoles).toContain('ROLE-TENANT-ADMIN');
      expect(allowedRoles).toContain('ROLE-BRANCH-MGR'); // Branch Mgr holds user.manage, which the API accepts for role routes
      // Team Mgr, Sales Exec must NOT manage roles
      expect(allowedRoles).not.toContain('ROLE-TEAM-MGR');
      expect(allowedRoles).not.toContain('ROLE-SALES-EXEC');
    });

    it('verifies payout.approve permission gate adheres to separation of duties', () => {
      const allowedRoles = roles.filter((r) =>
        canPerformAction('payout.approve', (c) => QLOAX_ROLE_GRANTS[r]!.includes(c)),
      );
      expect(allowedRoles).toContain('ROLE-COMMISSION-APPROVER');
      // Finance Executive proposes/calculates but CANNOT self-approve payouts
      expect(allowedRoles).not.toContain('ROLE-FINANCE-EXEC');
      expect(allowedRoles).not.toContain('ROLE-SALES-EXEC');
    });

    it('verifies security.incident permission gate', () => {
      const allowedRoles = roles.filter((r) =>
        canPerformAction('security.incident', (c) => QLOAX_ROLE_GRANTS[r]!.includes(c)),
      );
      expect(allowedRoles).toContain('ROLE-COMPLIANCE');
      expect(allowedRoles).not.toContain('ROLE-SALES-EXEC');
      expect(allowedRoles).not.toContain('ROLE-DOC-VERIFIER');
    });
  });

  describe('Multi-Role Switching Simulation', () => {
    it('allows a user holding both Sales Exec and Relationship Manager to switch views while authorization remains the union', () => {
      const combinedGrants = [
        ...QLOAX_ROLE_GRANTS['ROLE-SALES-EXEC']!,
        ...QLOAX_ROLE_GRANTS['ROLE-RM']!,
      ];
      const has = (code: string) => combinedGrants.includes(code);

      // Has authorization for both Sales actions (lead.create) and RM actions (application.create)
      expect(canPerformAction('lead.create', has)).toBe(true);
      expect(canPerformAction('application.create', has)).toBe(true);

      // But does not have finance or compliance actions
      expect(canPerformAction('commission.calculate', has)).toBe(false);
      expect(canPerformAction('security.incident', has)).toBe(false);
    });
  });
});
