// Unit and regression tests for role guards (privilege escalation, tenant administrator grants, and platform permission bounds).
import { PLATFORM_TENANT_ID, type PermissionCode, type Principal } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';
import {
  ADMINISTRATOR_PERMISSION,
  assertCanGrantPermissions,
  assertNoPlatformPermissionsForTenant,
} from '../src/modules/platform/role-guards';

function principalWith(grants: string[], tenantId = 'ten_customer_01'): Principal {
  return {
    kind: 'USER',
    id: 'usr_test_01',
    tenantId,
    primaryBranchId: 'br_ho',
    managedTeamMemberIds: [],
    queueIds: [],
    authTime: new Date().toISOString(),
    grants: grants.map((code) => ({
      code: code as PermissionCode,
      scope: 'TENANT',
      branchIds: [],
    })),
  };
}

describe('assertCanGrantPermissions (Privilege Escalation & Tenant Administrator Policy)', () => {
  const verifierPermissions = [
    'application.read',
    'document.review',
    'verification.perform',
    'verification.create',
    'verification.update',
    'verification.complete',
    'verification.read',
  ];

  it('allows Tenant Administrator holding ADMINISTRATOR_PERMISSION (user.manage) to grant permissions they do not personally hold, e.g. for ROLE-DOC-VERIFIER', () => {
    // A Tenant Admin who only has management permissions and not personal verifier/lender permissions
    const tenantAdmin = principalWith(['user.manage', 'role.manage', 'config.manage']);

    expect(() => {
      assertCanGrantPermissions(tenantAdmin, verifierPermissions);
    }).not.toThrow();

    expect(() => {
      assertCanGrantPermissions(tenantAdmin, ['lender.manage', 'finance.reconcile', 'sanction.record']);
    }).not.toThrow();
  });

  it('allows a limited role editor (role.manage without user.manage) to grant only permissions they hold themselves', () => {
    const limitedEditor = principalWith(['role.manage', 'lead.read', 'task.read']);

    expect(() => {
      assertCanGrantPermissions(limitedEditor, ['lead.read', 'task.read']);
    }).not.toThrow();
  });

  it('blocks a limited role editor from granting permissions they do not hold with the exact error message', () => {
    const limitedEditor = principalWith(['role.manage', 'lead.read', 'task.read']);

    expect(() => {
      assertCanGrantPermissions(limitedEditor, ['lead.read', 'lender.manage']);
    }).toThrowError('You can only give a role permissions that you hold yourself.');

    expect(() => {
      assertCanGrantPermissions(limitedEditor, verifierPermissions);
    }).toThrowError('You can only give a role permissions that you hold yourself.');
  });

  it('blocks permissionless users from granting any permissions', () => {
    const regularUser = principalWith([]);

    expect(() => {
      assertCanGrantPermissions(regularUser, ['lead.read']);
    }).toThrowError('You can only give a role permissions that you hold yourself.');
  });
});

describe('assertNoPlatformPermissionsForTenant (Platform Boundary)', () => {
  it('strictly blocks customer tenant administrators from granting platform.* permissions', () => {
    expect(() => {
      assertNoPlatformPermissionsForTenant('ten_customer_01', ['platform.console', 'lead.read']);
    }).toThrowError('Platform permissions cannot be given to a customer tenant role.');
  });

  it('allows customer tenant administrators to grant customer permissions', () => {
    expect(() => {
      assertNoPlatformPermissionsForTenant('ten_customer_01', ['lead.read', 'verification.perform']);
    }).not.toThrow();
  });

  it('allows platform realm tenant to hold platform permissions', () => {
    expect(() => {
      assertNoPlatformPermissionsForTenant(PLATFORM_TENANT_ID, ['platform.console', 'platform.flags']);
    }).not.toThrow();
  });
});
