import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TARGET_ENTITY_TYPES, MIS_DATE_FORMATS } from '@dsa/contracts';

/**
 * Rehearsal for migration 0140 (P1-07 lender MIS import). Static, like rehearsal-0141.spec.ts, so it runs in
 * `npm test` without Docker.
 *
 * What this guards: that the migration, its verify script, its rollback script and the contracts enums stay in step.
 * The expensive mistakes here are a widened CHECK that silently drops a value that was legal before, a table created
 * but never covered by RLS, a rollback that destroys saved mappings without saying so, and a date format the database
 * accepts but the parser has never heard of.
 */
describe('Rehearsal for migration 0140: lender MIS status import', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const migrationSql = readFileSync(
    path.join(root, 'supabase/migrations/20261001000140_lender_mis_import.sql'),
    'utf8',
  );
  const verifySql = readFileSync(path.join(root, 'tools/sql/0140/verify.sql'), 'utf8');
  const rollbackSql = readFileSync(path.join(root, 'tools/sql/0140/rollback.sql'), 'utf8');

  it('TEST-MIG-0140-01 creates lender_mis_mapping, and the verify script checks it exists', () => {
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS lender_mis_mapping');
    expect(verifySql).toContain("to_regclass('app.lender_mis_mapping')");
  });

  it('TEST-MIG-0140-02 widens target_entity to a superset: LEAD and CUSTOMER stay legal', () => {
    // A narrowed constraint would reject rows that were valid before the migration, which is not an additive change.
    expect(migrationSql).toContain(
      "CHECK (target_entity IN ('LEAD', 'CUSTOMER', 'LENDER_CASE_STATUS'))",
    );
    expect(verifySql).toContain('still admits LEAD and CUSTOMER');
  });

  it('TEST-MIG-0140-03 finds the old constraint by what it constrains, not by a guessed name', () => {
    // Migration 0033 declares the CHECK inline, so its name is Postgres's. Dropping a guessed name would either fail
    // or, worse, drop a different constraint that happened to match.
    expect(migrationSql).toContain("pg_get_constraintdef(con.oid) LIKE '%target_entity%'");
    expect(migrationSql).not.toMatch(/DROP CONSTRAINT import_batch_target_entity_check/);
  });

  it('TEST-MIG-0140-04 is re-runnable: a second apply finds the widened constraint and stops', () => {
    expect(migrationSql).toContain("LIKE '%LENDER_CASE_STATUS%'");
    expect(migrationSql).toMatch(/RETURN;\s*--\s*already widened/);
  });

  it('TEST-MIG-0140-05 guards enable_tenant_rls so an interrupted apply can be retried', () => {
    // A bare CALL fails on the second run with "policy tenant_isolation already exists" and rolls the whole
    // migration back, because the apply is one transaction.
    expect(migrationSql).not.toMatch(/^CALL enable_tenant_rls/m);
    expect(migrationSql).toContain("policyname = 'tenant_isolation'");
    expect(migrationSql).toContain("CALL enable_tenant_rls('app.lender_mis_mapping')");
  });

  it('TEST-MIG-0140-06 grants read and write but never DELETE, and verify asserts both', () => {
    expect(migrationSql).toContain('GRANT SELECT, INSERT, UPDATE ON lender_mis_mapping TO dsa_app');
    expect(migrationSql).not.toMatch(/GRANT[^;]*DELETE[^;]*lender_mis_mapping/);
    expect(verifySql).toContain('may NOT delete lender_mis_mapping rows');
  });

  it('TEST-MIG-0140-07 scopes the mapping to one per lender per tenant', () => {
    expect(migrationSql).toContain('UNIQUE (tenant_id, lender_id)');
    expect(verifySql).toContain('one mapping per lender per tenant');
  });

  it('TEST-MIG-0140-08 ties lender_id to the lender table within the same tenant', () => {
    expect(migrationSql).toContain('FOREIGN KEY (tenant_id, lender_id) REFERENCES lender (tenant_id, id)');
  });

  it('TEST-MIG-0140-09 accepts exactly the date formats the contracts declare', () => {
    // A format the column allows but the parser cannot read would be accepted at save time and fail every morning
    // afterwards, on the one call nobody is watching.
    for (const format of MIS_DATE_FORMATS) {
      expect(migrationSql).toContain(`'${format}'`);
    }
    const allowed = migrationSql.match(/CHECK \(date_format IN \(([^)]*)\)\)/)?.[1] ?? '';
    const inSql = [...allowed.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(inSql.sort()).toEqual([...MIS_DATE_FORMATS].sort());
  });

  it('TEST-MIG-0140-10 declares LENDER_CASE_STATUS in contracts as well as in the database', () => {
    expect(TARGET_ENTITY_TYPES).toContain('LENDER_CASE_STATUS');
    expect(TARGET_ENTITY_TYPES).toContain('LEAD');
    expect(TARGET_ENTITY_TYPES).toContain('CUSTOMER');
  });

  it('TEST-MIG-0140-11 rollback drops what the migration made and nothing else', () => {
    expect(rollbackSql).toContain('DROP TABLE IF EXISTS lender_mis_mapping');
    expect(rollbackSql).toContain('DROP TRIGGER IF EXISTS lender_mis_mapping_touch');
    expect(rollbackSql).toContain("CHECK (target_entity IN ('LEAD', 'CUSTOMER'))");
  });

  it('TEST-MIG-0140-12 rollback warns about the mappings it destroys and refuses to orphan batch history', () => {
    expect(rollbackSql).toContain('DATA LOSS');
    expect(rollbackSql).toContain('RAISE EXCEPTION');
    expect(rollbackSql).toContain("target_entity = 'LENDER_CASE_STATUS'");
  });
});
