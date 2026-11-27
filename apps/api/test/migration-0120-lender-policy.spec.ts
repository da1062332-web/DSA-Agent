// P1-04 migration 0120 static checks (owner: Dipanshu). No database: runs in `npm test`. The rehearsal on a throwaway Postgres is
// migration-0120-lender-policy.int.spec.ts.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROLE_GRANTS_M120, ROLES } from '../../../seeds/demo/platform';

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const M120 = readdirSync(MIGRATIONS).find((f) => f.startsWith('20261001000120_'))!;
const read = (p: string) => readFileSync(p, 'utf8');
const stripComments = (sql: string) =>
  sql
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');

const pairsIn = (sql: string): Set<string> => {
  const rows = /VALUES\s*(.*?)\)\s*AS g\(role_code, permission_code\)/is.exec(sql)?.[1] ?? '';
  const out = new Set<string>();
  for (const m of rows.matchAll(/\(\s*'(ROLE-[A-Z-]+)'\s*,\s*'([a-z_.]+)'\s*\)/g)) out.add(`${m[1]} ${m[2]}`);
  return out;
};
const verifyPairs = (sql: string): Set<string> => {
  const rows = /grants\(role_code, permission_code\) AS \(VALUES(.*?)\)\s*\n\s*SELECT/is.exec(sql)?.[1] ?? '';
  const out = new Set<string>();
  for (const m of rows.matchAll(/\(\s*'(ROLE-[A-Z-]+)'\s*,\s*'([a-z_.]+)'\s*\)/g)) out.add(`${m[1]} ${m[2]}`);
  return out;
};
const seedPairs = new Set(
  Object.entries(ROLE_GRANTS_M120).flatMap(([role, codes]) => codes.map((c) => `${role} ${c}`)),
);

describe('P1-04 migration 0120 (static)', () => {
  const sql = read(path.join(MIGRATIONS, M120));

  it('P1-04 TEST-M120-S1 the migration, the verify script and the demo seed grant exactly the same role/permission pairs', () => {
    const fromSql = pairsIn(sql);
    const fromVerify = verifyPairs(read(path.join(ROOT, 'tools/sql/batch/120.verify.sql')));
    expect(fromSql.size).toBe(12);
    expect(fromSql.has('ROLE-ORG-OWNER rule.approve')).toBe(true); // the owner can activate a policy someone else drafted
    expect([...fromSql].sort()).toEqual([...seedPairs].sort());
    expect([...fromVerify].sort()).toEqual([...seedPairs].sort());
  });

  it('P1-04 TEST-M120-S2 the seeded roles hold the new codes, so a newly provisioned tenant gets them too', () => {
    for (const [role, codes] of Object.entries(ROLE_GRANTS_M120)) {
      const seeded = ROLES.find((r) => r.code === role);
      expect(seeded, role).toBeDefined();
      for (const c of codes) expect(seeded!.permissions, `${role} ${c}`).toContain(c);
    }
  });

  it('P1-04 TEST-M120-S3 the migration is additive: it deletes, truncates and drops nothing', () => {
    const statements = stripComments(sql).replace(/'[^']*'/g, "''");
    expect(statements).not.toMatch(/\b(DELETE|TRUNCATE|DROP)\b/i);
    expect(statements).not.toMatch(/\bUPDATE\s+(app\.)?[a-z_]+\s+SET\b/i);
  });

  it('P1-04 TEST-M120-S4 the migration defines the three permission codes it grants', () => {
    for (const code of ['lender_policy.read', 'lender_policy.manage', 'lender_match.run'])
      expect(sql).toMatch(new RegExp(`\\('${code.replace('.', '\\.')}',`));
  });

  it('P1-04 TEST-M120-S5 match history is insert-only for the API role', () => {
    expect(sql).toMatch(/GRANT SELECT, INSERT ON lender_match_run, lender_match_result TO dsa_app;/);
    expect(sql).not.toMatch(/GRANT[^;]*(UPDATE|DELETE)[^;]*lender_match_(run|result)/i);
  });

  it('P1-04 TEST-M120-S6 the rollback drops the three tables and removes the three permissions in one transaction', () => {
    const rb = stripComments(read(path.join(ROOT, 'tools/sql/batch/120.rollback.sql')));
    expect(rb).toMatch(/^BEGIN;/m);
    expect(rb).toMatch(/^COMMIT;/m);
    for (const t of ['lender_match_result', 'lender_match_run', 'lender_policy'])
      expect(rb).toContain(`DROP TABLE IF EXISTS app.${t};`);
    expect(rb).toMatch(/DELETE FROM app\.role_permission/);
    expect(rb).toMatch(/DELETE FROM app\.permission/);
  });
});
