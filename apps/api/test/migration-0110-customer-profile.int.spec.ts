// TEST-CUST-M110: rehearsal for migration 0110 (customer profile, encrypted identity and addresses, task P1-02). The database is built
// from the migrations before 0110; then the verify script FAILs, 0110 is applied (a second run is refused cleanly), the verify script passes, and the
// rollback script restores the state before 0110 while it holds no rows and refuses once a row exists. Synthetic data only.
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IsolationEnv } from '../../../tests/isolation/harness';

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const BATCH = path.join(ROOT, 'tools/sql/batch');
const M110 = readdirSync(MIGRATIONS).find((f) => f.startsWith('20261001000110_'))!;
const sql = (name: string) => readFileSync(name, 'utf8');

type Row = { check: string; result: string; detail: string };
let env: IsolationEnv;
let tmp = '';

const exec = async (text: string) => {
  const result = await env.admin.query(text);
  return (Array.isArray(result) ? result[result.length - 1] : result) as { rows: Record<string, unknown>[] };
};
const verify = async () => (await exec(sql(path.join(BATCH, '110.verify.sql')))).rows as Row[];
const failures = (rows: Row[]) => rows.filter((r) => r.result === 'FAIL');

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'dsa-pre0110-'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql') && x < '20261001000110')) {
    copyFileSync(path.join(MIGRATIONS, f), path.join(tmp, f));
  }
  process.env.DSA_MIGRATIONS_DIR = tmp;
  const { startIsolationEnv } = await import('../../../tests/isolation/harness');
  env = await startIsolationEnv();
}, 240_000);

afterAll(async () => {
  await env?.stop();
  delete process.env.DSA_MIGRATIONS_DIR;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('TEST-CUST-M110 migration 0110 rehearsal', () => {
  it('TEST-CUST-M110-01 before the apply the structure rows FAIL', async () => {
    expect(failures(await verify()).length).toBeGreaterThan(0);
  });

  it('TEST-CUST-M110-02 applying 0110 leaves every verify row PASS; a second run is refused and changes nothing', async () => {
    await exec(sql(path.join(MIGRATIONS, M110)));
    const rows = await verify();
    expect(failures(rows), JSON.stringify(failures(rows))).toEqual([]);
    // 0110 is not re-runnable: enable_tenant_rls creates the tenant_isolation policy unconditionally. The file runs as one implicit
    // transaction, so the second run stops there and rolls back without a partial change (MANIFEST row M-110).
    await expect(exec(sql(path.join(MIGRATIONS, M110)))).rejects.toThrow(/tenant_isolation/);
    const again = await verify();
    expect(failures(again), JSON.stringify(failures(again))).toEqual([]);
  });

  it('TEST-CUST-M110-03 the database refuses a half-stored PAN and an invalid pincode', async () => {
    const a = env.A;
    await exec(`insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
                values ('cust_m110', '${a.tenantId}', 'INDIVIDUAL', 'Synthetic Person', '${a.branchId}', 'iso', 'iso')`);
    await expect(
      exec(`insert into app.customer_identity (tenant_id, customer_id, pan_masked, created_by, updated_by)
            values ('${a.tenantId}', 'cust_m110', 'ABCDE****F', 'iso', 'iso')`),
    ).rejects.toThrow(/customer_identity_pan_complete/);
    await expect(
      exec(`insert into app.customer_address (id, tenant_id, customer_id, address_type, line1, city, state, pincode, created_by, updated_by)
            values ('cad_m110_bad', '${a.tenantId}', 'cust_m110', 'CURRENT', 'Flat 4', 'Pune', 'Maharashtra', '011001', 'iso', 'iso')`),
    ).rejects.toThrow();
  });

  it('TEST-CUST-M110-04 the rollback refuses while rows exist, and restores the pre-0110 state once they are gone', async () => {
    const a = env.A;
    await exec(`insert into app.customer_address (id, tenant_id, customer_id, address_type, line1, city, state, pincode, created_by, updated_by)
                values ('cad_m110_ok', '${a.tenantId}', 'cust_m110', 'CURRENT', 'Flat 4, Shanti Nagar', 'Pune', 'Maharashtra', '411001', 'iso', 'iso')`);
    await expect(exec(sql(path.join(BATCH, '110.rollback.sql')))).rejects.toThrow(/Rollback 0110 refused/);
    await exec(`rollback`).catch(() => undefined);
    await exec(`delete from app.customer_address where id = 'cad_m110_ok'`);
    await exec(sql(path.join(BATCH, '110.rollback.sql')));
    const left =
      await exec(`select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
                              where n.nspname = 'app' and c.relname in ('customer_profile','customer_identity','customer_address')`);
    expect(left.rows[0]!.n).toBe(0);
  });
});
