import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Rehearsal for migration 0141 (P2-01 commission slabs). Static, like rehearsal-0085.spec.ts, so it runs in `npm test`
 * without Docker; the live apply on a throwaway Postgres is migration-0141.int.spec.ts.
 *
 * What this guards: that the migration, its verify script and its rollback script stay in step. The expensive mistakes
 * here are a table created but never covered by RLS, a rollback that forgets a column, and a rollback that undoes
 * migration 0085's grants instead of 0141's.
 */
describe('Rehearsal for migration 0141: commission slabs, plan tax treatment, invoice numbering', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const migrationSql = readFileSync(
    path.join(root, 'supabase/migrations/20261001000141_commission_slabs.sql'),
    'utf8',
  );
  const verifySql = readFileSync(path.join(root, 'tools/sql/0141/verify.sql'), 'utf8');
  const rollbackSql = readFileSync(path.join(root, 'tools/sql/0141/rollback.sql'), 'utf8');

  const NEW_TABLES = ['commission_plan_slab', 'invoice_number_series'] as const;
  const NEW_COLUMNS = [
    ['commission_calculation', 'slab_id'],
    ['commission_calculation', 'product_category'],
    ['commission_plan', 'tax_treatment'],
    ['commission_plan', 'gst_rate_bps'],
    ['commission_plan', 'tds_rate_bps'],
    ['invoice', 'period_month'],
  ] as const;

  it('TEST-MIG-0141-01 creates both new tables idempotently and puts RLS on each', () => {
    for (const table of NEW_TABLES) {
      expect(migrationSql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      // RLS is applied through the guarded loop below, not a bare CALL, so assert the table is named in it.
      expect(migrationSql).toContain(`'${table}'`);
      expect(verifySql).toContain(table);
    }
  });

  it('TEST-MIG-0141-11 the RLS call is guarded, so re-running the migration does not fail on the policy', () => {
    // enable_tenant_rls does a bare CREATE POLICY; calling it twice aborts the whole transaction (see M-110).
    expect(migrationSql).not.toMatch(/^CALL enable_tenant_rls/m);
    expect(migrationSql).toContain('FROM pg_policies');
    expect(migrationSql).toContain("policyname = 'tenant_isolation'");
  });

  it('TEST-MIG-0141-02 adds every new column with ADD COLUMN IF NOT EXISTS (plan section 12.3)', () => {
    for (const [table, column] of NEW_COLUMNS) {
      expect(migrationSql).toMatch(
        new RegExp(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column}\\b`),
      );
    }
  });

  it('TEST-MIG-0141-03 grants dsa_app read and write but never DELETE', () => {
    expect(migrationSql).toContain('GRANT SELECT, INSERT, UPDATE ON commission_plan_slab, invoice_number_series');
    expect(migrationSql).not.toMatch(/GRANT[^;]*DELETE/);
  });

  it('TEST-MIG-0141-04 a slab carries a rate in basis points or a flat amount, never both or neither', () => {
    expect(migrationSql).toContain('CONSTRAINT commission_plan_slab_one_rate');
    expect(migrationSql).toContain('CHECK ((rate_bps IS NULL) <> (flat_amount IS NULL))');
  });

  it('TEST-MIG-0141-05 SOD-02: the maker role gains no approval code', () => {
    for (const code of [
      'commission.plan.approve',
      'payout.approve',
      'payout.disburse',
      'payout.record_payment',
    ]) {
      expect(migrationSql).not.toContain(`('ROLE-FINANCE-EXEC', '${code}')`);
    }
    expect(migrationSql).toContain("('ROLE-FINANCE-EXEC', 'commission.calculate')");
    expect(migrationSql).toContain('ON CONFLICT (role_id, permission_code) DO NOTHING');
    expect(verifySql).toContain('ROLE-FINANCE-EXEC holds no approval code');
  });

  it('TEST-MIG-0141-06 leaves invoice.number without a CHECK so hand-entered numbers stay readable', () => {
    // CGST Rule 46(b) is enforced on the generated series, not retroactively on invoices already recorded by hand.
    expect(migrationSql).not.toMatch(/ALTER TABLE invoice[^;]*CHECK[^;]*number/);
    expect(migrationSql).toContain("series_prefix ~ '^[A-Z]{2,4}$'");
    expect(migrationSql).toContain("fy_label ~ '^[0-9]{2}-[0-9]{2}$'");
  });

  it('TEST-MIG-0141-07 the rollback reverses every object the migration creates', () => {
    for (const table of NEW_TABLES) {
      expect(rollbackSql).toContain(`DROP TABLE IF EXISTS app.${table};`);
    }
    for (const [table, column] of NEW_COLUMNS) {
      expect(rollbackSql).toContain(`ALTER TABLE app.${table} DROP COLUMN IF EXISTS ${column};`);
    }
    expect(rollbackSql).toContain('DROP INDEX IF EXISTS app.invoice_lender_period_uniq;');
    expect(rollbackSql).toContain('DROP INDEX IF EXISTS app.commission_calculation_volume_idx;');
    expect(rollbackSql).toMatch(/^BEGIN;$/m);
    expect(rollbackSql).toMatch(/^COMMIT;$/m);
  });

  it('TEST-MIG-0141-08 the rollback drops the index before the column it indexes', () => {
    expect(rollbackSql.indexOf('DROP INDEX IF EXISTS app.invoice_lender_period_uniq')).toBeLessThan(
      rollbackSql.indexOf('DROP COLUMN IF EXISTS period_month'),
    );
  });

  it('TEST-MIG-0141-09 the rollback leaves migration 0085 grants for qloax-dsa alone', () => {
    // 0085 granted these to ROLE-FINANCE-EXEC for tenant qloax-dsa. Rolling back 0141 must not undo 0085.
    expect(rollbackSql).toContain("t.slug <> 'qloax-dsa'");
  });

  it('TEST-MIG-0141-10 tax treatment defaults to forward charge and is constrained to the two known values', () => {
    expect(migrationSql).toContain("tax_treatment text NOT NULL DEFAULT 'FORWARD_CHARGE'");
    expect(migrationSql).toContain("CHECK (tax_treatment IN ('FORWARD_CHARGE','RCM_RECIPIENT_PAYS'))");
    expect(migrationSql).toContain('gst_rate_bps integer NOT NULL DEFAULT 1800');
    expect(migrationSql).toContain('tds_rate_bps integer NOT NULL DEFAULT 200');
  });
});
