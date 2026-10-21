import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import proposedDiff from '../docs/PROPOSED_PERMISSION_GRANTS_DIFF.json';
import { QLOAX_ROLE_GRANTS } from '../apps/web/src/shell/role-grants.fixture';

describe('Rehearsal for Migration 0069: Permission Realignment & Period Close', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const migrationPath = path.join(root, 'supabase/migrations/20261001000069_permission_realignment_and_period_close.sql');
  const verifyPath = path.join(root, 'tools/sql/0069/verify.sql');
  const rollbackPath = path.join(root, 'tools/sql/0069/rollback.sql');

  const migrationSql = readFileSync(migrationPath, 'utf8');
  const verifySql = readFileSync(verifyPath, 'utf8');
  const rollbackSql = readFileSync(rollbackPath, 'utf8');

  it('contains exactly the 45 approved permission grants from PROPOSED_PERMISSION_GRANTS_DIFF.json', () => {
    expect(proposedDiff).toHaveLength(45);

    for (const item of proposedDiff) {
      const roleCode = `ROLE-${item.role}`;
      const permCode = item.perm;
      const tuple = `('${roleCode}', '${permCode}')`;

      // Check migration SQL
      expect(migrationSql).toContain(tuple);

      // Check verify SQL
      expect(verifySql).toContain(tuple);

      // Check rollback SQL
      expect(rollbackSql).toContain(tuple);
    }
  });

  it('defines finance.period_close in app.permission catalogue with ON CONFLICT DO NOTHING', () => {
    expect(migrationSql).toContain("('finance.period_close',");
    expect(migrationSql).toContain('ON CONFLICT (code) DO NOTHING');
    expect(verifySql).toContain("code = 'finance.period_close'");
  });

  it('scopes role_permission inserts strictly to tenant qloax-dsa', () => {
    expect(migrationSql).toContain("WHERE t.slug = 'qloax-dsa'");
    expect(migrationSql).toContain('ON CONFLICT (role_id, permission_code) DO NOTHING');
    expect(rollbackSql).toContain("t.slug = 'qloax-dsa'");
  });

  it('verifies that none of the 45 grants already existed in the live baseline fixture for tenant qloax-dsa', () => {
    for (const item of proposedDiff) {
      const roleCode = `ROLE-${item.role}`;
      const existingGrants = QLOAX_ROLE_GRANTS[roleCode] ?? [];
      expect(existingGrants).not.toContain(item.perm);
    }
  });

  it('computes exact post-migration grant totals per role', () => {
    const grantCountsAfter: Record<string, number> = {};
    for (const [role, grants] of Object.entries(QLOAX_ROLE_GRANTS)) {
      grantCountsAfter[role] = grants.length;
    }

    for (const item of proposedDiff) {
      const roleCode = `ROLE-${item.role}`;
      grantCountsAfter[roleCode] = (grantCountsAfter[roleCode] || 0) + 1;
    }

    expect(grantCountsAfter).toEqual({
      'ROLE-BRANCH-MGR': 48,
      'ROLE-COMMISSION-APPROVER': 8,
      'ROLE-COMPLIANCE': 11,
      'ROLE-DOC-VERIFIER': 9,
      'ROLE-FINANCE-EXEC': 10,
      'ROLE-LOAN-OPS': 27,
      'ROLE-ORG-OWNER': 82,
      'ROLE-RM': 20,
      'ROLE-RULE-APPROVER': 6,
      'ROLE-RULE-AUTHOR': 4,
      'ROLE-SALES-EXEC': 12,
      'ROLE-TEAM-MGR': 17,
      'ROLE-TENANT-ADMIN': 70,
      'ROLE-VERIFIER': 7,
    });
  });
});
