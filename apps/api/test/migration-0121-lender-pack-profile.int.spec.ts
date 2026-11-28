// P2-04 TEST-M121: rehearsal for migration 0121 (lender pack profile) on a throwaway Postgres (Testcontainers). Owner: Dipanshu.
// Applies every migration before 0121, checks the verify script fails, applies 0121, checks it passes, re-applies (idempotent),
// proves row-level security and the constraints, then rolls back and re-applies.
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IsolationEnv } from '../../../tests/isolation/harness';

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const BATCH = path.join(ROOT, 'tools/sql/batch');
const M121 = readdirSync(MIGRATIONS).find((f) => f.startsWith('20261001000121_'))!;
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
const verify = async () => (await exec(read(path.join(BATCH, '121.verify.sql')))).rows as Row[];
const failures = (rows: Row[]) => rows.filter((r) => r.result === 'FAIL').map((r) => r.check);
const apply = () => exec(read(path.join(MIGRATIONS, M121)));
const lender = (t: string) => `
  INSERT INTO app.lender (id, tenant_id, name, lender_type, created_by, updated_by)
  VALUES ('lnd_m121_${t}', '${t}', 'Synthetic Bank ${t}', 'BANK', 'iso', 'iso') ON CONFLICT DO NOTHING;`;
const profile = (t: string, id: string, extra: { pattern?: string; order?: string } = {}) => `
  INSERT INTO app.lender_pack_profile (id, tenant_id, lender_id, document_order, filename_pattern, created_by, updated_by)
  VALUES ('${id}', '${t}', 'lnd_m121_${t}', '${extra.order ?? '["PAN"]'}'::jsonb, '${extra.pattern ?? '{seq}_{docType}'}', 'iso', 'iso')`;

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'dsa-pre0121-'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql') && x < '20261001000121')) {
    copyFileSync(path.join(MIGRATIONS, f), path.join(tmp, f));
  }
  process.env.DSA_MIGRATIONS_DIR = tmp;
  const { startIsolationEnv } = await import('../../../tests/isolation/harness');
  env = await startIsolationEnv();
  A = env.A.tenantId;
  B = env.B.tenantId;
  await exec(lender(A) + lender(B));
}, 240_000);

afterAll(async () => {
  await env?.stop();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('P2-04 TEST-M121 migration 0121 lender pack profile', () => {
  it('TEST-M121-01 the verify script fails before the apply', async () => {
    expect(failures(await verify())).toContain('lender_pack_profile exists');
  });

  it('TEST-M121-02 applies, its verify passes, and applying again changes nothing', async () => {
    await apply();
    expect(failures(await verify())).toEqual([]);
    await apply();
    expect(failures(await verify())).toEqual([]);
  });

  it('TEST-M121-03 one profile per lender; the pattern must contain {seq}; the order must be an array', async () => {
    await exec(profile(A, 'lpp_m121_a') + ';' + profile(B, 'lpp_m121_b'));
    await expect(exec(profile(A, 'lpp_m121_dup'))).rejects.toThrow(/unique|duplicate/i);
    await expect(exec(profile(A, 'lpp_m121_x', { pattern: '{docType}_file' }))).rejects.toThrow(/check/i);
    await expect(exec(profile(A, 'lpp_m121_y', { order: '{"a":1}' }))).rejects.toThrow(/check/i);
    await exec(
      `UPDATE app.lender_pack_profile SET filename_pattern = '{seq}-{docType}' WHERE id = 'lpp_m121_a'`,
    );
    const { rows } = await exec(`select lock_version from app.lender_pack_profile where id = 'lpp_m121_a'`);
    expect(rows[0]!.lock_version).toBe(1); // the touch trigger bumps the version
  });

  it('TEST-M121-04 row-level security: the API role sees only its own tenant, and nothing without a tenant', async () => {
    const api = new pg.Client({ connectionString: env.apiDatabaseUrl });
    await api.connect();
    try {
      await api.query('BEGIN');
      await api.query(`SELECT set_config('app.tenant_id', $1, true)`, [A]);
      const seen = await api.query(`SELECT id FROM app.lender_pack_profile`);
      expect(seen.rows.map((r) => r.id)).toEqual(['lpp_m121_a']);
      await expect(api.query(`DELETE FROM app.lender_pack_profile`)).rejects.toThrow(/permission denied/);
      await api.query('ROLLBACK');
      await api.query('BEGIN');
      expect((await api.query(`SELECT id FROM app.lender_pack_profile`)).rows).toEqual([]);
      await api.query('ROLLBACK');
    } finally {
      await api.end();
    }
  });

  it('TEST-M121-05 the rollback removes the table, and the migration applies again afterwards', async () => {
    await exec(read(path.join(BATCH, '121.rollback.sql')));
    expect(failures(await verify())).toContain('lender_pack_profile exists');
    await apply();
    expect(failures(await verify())).toEqual([]);
  });
});
