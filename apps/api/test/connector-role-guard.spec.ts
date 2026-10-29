// Unit tests: a connector portal login holds no role, the reserved ROLE-CONNECTOR namespace is closed to staff and to role creation, and a
// connector's relationship owner is an active internal staff member. The database guard (migration 0097) is covered by
// connector-role-guard.int.spec.ts, and the route-level refusals by platform-users.spec.ts.
import type { AppError } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';
import { assertRoleAllowedForUserType, assertRoleCodeNotReserved } from '../src/modules/platform/role-guards';
import { assertInternalRelationshipOwner } from '../src/modules/origination/connectors/connector-service';

/** The issue code of the error a check throws, or undefined when it passes. */
function refusalOf(check: () => void): { code: string; issue: string } | undefined {
  try {
    check();
    return undefined;
  } catch (err) {
    const e = err as AppError;
    return { code: e.code, issue: e.details[0]?.issue ?? '' };
  }
}

describe('role assignment by user type (TEST-CONROLE)', () => {
  it('TEST-CONROLE-001 a connector portal login is refused every role, including a connector-named one', () => {
    expect(refusalOf(() => assertRoleAllowedForUserType('CONNECTOR', 'ROLE-CONNECTOR-PORTAL'))).toEqual({
      code: 'VALIDATION_ERROR',
      issue: 'ROLE_NOT_ALLOWED_FOR_CONNECTOR',
    });
  });

  it('TEST-CONROLE-002 a connector portal login is refused the relationship-manager role', () => {
    expect(refusalOf(() => assertRoleAllowedForUserType('CONNECTOR', 'ROLE-RM'))).toEqual({
      code: 'VALIDATION_ERROR',
      issue: 'ROLE_NOT_ALLOWED_FOR_CONNECTOR',
    });
  });

  it('TEST-CONROLE-003 a connector portal login is refused the administrator and finance roles', () => {
    expect(refusalOf(() => assertRoleAllowedForUserType('CONNECTOR', 'ROLE-TENANT-ADMIN'))?.issue).toBe(
      'ROLE_NOT_ALLOWED_FOR_CONNECTOR',
    );
    expect(refusalOf(() => assertRoleAllowedForUserType('CONNECTOR', 'ROLE-FINANCE-EXEC'))?.issue).toBe(
      'ROLE_NOT_ALLOWED_FOR_CONNECTOR',
    );
  });

  it('TEST-CONROLE-004 a staff account may hold internal roles', () => {
    expect(refusalOf(() => assertRoleAllowedForUserType('STAFF', 'ROLE-RM'))).toBeUndefined();
    expect(refusalOf(() => assertRoleAllowedForUserType('STAFF', 'ROLE-TENANT-ADMIN'))).toBeUndefined();
  });

  it('TEST-CONROLE-005 a staff account is refused a role in the reserved connector namespace', () => {
    expect(refusalOf(() => assertRoleAllowedForUserType('STAFF', 'ROLE-CONNECTOR-PORTAL'))).toEqual({
      code: 'VALIDATION_ERROR',
      issue: 'CONNECTOR_ROLE_NOT_ALLOWED_FOR_STAFF',
    });
    expect(refusalOf(() => assertRoleAllowedForUserType('STAFF', 'ROLE-CONNECTOR'))?.issue).toBe(
      'CONNECTOR_ROLE_NOT_ALLOWED_FOR_STAFF',
    );
  });

  it('TEST-CONROLE-006 a user type other than STAFF or CONNECTOR holds no role', () => {
    expect(refusalOf(() => assertRoleAllowedForUserType('SYSTEM', 'ROLE-RM'))?.issue).toBe(
      'USER_TYPE_NOT_ALLOWED',
    );
  });

  it('TEST-CONROLE-007 a misleadingly named role that carries internal permissions is still refused for a connector', () => {
    // The refusal does not depend on the name: a connector holds no role, whatever the role is called or contains.
    for (const code of ['ROLE-OPS', 'ROLE-CONNECTOR-OPS', 'ROLE-PARTNER-SUPPORT']) {
      expect(refusalOf(() => assertRoleAllowedForUserType('CONNECTOR', code))?.issue).toBe(
        'ROLE_NOT_ALLOWED_FOR_CONNECTOR',
      );
    }
  });
});

describe('reserved role codes (TEST-CONROLE-RES)', () => {
  it('TEST-CONROLE-RES-001 a tenant cannot create a role in the reserved connector namespace', () => {
    for (const code of ['ROLE-CONNECTOR-OPS', 'ROLE-CONNECTOR-PORTAL', 'ROLE-CONNECTOR']) {
      expect(refusalOf(() => assertRoleCodeNotReserved(code))).toEqual({
        code: 'VALIDATION_ERROR',
        issue: 'RESERVED_ROLE_CODE',
      });
    }
  });

  it('TEST-CONROLE-RES-002 ordinary role codes, including ones that only mention the connector, are accepted', () => {
    expect(refusalOf(() => assertRoleCodeNotReserved('ROLE-RM'))).toBeUndefined();
    expect(refusalOf(() => assertRoleCodeNotReserved('ROLE-CUSTOM-CONNECTOR-REVIEW'))).toBeUndefined();
  });
});

describe('connector relationship owner (TEST-CONOWNER)', () => {
  it('TEST-CONOWNER-001 an active staff member in the tenant may own a connector', () => {
    expect(
      refusalOf(() => assertInternalRelationshipOwner({ user_type: 'STAFF', status: 'ACTIVE' })),
    ).toBeUndefined();
  });

  it('TEST-CONOWNER-002 a missing owner (wrong tenant, or no such user) is refused', () => {
    expect(refusalOf(() => assertInternalRelationshipOwner(undefined))).toEqual({
      code: 'VALIDATION_ERROR',
      issue: 'NOT_FOUND',
    });
  });

  it('TEST-CONOWNER-003 a connector portal login is never an owner', () => {
    expect(
      refusalOf(() => assertInternalRelationshipOwner({ user_type: 'CONNECTOR', status: 'ACTIVE' })),
    ).toEqual({
      code: 'VALIDATION_ERROR',
      issue: 'NOT_INTERNAL_STAFF',
    });
  });

  it('TEST-CONOWNER-004 a staff member who is not active is refused', () => {
    for (const status of ['INVITED', 'SUSPENDED', 'DEACTIVATED']) {
      expect(refusalOf(() => assertInternalRelationshipOwner({ user_type: 'STAFF', status }))?.issue).toBe(
        'OWNER_NOT_ACTIVE',
      );
    }
  });
});
