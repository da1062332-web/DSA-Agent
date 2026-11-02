// Migration 0098 rehearsal (TEST-MIG-98). The verify script passes on a freshly migrated database, and the rollback refuses while data
// would be lost, then removes exactly the two columns. Runs in a local container only: nothing here touches hosted Supabase.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

let env: IsolationEnv;
const VERIFY = fileURLToPath(new URL('../../../tools/sql/batch/98.verify.sql', import.meta.url));
const ROLLBACK = fileURLToPath(new URL('../../../tools/sql/batch/98.rollback.sql', import.meta.url));

beforeAll(async () => {
  env = await startIsolationEnv();
}, 240_000);

afterAll(async () => {
  await env?.stop();
});

describe('migration 0098 (TEST-MIG-98)', () => {
  it('TEST-MIG-98-01 the verify script reports no FAIL on a freshly migrated database', async () => {
    const res = await env.admin.query(readFileSync(VERIFY, 'utf8'));
    const rows = res.rows as { check: string; result: string; detail: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows.filter((r) => r.result === 'FAIL')).toEqual([]);
  });

  it('TEST-MIG-98-02 the rollback refuses while a dispute carries a category, and leaves the columns in place', async () => {
    await env.admin.query(
      `insert into app.dispute (id, tenant_id, party_type, party_id, subject_type, subject_id, reason, category, created_by, updated_by)
       values ('dsp_mig98', $1, 'CONNECTOR', 'con_mig98', 'STATEMENT_LINE', 'cpay_mig98', 'Rehearsal reason text', 'OTHER', 'iso', 'iso')`,
      [env.A.tenantId],
    );
    await expect(env.admin.query(readFileSync(ROLLBACK, 'utf8'))).rejects.toThrow(/rollback refused/);
    await env.admin.query('ROLLBACK');
    const cols = await env.admin.query(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'app' and (table_name, column_name) in (('dispute', 'category'), ('document_type', 'partner_upload'))`,
    );
    expect(cols.rows.map((r) => `${r.table_name}.${r.column_name}`).sort()).toEqual([
      'dispute.category',
      'document_type.partner_upload',
    ]);
  });

  it('TEST-MIG-98-03 once the decision is recorded and no value remains, the rollback removes exactly the two columns', async () => {
    await env.admin.query(`delete from app.dispute where id = 'dsp_mig98'`);
    await env.admin.query(readFileSync(ROLLBACK, 'utf8'));
    const cols = await env.admin.query(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'app' and (table_name, column_name) in (('dispute', 'category'), ('document_type', 'partner_upload'))`,
    );
    expect(cols.rows).toEqual([]);
    // document_type.category is an existing column of the document type, and is not touched by this rollback.
    const existing = await env.admin.query(
      `select 1 from information_schema.columns where table_schema = 'app' and table_name = 'document_type' and column_name = 'category'`,
    );
    expect(existing.rows.length).toBe(1);
    const rls = await env.admin.query(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app' and c.relname in ('dispute', 'document_type') order by c.relname`,
    );
    expect(rls.rows.every((r) => r.relrowsecurity === true)).toBe(true);
  });
});
