// Migration 20261001000094 (MOD-ELG) against a real database (owner: Dev 3). The batch verify script passes after the migration; the
// rollback refuses, and changes nothing, while a tenant has its own setting of the credit-entry flag; with nothing to lose the
// rollback removes the new objects, and the migration applies again cleanly. Synthetic data only.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

let env: IsolationEnv;
beforeAll(async () => {
  env = await startIsolationEnv();
}, 180_000);
afterAll(async () => {
  await env?.stop();
});

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const MIGRATION = read('supabase/migrations/20261001000094_eligibility_inputs_and_provenance.sql');
const VERIFY = read('tools/sql/batch/94.verify.sql');
const ROLLBACK = read('tools/sql/batch/94.rollback.sql');
const PREREQ = read('tools/sql/batch/94.prereq.sql');

/** The rows of the verify script. A multi-statement file returns one result per statement; the checks are the last one. */
async function verify(): Promise<{ check: string; result: string }[]> {
  const out = await env.admin.query(VERIFY);
  const last = Array.isArray(out) ? out[out.length - 1]! : out;
  return last.rows.map((r: { check: string; result: string }) => ({ check: r.check, result: r.result }));
}

describe('TEST-ELG-MIG migration 0094 against the database', () => {
  it('TEST-ELG-MIG-001 after the migration every verify row is PASS', async () => {
    const rows = await verify();
    expect(rows.length).toBeGreaterThanOrEqual(7);
    expect(rows.filter((r) => r.result !== 'PASS')).toEqual([]);
  });

  it('TEST-ELG-MIG-002 the rollback refuses while a tenant has its own setting of the flag, and changes nothing', async () => {
    await env.admin.query(
      `insert into app.tenant_feature_flag (tenant_id, key, value, updated_by)
       values ($1, 'eligibility.manual_credit_entry', false, 'test')`,
      [env.A.tenantId],
    );
    await expect(env.admin.query(ROLLBACK)).rejects.toThrow(/own setting/);
    // The failed transaction is still open on this connection until it is rolled back.
    await env.admin.query('ROLLBACK');
    const still = await env.admin.query(`select to_regclass('app.applicant_financial_input')::text as t`);
    expect(still.rows[0].t).toBe('applicant_financial_input');
    await env.admin.query(
      `delete from app.tenant_feature_flag where tenant_id = $1 and key = 'eligibility.manual_credit_entry'`,
      [env.A.tenantId],
    );
  });

  it('TEST-ELG-MIG-003 with nothing to lose the rollback removes the new objects, and the migration applies again cleanly', async () => {
    await env.admin.query(ROLLBACK);
    const gone = await env.admin.query(
      `select to_regclass('app.applicant_financial_input')::text as t,
              (select count(*)::int from information_schema.columns
                where table_schema = 'app' and table_name = 'eligibility_assessment' and column_name = 'input_hash') as n,
              (select count(*)::int from app.feature_flag where key = 'eligibility.manual_credit_entry') as f`,
    );
    expect(gone.rows[0]).toEqual({ t: null, n: 0, f: 0 });

    // Before the migration is applied again, the prerequisites hold and the new objects are absent: what the operator checks first.
    const out = await env.admin.query(PREREQ);
    const pre = (Array.isArray(out) ? out[out.length - 1]! : out).rows as { check: string; result: string }[];
    expect(pre.length).toBeGreaterThanOrEqual(20);
    expect(pre.filter((r) => r.result === 'FAIL')).toEqual([]);

    await env.admin.query(MIGRATION);
    const rows = await verify();
    expect(rows.filter((r) => r.result !== 'PASS')).toEqual([]);
  });
});
