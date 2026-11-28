// P1-05 migration 0130 static checks (owner: Prathamesh). No database: runs in `npm test`. The rehearsal on a throwaway Postgres is
// migration-0130-credit-report.int.spec.ts.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PERMISSION_CODES } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';
import { ROLE_GRANTS_M130, ROLES } from '../../../seeds/demo/platform';

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const M130 = readdirSync(MIGRATIONS).find((f) => f.startsWith('20261001000130_'))!;
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
  const rows =
    /grants\(role_code, permission_code\) AS \(VALUES(.*?)\),\s*\n\s*consent_checks/is.exec(sql)?.[1] ?? '';
  const out = new Set<string>();
  for (const m of rows.matchAll(/\(\s*'(ROLE-[A-Z-]+)'\s*,\s*'([a-z_.]+)'\s*\)/g)) out.add(`${m[1]} ${m[2]}`);
  return out;
};
const seedPairs = new Set(
  Object.entries(ROLE_GRANTS_M130).flatMap(([role, codes]) => codes.map((c) => `${role} ${c}`)),
);

describe('P1-05 migration 0130 (static)', () => {
  const sql = read(path.join(MIGRATIONS, M130));
  const verify = read(path.join(ROOT, 'tools/sql/batch/130.verify.sql'));
  const rollback = read(path.join(ROOT, 'tools/sql/batch/130.rollback.sql'));

  it('P1-05 TEST-CRP-M130-S1 the migration, the verify script and the demo seed grant exactly the same six role/permission pairs', () => {
    const fromSql = pairsIn(sql);
    expect(fromSql.size).toBe(6);
    expect([...fromSql].sort()).toEqual([...seedPairs].sort());
    expect([...verifyPairs(verify)].sort()).toEqual([...seedPairs].sort());
  });

  it('P1-05 TEST-CRP-M130-S2 pulling is for Loan operations and the owner; reading adds the RM and the Branch manager', () => {
    expect([...seedPairs].filter((p) => p.endsWith('credit_report.pull')).sort()).toEqual([
      'ROLE-LOAN-OPS credit_report.pull',
      'ROLE-ORG-OWNER credit_report.pull',
    ]);
    expect([...seedPairs].filter((p) => p.endsWith('credit_report.read')).sort()).toEqual([
      'ROLE-BRANCH-MGR credit_report.read',
      'ROLE-LOAN-OPS credit_report.read',
      'ROLE-ORG-OWNER credit_report.read',
      'ROLE-RM credit_report.read',
    ]);
  });

  it('P1-05 TEST-CRP-M130-S3 the seeded roles hold the new codes, so a newly provisioned tenant gets them too', () => {
    for (const [role, codes] of Object.entries(ROLE_GRANTS_M130)) {
      const seeded = ROLES.find((r) => r.code === role);
      expect(seeded, role).toBeDefined();
      for (const c of codes) expect(seeded!.permissions, `${role} ${c}`).toContain(c);
    }
  });

  it('P1-05 TEST-CRP-M130-S4 the migration defines the two permission codes it grants, and the contracts carry them', () => {
    for (const code of ['credit_report.pull', 'credit_report.read']) {
      expect(sql).toMatch(new RegExp(`\\('${code.replace('.', '\\.')}',`));
      expect(PERMISSION_CODES as readonly string[]).toContain(code);
    }
  });

  it('P1-05 TEST-CRP-M130-S5 the migration only adds: it deletes, truncates and drops nothing (the CHECK rebuild is inside quoted SQL)', () => {
    const statements = stripComments(sql)
      .replace(/CREATE OR REPLACE TRIGGER credit_report_no_mutation[^;]*;/, '')
      .replace(/'[^']*'/g, "''");
    expect(statements).not.toMatch(/\b(DELETE|TRUNCATE|DROP)\b/i);
    expect(statements).not.toMatch(/\bUPDATE\s+(app\.)?[a-z_]+\s+SET\b/i);
  });

  it('P1-05 TEST-CRP-M130-S6 credit_report is history: insert-only for the API role, with the no-mutation trigger and row-level security', () => {
    expect(sql).toMatch(/GRANT SELECT, INSERT ON credit_report TO dsa_app;/);
    expect(sql).not.toMatch(/GRANT[^;]*(UPDATE|DELETE)[^;]*credit_report/i);
    expect(sql).toMatch(
      /CREATE OR REPLACE TRIGGER credit_report_no_mutation\s+BEFORE UPDATE OR DELETE ON credit_report/,
    );
    expect(sql).toContain("enable_tenant_rls(%L)', 'app.credit_report'");
  });

  it('P1-05 TEST-CRP-M130-S7 the consent CHECKs are rebuilt from the catalogue and never retyped', () => {
    const code = stripComments(sql);
    expect(code).toContain('pg_get_constraintdef');
    expect(code).not.toMatch(/CHECK \(purpose IN \('CONTACT'/);
    expect(code).not.toMatch(/purpose NOT IN \('SHARE_WITH_LENDER'/);
    // It refuses, changing nothing, when it does not find exactly one CHECK of each kind.
    expect(code.match(/migration 0130 refused: expected exactly one CHECK/g)).toHaveLength(2);
  });

  it('P1-05 TEST-CRP-M130-S8 credit_report has no column that could hold a PAN, a date of birth, a name or a raw report', () => {
    const table = /CREATE TABLE IF NOT EXISTS credit_report \((.*?)\n\);/s.exec(sql)?.[1] ?? '';
    const columns = [
      ...table.matchAll(/^\s{2}([a-z_0-9]+)\s+(?:text|date|smallint|integer|numeric|char|timestamptz)/gm),
    ].map((m) => m[1]!);
    expect(columns.length).toBeGreaterThanOrEqual(20);
    for (const column of columns) expect(column, column).not.toMatch(/pan|birth|dob|name|payload|raw/i);
  });

  it('P1-05 TEST-CRP-M130-S9 the rollback is one transaction, refuses while a report or a BUREAU_PULL consent exists, and removes what 0130 added', () => {
    const rb = stripComments(rollback);
    expect(rb).toMatch(/^BEGIN;/m);
    expect(rb).toMatch(/^COMMIT;/m);
    expect(rb).toMatch(/rollback refused: % credit_report row\(s\) exist/);
    expect(rb).toMatch(/rollback refused: % BUREAU_PULL consent record\(s\) exist/);
    expect(rb).toContain('DROP TABLE IF EXISTS app.credit_report;');
    expect(rb).toMatch(/DELETE FROM app\.role_permission/);
    expect(rb).toMatch(/DELETE FROM app\.permission/);
  });

  it('P1-05 TEST-CRP-M130-S10 the verify script reads the catalogue only: no write statement', () => {
    const v = stripComments(verify).replace(/'[^']*'/g, "''");
    expect(v).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\b/i);
  });
});
