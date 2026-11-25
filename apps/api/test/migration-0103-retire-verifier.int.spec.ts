// TEST-ACL-M103: rehearsal for migration 0103 (ROLE-VERIFIER retired), with its verify and rollback scripts. A database is built from the
// migrations before 0103, and the verifier roles are written as M-047 left them: tenant A's ROLE-VERIFIER is held by one user (open) and
// once held by another (ended); tenant B's was never assigned. Then: apply, verify, check who holds what, apply again, roll back.
// Local container only. The real migrations folder is not changed: the rehearsal copies the earlier ones into a temporary folder.
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IsolationEnv } from '../../../tests/isolation/harness';

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const BATCH = path.join(ROOT, 'tools/sql/batch');
const M103 = readdirSync(MIGRATIONS).find((f) => f.startsWith('20261001000103_'))!;
const sql = (name: string) => readFileSync(name, 'utf8');
const PERMS = [
  'application.read',
  'document.review',
  'verification.read',
  'verification.perform',
  'verification.create',
  'verification.update',
  'verification.complete',
];

type Row = { check: string; result: string; detail: string };
let env: IsolationEnv;
let tmp = '';
let A = '';
let B = '';
let holder = '';
let former = '';

const exec = async (text: string) => {
  const result = await env.admin.query(text);
  return (Array.isArray(result) ? result[result.length - 1] : result) as { rows: Record<string, unknown>[] };
};
const verify = async () => (await exec(sql(path.join(BATCH, '103.verify.sql')))).rows as Row[];
const failures = (rows: Row[]) => rows.filter((r) => r.result === 'FAIL');
const openRoles = async (userId: string) =>
  (
    await exec(`select r.code, a.scope_type from app.user_role_assignment a join app.role r on r.tenant_id = a.tenant_id and r.id = a.role_id
                 where a.user_id = '${userId}' and not isempty(a.effective_range) and upper_inf(a.effective_range) order by r.code`)
  ).rows;

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'dsa-pre0103-'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql') && x < '20261001000103')) {
    copyFileSync(path.join(MIGRATIONS, f), path.join(tmp, f));
  }
  process.env.DSA_MIGRATIONS_DIR = tmp;
  // Imported after the variable is set: the harness reads it when it loads.
  const { startIsolationEnv } = await import('../../../tests/isolation/harness');
  env = await startIsolationEnv();
  A = env.A.tenantId;
  B = env.B.tenantId;
  [holder, former] = env.A.userIds;

  // The roles as M-047 made them (its ids), each with the same seven permissions.
  const grants = (t: string, role: string) => PERMS.map((p) => `('${t}', '${role}', '${p}')`).join(', ');
  await exec(`
    INSERT INTO app.role (id, tenant_id, code, name, is_template, created_by) VALUES
      ('rol_doc_verifier_${A}', '${A}', 'ROLE-DOC-VERIFIER', 'Document verifier', false, 'iso'),
      ('rol_verifier_${A}', '${A}', 'ROLE-VERIFIER', 'Verification Specialist', false, 'iso'),
      ('rol_doc_verifier_${B}', '${B}', 'ROLE-DOC-VERIFIER', 'Document verifier', false, 'iso'),
      ('rol_verifier_${B}', '${B}', 'ROLE-VERIFIER', 'Verification Specialist', false, 'iso');
    INSERT INTO app.role_permission (tenant_id, role_id, permission_code) VALUES
      ${grants(A, `rol_doc_verifier_${A}`)}, ${grants(A, `rol_verifier_${A}`)},
      ${grants(B, `rol_doc_verifier_${B}`)}, ${grants(B, `rol_verifier_${B}`)};
    INSERT INTO app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by, effective_range) VALUES
      ('ura_m103_open', '${A}', '${holder}', 'rol_verifier_${A}', 'BRANCH', ARRAY['${env.A.branchId}'], 'iso',
        tstzrange(now() - interval '30 days', NULL, '[)')),
      ('ura_m103_ended', '${A}', '${former}', 'rol_verifier_${A}', 'TENANT', '{}', 'iso',
        tstzrange(now() - interval '60 days', now() - interval '40 days', '[)'));`);
});

