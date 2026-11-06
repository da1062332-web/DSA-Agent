import type { PermissionGrant, ScopeType } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';
import { dedupeGrants, effectiveGrants } from './resolve-principal';

const row = (permission_code: string, scope_type: ScopeType = 'TENANT', scope_branch_ids: string[] = []) => ({
  permission_code,
  scope_type,
  scope_branch_ids,
});

const grant = (code: string, scope: PermissionGrant['scope'], branchIds: string[] = []): PermissionGrant => ({
  code: code as PermissionGrant['code'],
  scope,
  branchIds,
});

describe('dedupeGrants', () => {
  it('TEST-ACL-DEDUPE-01 a code held through two roles with the same scope appears once', () => {
    const out = dedupeGrants([
      grant('lead.read', 'TENANT'),
      grant('lead.read', 'TENANT'),
      grant('task.read', 'TENANT'),
    ]);
    expect(out.map((g) => g.code)).toEqual(['lead.read', 'task.read']);
  });

  it('TEST-ACL-DEDUPE-02 grants of the same code with different scopes or branches are all kept, because authorisation reads each scope', () => {
    const out = dedupeGrants([
      grant('lead.read', 'OWN'),
      grant('lead.read', 'BRANCH', ['brn_a']),
      grant('lead.read', 'BRANCH', ['brn_b']),
      grant('lead.read', 'TENANT'),
    ]);
    expect(out).toHaveLength(4);
  });

  it('TEST-ACL-DEDUPE-03 branch order does not make two identical grants look different', () => {
    const out = dedupeGrants([
      grant('lead.read', 'BRANCH', ['brn_a', 'brn_b']),
      grant('lead.read', 'BRANCH', ['brn_b', 'brn_a']),
    ]);
    expect(out).toHaveLength(1);
  });
});

describe('effectiveGrants: a connector login never carries internal grants (TEST-CONCONTAIN)', () => {
  it('TEST-CONCONTAIN-001 a connector login with an open relationship-manager role carries no grants', () => {
    // The incident shape: a role row still open on a portal login (ROLE-RM grants lead.read and lead.create).
    expect(effectiveGrants('CONNECTOR', [row('lead.read'), row('lead.create', 'BRANCH', ['brn_a'])])).toEqual([]);
  });

  it('TEST-CONCONTAIN-002 a connector login with no role rows has no grants', () => {
    expect(effectiveGrants('CONNECTOR', [])).toEqual([]);
  });

  it('TEST-CONCONTAIN-003 a staff account keeps the grants of its roles, with the branches of a branch grant', () => {
    expect(effectiveGrants('STAFF', [row('lead.read', 'BRANCH', ['brn_a'])])).toEqual([
      { code: 'lead.read', scope: 'BRANCH', branchIds: ['brn_a'] },
    ]);
  });

  it('TEST-CONCONTAIN-004 a staff account drops an unknown permission code and an exact repeat', () => {
    expect(effectiveGrants('STAFF', [row('lead.read'), row('lead.read'), row('not.a.permission')])).toEqual([
      { code: 'lead.read', scope: 'TENANT', branchIds: [] },
    ]);
  });
});
