import type { PermissionGrant } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';
import { dedupeGrants } from './resolve-principal';

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
