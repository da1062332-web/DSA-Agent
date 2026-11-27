// TEST-VER-M138: rehearsal for migration 0138 (the verification table accepts the check type BANK_ACCOUNT, task P1-06). The database is built from
// the migrations before 0138; then the verify script FAILs on the new value, 0138 is applied (a second run changes nothing), the verify script
// passes, and the rollback script restores the earlier list while no BANK_ACCOUNT record exists and refuses once one does. Synthetic data only.
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IsolationEnv } from '../../../tests/isolation/harness';

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const BATCH = path.join(ROOT, 'tools/sql/batch');
const M138 = readdirSync(MIGRATIONS).find((f) => f.startsWith('20261001000138_'))!;
const sql = (name: string) => readFileSync(name, 'utf8');

const EARLIER_TYPES = [
  'PAN',
  'GST',
  'CIN',
  'ITR',
  'BANK_STATEMENT',
  'BUREAU',
  'IDENTITY_DOCUMENT',
  'EMPLOYMENT',
  'ADDRESS',
];

type Row = { check: string; result: string; detail: string };
let env: IsolationEnv;
let tmp = '';

const exec = async (text: string, params?: unknown[]) => {
  const result = await env.admin.query(text, params);
  return (Array.isArray(result) ? result[result.length - 1] : result) as { rows: Record<string, unknown>[] };
};
const verify = async () => (await exec(sql(path.join(BATCH, '138.verify.sql')))).rows as Row[];
const failures = (rows: Row[]) => rows.filter((r) => r.result === 'FAIL');

/** The CHECK on check_type as the database holds it. */
const checkTypeRule = async () =>
  (
    await exec(
      `select k.oid::text as oid, k.conname, pg_get_constraintdef(k.oid) as def
         from pg_constraint k
        where k.conrelid = 'app.verification'::regclass and k.contype = 'c' and pg_get_constraintdef(k.oid) like '%check_type%'`,
    )
  ).rows as { oid: string; conname: string; def: string }[];

