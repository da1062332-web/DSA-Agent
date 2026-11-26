// P1-04 TEST-M120: rehearsal for migration 0120 (lender policy grid and multi-lender matching) on a throwaway Postgres (Testcontainers).
// Owner: Dipanshu. Applies every migration before 0120, checks the verify script fails, applies 0120, checks it passes, re-applies
// (idempotent), proves row-level security and the table constraints, then rolls back and re-applies.
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IsolationEnv } from '../../../tests/isolation/harness';

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const BATCH = path.join(ROOT, 'tools/sql/batch');
const M120 = readdirSync(MIGRATIONS).find((f) => f.startsWith('20261001000120_'))!;
const read = (p: string) => readFileSync(p, 'utf8');

type Row = { check: string; result: string; detail: string };
let env: IsolationEnv;
let tmp = '';
let A = '';
let B = '';

const exec = async (text: string) => {
  const result = await env.admin.query(text);
  return (Array.isArray(result) ? result[result.length - 1] : result) as { rows: Record<string, unknown>[] };
};
const verify = async () => (await exec(read(path.join(BATCH, '120.verify.sql')))).rows as Row[];
const failures = (rows: Row[]) => rows.filter((r) => r.result === 'FAIL').map((r) => r.check);
const apply = () => exec(read(path.join(MIGRATIONS, M120)));
const grantCount = async () =>
  Number(
    (
      await exec(`select count(*)::int as n from app.role_permission
                   where permission_code in ('lender_policy.read','lender_policy.manage','lender_match.run')`)
    ).rows[0]!.n,
  );

const ownerApproveCount = `select count(*)::int as n from app.role_permission rp join app.role r on r.id = rp.role_id
                            where r.code = 'ROLE-ORG-OWNER' and rp.permission_code = 'rule.approve'`;

/** A lender, product and product version in tenant `t` (ids suffixed with `t`). */
const catalogue = (t: string) => `
  INSERT INTO app.lender (id, tenant_id, name, lender_type, created_by, updated_by)
  VALUES ('lnd_m120_${t}', '${t}', 'Synthetic Bank ${t}', 'BANK', 'iso', 'iso') ON CONFLICT DO NOTHING;
  INSERT INTO app.loan_product (id, tenant_id, lender_id, name, category, applicant_types, secured, created_by, updated_by)
  VALUES ('lpr_m120_${t}', '${t}', 'lnd_m120_${t}', 'Personal loan', 'PL', ARRAY['SALARIED'], false, 'iso', 'iso')
  ON CONFLICT DO NOTHING;
  INSERT INTO app.loan_product_version (id, tenant_id, product_id, version_no, effective_from, amount_min, amount_max,
                                        tenure_min_months, tenure_max_months, created_by)
  VALUES ('prv_m120_${t}', '${t}', 'lpr_m120_${t}', 1, '2026-01-01', 50000, 2500000, 12, 84, 'iso') ON CONFLICT DO NOTHING;`;

const policyInsert = (
  t: string,
  id: string,
  extra: { status?: string; approvedBy?: string; editors?: string[] } = {},
) => `
  INSERT INTO app.lender_policy (id, tenant_id, lender_id, product_version_id, status, version_no, foir_cap_bps,
                                 rate_min_bps, rate_max_bps, effective_from, editors, approved_by, approved_at,
                                 created_by, updated_by)
  VALUES ('${id}', '${t}', 'lnd_m120_${t}', 'prv_m120_${t}', '${extra.status ?? 'DRAFT'}',
          (select coalesce(max(version_no), 0) + 1 from app.lender_policy where tenant_id = '${t}'), 5000, 1050, 1200,
          '2026-01-01', ARRAY[${(extra.editors ?? ['usr_maker']).map((e) => `'${e}'`).join(',')}]::text[],
          ${extra.approvedBy ? `'${extra.approvedBy}', now()` : 'NULL, NULL'}, 'usr_maker', 'usr_maker')`;

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'dsa-pre0120-'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql') && x < '20261001000120')) {
    copyFileSync(path.join(MIGRATIONS, f), path.join(tmp, f));
  }
  process.env.DSA_MIGRATIONS_DIR = tmp;
  const { startIsolationEnv } = await import('../../../tests/isolation/harness');
  env = await startIsolationEnv();
  A = env.A.tenantId;
  B = env.B.tenantId;
  // The roles the migration grants to, plus one it must not touch, in both tenants.
  const roles = [
    'ROLE-ORG-OWNER',
    'ROLE-POLICY-MGR',
    'ROLE-LOAN-OPS',
    'ROLE-BRANCH-MGR',
    'ROLE-RM',
    'ROLE-SALES-EXEC',
  ];
  for (const t of [A, B])
    for (const code of roles)
      await exec(`INSERT INTO app.role (id, tenant_id, code, name, created_by)
                  VALUES ('rol_m120_${code.toLowerCase()}_${t}', '${t}', '${code}', '${code}', 'iso')
                  ON CONFLICT (tenant_id, code) DO NOTHING`);
  await exec(catalogue(A) + catalogue(B));
});

