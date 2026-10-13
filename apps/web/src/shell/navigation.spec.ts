import { describe, expect, it } from 'vitest';
import type { Me } from '../api/useMe';
import {
  ADMINISTRATIVE_NAV,
  OPERATIONAL_NAV,
  getAdministrativeNav,
  getOperationalNav,
  isNavActive,
} from './navigation';

function mockMeWithPermissions(permissions: string[]): Me {
  return {
    id: 'usr_test',
    tenantId: 'tnt_test',
    email: 'user@example.com',
    displayName: 'Test User',
    primaryBranchId: null,
    queueIds: [],
    grants: permissions.map((code) => ({ code, scope: 'GLOBAL', branchIds: [] })),
    mfaVerifiedAt: null,
  };
}

describe('Role-Based Navigation Configuration', () => {
  it('defines expected operational modules', () => {
    const paths = OPERATIONAL_NAV.map((item) => item.to);
    expect(paths).toEqual([
      '/leads',
      '/tasks',
      '/applications',
      '/activities',
      '/verifications',
      '/document-sharing',
      '/messaging',
    ]);
  });

  it('defines expected administrative modules', () => {
    const paths = ADMINISTRATIVE_NAV.map((item) => item.to);
    expect(paths).toEqual([
      '/users',
      '/roles',
      '/config',
      '/rules',
      '/decisions',
      '/admin',
    ]);
  });

  describe('isNavActive', () => {
    it('accurately identifies exact route match', () => {
      expect(isNavActive('/leads', '/leads')).toBe(true);
      expect(isNavActive('/tasks', '/tasks')).toBe(true);
    });

    it('accurately identifies nested subroutes', () => {
      expect(isNavActive('/leads/new', '/leads')).toBe(true);
      expect(isNavActive('/leads/lead_01', '/leads')).toBe(true);
      expect(isNavActive('/admin/branches', '/admin')).toBe(true);
      expect(isNavActive('/roles/role_01', '/roles')).toBe(true);
    });

    it('does not match partial non-subroute paths', () => {
      expect(isNavActive('/leadership', '/leads')).toBe(false);
      expect(isNavActive('/taskmasters', '/tasks')).toBe(false);
    });

    it('handles root path strictly', () => {
      expect(isNavActive('/', '/')).toBe(true);
      expect(isNavActive('/leads', '/')).toBe(false);
    });
  });

  describe('Role-Based Visibility', () => {
    it('ROLE-RM (Relationship Manager) sees operational modules only', () => {
      // RM permissions from seeds/demo/platform.ts
      const rm = mockMeWithPermissions([
        'lead.read',
        'lead.create',
        'lead.update',
        'lead.qualify',
        'consent.record',
        'activity.create',
        'customer.read',
        'task.read',
        'task.create',
        'task.update',
        'application.read',
        'application.create',
        'application.update',
        'application.cancel',
      ]);

      const operational = getOperationalNav(rm).map((i) => i.label);
      const administrative = getAdministrativeNav(rm).map((i) => i.label);

      expect(operational).toEqual(['Leads', 'Tasks', 'Applications', 'Activities']);
      expect(administrative).toEqual([]);
    });

    it('ROLE-SALES-EXEC sees Leads, Tasks, and Activities, without Applications or Admin', () => {
      const salesExec = mockMeWithPermissions([
        'lead.read',
        'lead.create',
        'lead.update',
        'lead.qualify',
        'consent.record',
        'activity.create',
        'customer.read',
        'task.read',
        'task.update',
      ]);

      const operational = getOperationalNav(salesExec).map((i) => i.label);
      const administrative = getAdministrativeNav(salesExec).map((i) => i.label);

      expect(operational).toEqual(['Leads', 'Tasks', 'Activities']);
      expect(administrative).toEqual([]);
    });

    it('ROLE-LOAN-OPS sees Tasks, Applications, Verifications, and Document Sharing', () => {
      const loanOps = mockMeWithPermissions([
        'application.read',
        'application.update',
        'application.review',
        'document.review',
        'lender_case.submit',
        'lender_case.update_status',
        'task.read',
        'task.update',
        'verification.perform',
        'verification.read',
      ]);

      const operational = getOperationalNav(loanOps).map((i) => i.label);
      const administrative = getAdministrativeNav(loanOps).map((i) => i.label);

      expect(operational).toEqual(['Tasks', 'Applications', 'Verifications', 'Document Sharing']);
      expect(administrative).toEqual([]);
    });

    it('ROLE-DOC-VERIFIER sees Applications, Verifications, and Document Sharing', () => {
      const verifier = mockMeWithPermissions([
        'application.read',
        'document.review',
        'verification.perform',
        'verification.read',
      ]);

      const operational = getOperationalNav(verifier).map((i) => i.label);
      const administrative = getAdministrativeNav(verifier).map((i) => i.label);

      expect(operational).toEqual(['Applications', 'Verifications', 'Document Sharing']);
      expect(administrative).toEqual([]);
    });

    it('ROLE-TENANT-ADMIN sees administrative features and Verifications, not Leads or Tasks', () => {
      const tenantAdmin = mockMeWithPermissions([
        'config.manage',
        'user.manage',
        'audit.read',
        'verification.read',
        'verification.perform',
      ]);

      const operational = getOperationalNav(tenantAdmin).map((i) => i.label);
      const administrative = getAdministrativeNav(tenantAdmin).map((i) => i.label);

      expect(operational).toEqual(['Verifications', 'Document Sharing', 'Messaging']);
      expect(administrative).toEqual(['Users', 'Access Control', 'Configuration', 'Platform Admin']);
    });

    it('ROLE-RULE-AUTHOR sees Rules and Decisions under Administration only', () => {
      const ruleAuthor = mockMeWithPermissions(['rule.author', 'rule.simulate']);

      const operational = getOperationalNav(ruleAuthor).map((i) => i.label);
      const administrative = getAdministrativeNav(ruleAuthor).map((i) => i.label);

      expect(operational).toEqual([]);
      expect(administrative).toEqual(['Rules', 'Decisions']);
    });

    it('ROLE-RULE-APPROVER sees Rules and Decisions under Administration only', () => {
      const ruleApprover = mockMeWithPermissions(['rule.simulate', 'rule.approve', 'rule.publish', 'rule.suspend']);

      const operational = getOperationalNav(ruleApprover).map((i) => i.label);
      const administrative = getAdministrativeNav(ruleApprover).map((i) => i.label);

      expect(operational).toEqual([]);
      expect(administrative).toEqual(['Rules', 'Decisions']);
    });

    it('handles undefined or grantless user gracefully without throwing', () => {
      expect(getOperationalNav(undefined)).toEqual([]);
      expect(getAdministrativeNav(undefined)).toEqual([]);

      const emptyUser = mockMeWithPermissions([]);
      expect(getOperationalNav(emptyUser)).toEqual([]);
      expect(getAdministrativeNav(emptyUser)).toEqual([]);
    });
  });
});