afterAll(async () => {
  await env?.stop();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('TEST-ACL-M103 migration 0103 retires ROLE-VERIFIER', () => {
  it('TEST-ACL-M103-01 the verify script fails before the apply (the role still holds permissions and an open assignment)', async () => {
    const failed = failures(await verify()).map((r) => r.check);
    expect(failed).toContain('no ROLE-VERIFIER role holds a permission');
    expect(failed).toContain('no open ROLE-VERIFIER assignment');
  });

  it('TEST-ACL-M103-02 applies, and its verify passes', async () => {
    await exec(sql(path.join(MIGRATIONS, M103)));
    expect(failures(await verify())).toEqual([]);
  });

  it('TEST-ACL-M103-03 the open holder now holds ROLE-DOC-VERIFIER with the same branch scope, and nothing else changed for them', async () => {
    expect(await openRoles(holder)).toEqual([{ code: 'ROLE-DOC-VERIFIER', scope_type: 'BRANCH' }]);
    const { rows } = await exec(
      `select scope_branch_ids from app.user_role_assignment where created_by = 'SYSTEM:migration-0103'`,
    );
    expect(rows).toEqual([{ scope_branch_ids: [env.A.branchId] }]);
  });

  it('TEST-ACL-M103-04 a user whose assignment had already ended gets nothing new', async () => {
    expect(await openRoles(former)).toEqual([]);
  });

  it('TEST-ACL-M103-05 the assigned role is kept as history, empty and marked retired; the never-assigned one is deleted', async () => {
    const { rows } = await exec(
      `select tenant_id, name from app.role where code = 'ROLE-VERIFIER' order by tenant_id`,
    );
    expect(rows).toEqual([{ tenant_id: A, name: 'Verification specialist (retired)' }]);
    const perms = await exec(
      `select count(*)::int as n from app.role_permission rp join app.role r on r.id = rp.role_id where r.code = 'ROLE-VERIFIER'`,
    );
    expect(perms.rows[0]!.n).toBe(0);
    const ended = await exec(
      `select upper_inf(effective_range) as open from app.user_role_assignment where id = 'ura_m103_open'`,
    );
    expect(ended.rows[0]!.open).toBe(false);
  });

  it('TEST-ACL-M103-06 ROLE-DOC-VERIFIER keeps its seven permissions in both tenants', async () => {
    const { rows } = await exec(
      `select r.tenant_id, count(*)::int as n from app.role_permission rp join app.role r on r.id = rp.role_id
        where r.code = 'ROLE-DOC-VERIFIER' group by r.tenant_id order by r.tenant_id`,
    );
    expect(rows).toEqual([
      { tenant_id: A, n: 7 },
      { tenant_id: B, n: 7 },
    ]);
  });

  it('TEST-ACL-M103-07 applying again changes nothing', async () => {
    const before = await exec(`select count(*)::int as n from app.user_role_assignment`);
    await exec(sql(path.join(MIGRATIONS, M103)));
    const after = await exec(`select count(*)::int as n from app.user_role_assignment`);
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    expect(failures(await verify())).toEqual([]);
  });

  it('TEST-ACL-M103-08 the rollback brings the role back in both tenants with its seven permissions', async () => {
    await exec(sql(path.join(BATCH, '103.rollback.sql')));
    const { rows } = await exec(
      `select r.tenant_id, r.name, count(rp.permission_code)::int as n from app.role r
         left join app.role_permission rp on rp.role_id = r.id
        where r.code = 'ROLE-VERIFIER' group by r.tenant_id, r.name order by r.tenant_id`,
    );
    expect(rows).toEqual([
      { tenant_id: A, name: 'Verification Specialist', n: 7 },
      { tenant_id: B, name: 'Verification Specialist', n: 7 },
    ]);
  });
});