afterAll(async () => {
  await env?.stop();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('P1-04 TEST-M120 migration 0120 lender policy and match tables', () => {
  it('P1-04 TEST-M120-01 the verify script fails before the apply', async () => {
    const failed = failures(await verify());
    expect(failed).toContain('the three tables exist');
    expect(failed).toContain('the three permissions are in the catalogue');
  });

  it('P1-04 TEST-M120-02 applies, and its verify passes', async () => {
    await apply();
    expect(failures(await verify())).toEqual([]);
    expect(await grantCount()).toBe(22); // 11 pairs × 2 tenants
  });

  it('P1-04 TEST-M120-03 applying again changes nothing (idempotent)', async () => {
    await apply();
    expect(failures(await verify())).toEqual([]);
    expect(await grantCount()).toBe(22);
  });

  it('P1-04 TEST-M120-04 the Telecaller role gets none of the new permissions', async () => {
    const { rows } =
      await exec(`select count(*)::int as n from app.role_permission rp join app.role r on r.id = rp.role_id
                                   where r.code = 'ROLE-SALES-EXEC' and rp.permission_code like 'lender_%'`);
    expect(rows[0]!.n).toBe(0);
  });

  it('P1-04 TEST-M120-04b the DSA owner holds rule.approve in every customer tenant, so it can activate a policy', async () => {
    const { rows } = await exec(ownerApproveCount);
    expect(rows[0]!.n).toBe(2);
  });

  it('P1-04 TEST-M120-05 row-level security: the API role sees only its own tenant, and nothing without a tenant', async () => {
    await exec(policyInsert(A, 'lpo_m120_a') + ';' + policyInsert(B, 'lpo_m120_b'));
    const api = new pg.Client({ connectionString: env.apiDatabaseUrl });
    await api.connect();
    try {
      await api.query('BEGIN');
      await api.query(`SELECT set_config('app.tenant_id', $1, true)`, [A]);
      const seen = await api.query(
        `SELECT id FROM app.lender_policy WHERE id IN ('lpo_m120_a','lpo_m120_b')`,
      );
      expect(seen.rows.map((r) => r.id)).toEqual(['lpo_m120_a']);
      await expect(
        api.query(`INSERT INTO app.lender_match_run (id, tenant_id, application_id, inputs, inputs_hash, evaluated_at,
                     policy_count, eligible_count, created_by)
                   VALUES ('lmr_x', '${B}', 'app_x', '{}', 'sha256:${'0'.repeat(64)}', now(), 0, 0, 'usr_x')`),
      ).rejects.toThrow(/row-level security/);
      await api.query('ROLLBACK');

      await api.query('BEGIN');
      const none = await api.query(`SELECT id FROM app.lender_policy`);
      expect(none.rows).toEqual([]);
      await api.query('ROLLBACK');
    } finally {
      await api.end();
    }
  });

  it('P1-04 TEST-M120-06 the API role can never update or delete match history', async () => {
    const api = new pg.Client({ connectionString: env.apiDatabaseUrl });
    await api.connect();
    try {
      await api.query('BEGIN');
      await api.query(`SELECT set_config('app.tenant_id', $1, true)`, [A]);
      await expect(api.query(`UPDATE app.lender_match_run SET policy_count = 0`)).rejects.toThrow(
        /permission denied/,
      );
      await api.query('ROLLBACK');
      await api.query('BEGIN');
      await expect(api.query(`DELETE FROM app.lender_match_result`)).rejects.toThrow(/permission denied/);
      await api.query('ROLLBACK');
    } finally {
      await api.end();
    }
  });

  it('P1-04 TEST-M120-07 an ACTIVE policy must be approved, by someone who did not edit it (SOD-01)', async () => {
    await expect(exec(policyInsert(A, 'lpo_m120_unapproved', { status: 'ACTIVE' }))).rejects.toThrow(
      /check/i,
    );
    await expect(
      exec(
        policyInsert(A, 'lpo_m120_self', {
          status: 'ACTIVE',
          approvedBy: 'usr_maker',
          editors: ['usr_maker'],
        }),
      ),
    ).rejects.toThrow(/check/i);
    await exec(policyInsert(A, 'lpo_m120_ok', { status: 'ACTIVE', approvedBy: 'usr_checker' }));
  });

  it('P1-04 TEST-M120-08 at most one ACTIVE policy per lender and product version', async () => {
    await expect(
      exec(policyInsert(A, 'lpo_m120_second', { status: 'ACTIVE', approvedBy: 'usr_checker' })),
    ).rejects.toThrow(/lender_policy_one_active_uq/);
  });

  it('P1-04 TEST-M120-09 the rate band and pincode list are checked', async () => {
    await expect(
      exec(`UPDATE app.lender_policy SET rate_min_bps = 1300 WHERE id = 'lpo_m120_a'`),
    ).rejects.toThrow(/check/i);
    await expect(
      exec(`UPDATE app.lender_policy SET serviceable_pincodes = ARRAY['0411'] WHERE id = 'lpo_m120_a'`),
    ).rejects.toThrow(/check/i);
    await exec(
      `UPDATE app.lender_policy SET serviceable_pincodes = ARRAY['411','560034'] WHERE id = 'lpo_m120_a'`,
    );
    const { rows } = await exec(`select lock_version from app.lender_policy where id = 'lpo_m120_a'`);
    expect(rows[0]!.lock_version).toBe(1); // the touch trigger bumps the version
  });

  it('P1-04 TEST-M120-10 the rollback removes the tables and grants, and the migration applies again afterwards', async () => {
    await exec(read(path.join(BATCH, '120.rollback.sql')));
    const failed = failures(await verify());
    expect(failed).toContain('the three tables exist');
    expect(await grantCount()).toBe(0);
    expect((await exec(ownerApproveCount)).rows[0]!.n).toBe(0);
    await apply();
    expect(failures(await verify())).toEqual([]);
  });
});