const SUBJECT = 'cus_m138';
const CONSENT = 'cnst_m138_0000000000000000';
/** One verification row of the given check type; with `keep` false it is inserted and rolled back, so it proves acceptance and leaves nothing. */
const insertVerification = (id: string, checkType: string, keep: boolean) => {
  const a = env.A;
  const statement = `insert into app.verification (id, tenant_id, subject_type, subject_id, check_type, method, purpose, consent_record_id, result,
                       minimal_result, evidence_ref, performed_by)
                     values ('${id}', '${a.tenantId}', 'CUSTOMER', '${SUBJECT}', '${checkType}', 'MANUAL', 'KYC', '${CONSENT}', 'VERIFIED',
                       '{"statusDescription":"Synthetic"}'::jsonb, 'manual:m138', '${a.userIds[0]}')`;
  return exec(keep ? statement : `begin; ${statement}; rollback;`);
};

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'dsa-pre0138-'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql') && x < '20261001000138')) {
    copyFileSync(path.join(MIGRATIONS, f), path.join(tmp, f));
  }
  process.env.DSA_MIGRATIONS_DIR = tmp;
  const { startIsolationEnv } = await import('../../../tests/isolation/harness');
  env = await startIsolationEnv();
  const a = env.A;
  await exec(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ('${SUBJECT}', '${a.tenantId}', 'INDIVIDUAL', 'Synthetic Person', '${a.branchId}', 'iso', 'iso')`,
  );
  await exec(
    `insert into app.consent_record (id, tenant_id, subject_type, subject_id, purpose, purpose_target, notice_version, channel, captured_by, captured_at)
     values ('${CONSENT}', '${a.tenantId}', 'CUSTOMER', '${SUBJECT}', 'VERIFICATION_CHECK', 'KARZA', 'V1', 'IN_PERSON', '${a.userIds[0]}', now())`,
  );
}, 240_000);

afterAll(async () => {
  await env?.stop();
  delete process.env.DSA_MIGRATIONS_DIR;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('TEST-VER-M138 migration 0138 rehearsal', () => {
  it('TEST-VER-M138-01 before the apply: one CHECK named verification_check_type_check lists the nine types, BANK_ACCOUNT is refused, and only that verify row FAILs', async () => {
    const rule = await checkTypeRule();
    expect(rule).toHaveLength(1);
    expect(rule[0]?.conname).toBe('verification_check_type_check');
    for (const type of EARLIER_TYPES) expect(rule[0]?.def, type).toContain(`'${type}'`);
    expect(rule[0]?.def).not.toContain('BANK_ACCOUNT');

    await expect(insertVerification('ver_m138_before', 'BANK_ACCOUNT', true)).rejects.toThrow(
      /verification_check_type_check/,
    );
    const failed = failures(await verify());
    expect(failed.map((r) => r.check)).toEqual(['the check_type CHECK accepts BANK_ACCOUNT']);
  });

  it('TEST-VER-M138-02 applying 0138 leaves every verify row PASS, keeps the constraint name, and a second run changes nothing', async () => {
    await exec(sql(path.join(MIGRATIONS, M138)));
    const rows = await verify();
    expect(failures(rows), JSON.stringify(failures(rows))).toEqual([]);

    const first = await checkTypeRule();
    expect(first).toHaveLength(1);
    expect(first[0]?.conname).toBe('verification_check_type_check');
    expect(first[0]?.def).toContain("'BANK_ACCOUNT'");
    // The list was read from the constraint and extended: the nine earlier values are all there, in their order, with the new one last.
    const listed = [...(first[0]?.def ?? '').matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(listed).toEqual([...EARLIER_TYPES, 'BANK_ACCOUNT']);

    // Idempotent: the second run neither fails nor replaces the constraint (the same oid, the same definition).
    await exec(sql(path.join(MIGRATIONS, M138)));
    const second = await checkTypeRule();
    expect(second).toEqual(first);
    const again = await verify();
    expect(failures(again), JSON.stringify(failures(again))).toEqual([]);
  });

  it('TEST-VER-M138-03 after the apply BANK_ACCOUNT is accepted, every earlier type still is, anything else is refused, and the table is still append-only', async () => {
    await insertVerification('ver_m138_probe_bank', 'BANK_ACCOUNT', false);
    for (const type of EARLIER_TYPES) await insertVerification(`ver_m138_probe_${type}`, type, false);
    await expect(insertVerification('ver_m138_probe_bad', 'BANK_STATEMENTS', true)).rejects.toThrow(
      /verification_check_type_check/,
    );
    await exec('rollback').catch(() => undefined);

    // Nothing was kept by the probes above.
    const kept = await exec(
      `select count(*)::int as n from app.verification where id like 'ver_m138_probe%'`,
    );
    expect(kept.rows[0]!.n).toBe(0);
  });

  it('TEST-VER-M138-04 the rollback restores the nine-type list while no BANK_ACCOUNT record exists, and 0138 applies again afterwards', async () => {
    await exec(sql(path.join(BATCH, '138.rollback.sql')));
    const rule = await checkTypeRule();
    expect(rule).toHaveLength(1);
    expect(rule[0]?.conname).toBe('verification_check_type_check');
    expect([...rule[0]!.def.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1])).toEqual(EARLIER_TYPES);
    await expect(insertVerification('ver_m138_after_rollback', 'BANK_ACCOUNT', true)).rejects.toThrow(
      /verification_check_type_check/,
    );
    expect(failures(await verify()).map((r) => r.check)).toEqual([
      'the check_type CHECK accepts BANK_ACCOUNT',
    ]);

    // A second rollback has nothing to do; applying 0138 again brings the value back.
    await exec(sql(path.join(BATCH, '138.rollback.sql')));
    await exec(sql(path.join(MIGRATIONS, M138)));
    expect(failures(await verify())).toEqual([]);
  });

  it('TEST-VER-M138-05 the rollback is refused while a BANK_ACCOUNT record exists, and then changes nothing', async () => {
    await insertVerification('ver_m138_kept', 'BANK_ACCOUNT', true);
    const before = await checkTypeRule();

    await expect(exec(sql(path.join(BATCH, '138.rollback.sql')))).rejects.toThrow(/rollback refused/);
    await exec('rollback').catch(() => undefined);

    expect(await checkTypeRule()).toEqual(before);
    expect(failures(await verify())).toEqual([]);
    // The record cannot be removed to get around the refusal: the table is append-only.
    await expect(exec(`delete from app.verification where id = 'ver_m138_kept'`)).rejects.toThrow();
    await expect(
      exec(`update app.verification set result = 'REJECTED' where id = 'ver_m138_kept'`),
    ).rejects.toThrow();
  });
});
