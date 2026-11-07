import type { PermissionGrant, RequestContext, ScopeType, TxRunner } from '@dsa/contracts';
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

describe('Principal resolution caching', () => {
  it('serves subsequent resolves from cache when cacheTtlMs is active', async () => {
    let txCount = 0;
    const mockTxRunner = {
      withTenantTx: async <T>(_ctx: RequestContext, _fn: unknown): Promise<T> => {
        txCount++;
        return {
          kind: 'USER' as const,
          id: 'usr_test_1',
          tenantId: 'ten_test',
          primaryBranchId: 'brn_1',
          managedTeamMemberIds: [],
          queueIds: [],
          grants: [],
          authTime: null,
          userType: 'STAFF' as const,
        } as unknown as T;
      },
    } as unknown as TxRunner;

    const { createPrincipalResolver } = await import('./resolve-principal');
    const resolver = createPrincipalResolver(mockTxRunner, { cacheTtlMs: 5000 });

    const token = {
      tenantId: 'ten_test',
      subject: 'sub_test_1',
      email: 'test@example.com',
      aal: 'aal1' as const,
      mfaVerifiedAt: null,
    };

    const first = await resolver.resolve(token, { correlationId: 'c1', now: new Date(1000) });
    expect(first.id).toBe('usr_test_1');
    expect(txCount).toBe(1);

    // Second call within TTL should hit cache
    const second = await resolver.resolve(token, { correlationId: 'c2', now: new Date(2000) });
    expect(second.id).toBe('usr_test_1');
    expect(txCount).toBe(1);

    // Call after TTL expires should re-run transaction
    const third = await resolver.resolve(token, { correlationId: 'c3', now: new Date(7000) });
    expect(third.id).toBe('usr_test_1');
    expect(txCount).toBe(2);
  });
});
