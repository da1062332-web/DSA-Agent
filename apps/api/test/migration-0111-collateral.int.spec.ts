// TEST-APP-M111: rehearsal for migration 0111 (application collateral, task P1-03). The database is built from the migrations before
// 0111; then the verify script FAILs, 0111 is applied (and re-applied: it is idempotent), the verify script passes, the database refuses
// bad rows, and the rollback script refuses while a row exists and restores the pre-0111 state once none does. Synthetic data only.
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IsolationEnv } from '../../../tests/isolation/harness';

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const BATCH = path.join(ROOT, 'tools/sql/batch');
const M111 = readdirSync(MIGRATIONS).find((f) => f.startsWith('20261001000111_'))!;
const sql = (name: string) => readFileSync(name, 'utf8');

type Row = { check: string; result: string; detail: string };
let env: IsolationEnv;
let tmp = '';

const exec = async (text: string) => {
  const result = await env.admin.query(text);
  return (Array.isArray(result) ? result[result.length - 1] : result) as { rows: Record<string, unknown>[] };
};
const verify = async () => (await exec(sql(path.join(BATCH, '111.verify.sql')))).rows as Row[];
const failures = (rows: Row[]) => rows.filter((r) => r.result === 'FAIL');

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'dsa-pre0111-'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql') && x < '20261001000111')) {
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

const insert = (id: string, extra = '', values = '') => `
  insert into app.application_collateral (id, tenant_id, application_id, property_type, address_line1, city, state, pincode,
                                          estimated_market_value_paise, ownership_type, created_by, updated_by${extra})
  values ('${id}', '${env.A.tenantId}', 'app_m111', 'RESIDENTIAL_FLAT', 'Flat 12, Shanti Heights', 'Pune', 'Maharashtra',
          '411045', 500000000, 'FREEHOLD', 'iso', 'iso'${values})`;

describe('TEST-APP-M111 migration 0111 rehearsal', () => {
  it('TEST-APP-M111-01 before the apply every structure row FAILs', async () => {
    const rows = await verify();
    // "No S3-class column" holds trivially while the table is absent; every other row needs the table.
    expect(failures(rows)).toHaveLength(rows.length - 1);
  });

  it('TEST-APP-M111-02 applying 0111 leaves every verify row PASS, and a second run changes nothing', async () => {
    await exec(sql(path.join(MIGRATIONS, M111)));
    const rows = await verify();
    expect(failures(rows), JSON.stringify(failures(rows))).toEqual([]);
    await exec(sql(path.join(MIGRATIONS, M111)));
    const again = await verify();
    expect(failures(again), JSON.stringify(failures(again))).toEqual([]);
  });

  it('TEST-APP-M111-03 the database refuses a zero value, a bad pincode, an unknown type and a half-recorded removal', async () => {
    const a = env.A;
    await exec(`insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
                values ('cust_m111', '${a.tenantId}', 'INDIVIDUAL', 'Synthetic Person', '${a.branchId}', 'iso', 'iso')`);
    await exec(`insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, requested_amount,
                  applicant_type, sales_owner_id, created_by, updated_by)
                values ('app_m111', '${a.tenantId}', '${a.branchId}', 'cust_m111', 'HL', 3750000.00, 'SALARIED', '${a.userIds[0]}',
                        '${a.userIds[0]}', '${a.userIds[0]}')`);
    await exec(insert('acol_m111_ok'));
    const paise = await exec(
      `select estimated_market_value_paise::text as p from app.application_collateral where id = 'acol_m111_ok'`,
    );
    expect(paise.rows[0]!.p).toBe('500000000');
    await expect(exec(insert('acol_m111_zero').replace('500000000', '0'))).rejects.toThrow();
    await expect(exec(insert('acol_m111_pin').replace("'411045'", "'011045'"))).rejects.toThrow();
    await expect(
      exec(insert('acol_m111_type').replace("'RESIDENTIAL_FLAT'", "'AGRICULTURAL'")),
    ).rejects.toThrow();
    await expect(exec(insert('acol_m111_rm', ', removed_at', ', now()'))).rejects.toThrow(
      /application_collateral_removed_check/,
    );
    // The application must exist in the same tenant (composite foreign key).
    await expect(exec(insert('acol_m111_fk').replace("'app_m111'", "'app_missing'"))).rejects.toThrow();
  });

  it('TEST-APP-M111-04 the rollback refuses while a row exists, and restores the pre-0111 state once none does', async () => {
    await expect(exec(sql(path.join(BATCH, '111.rollback.sql')))).rejects.toThrow(/Rollback 0111 refused/);
    await exec(`rollback`).catch(() => undefined);
    await exec(`delete from app.application_collateral`);
    await exec(sql(path.join(BATCH, '111.rollback.sql')));
    const left = await exec(`select to_regclass('app.application_collateral')::text as t`);
    expect(left.rows[0]!.t).toBeNull();
    expect(failures(await verify()).length).toBeGreaterThan(0);
  });
});
