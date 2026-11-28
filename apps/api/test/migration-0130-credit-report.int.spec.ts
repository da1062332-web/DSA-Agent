// TEST-CRP-M130: rehearsal for migration 0130 (credit-bureau soft pull, task P1-05). The database is built from the migrations before 0130, with
// the four roles present in tenant A. Then: the verify script FAILs; 0130 is applied (a second run changes nothing); the verify script
// passes; BUREAU_PULL is accepted by consent_record with a purpose target and refused without one, and every earlier purpose still works;
// credit_report refuses a half summary and cannot be updated or deleted; the rollback restores the state before 0130 while no report and no
// BUREAU_PULL consent exists, 0130 applies again, and the rollback is refused once either exists. Synthetic data only.
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IsolationEnv } from '../../../tests/isolation/harness';

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const BATCH = path.join(ROOT, 'tools/sql/batch');
const M130 = readdirSync(MIGRATIONS).find((f) => f.startsWith('20261001000130_'))!;
const sql = (name: string) => readFileSync(name, 'utf8');

const EARLIER_PURPOSES = [
  'CONTACT',
  'LOAN_PROCESSING',
  'SHARE_WITH_LENDER',
  'VERIFICATION_CHECK',
  'MARKETING',
];

type Row = { check: string; result: string; detail: string };
let env: IsolationEnv;
let tmp = '';
let A = '';
let USER = '';
let BRANCH = '';

const exec = async (text: string, params?: unknown[]) => {
  const result = await env.admin.query(text, params);
  return (Array.isArray(result) ? result[result.length - 1] : result) as { rows: Record<string, unknown>[] };
};
const verify = async () => (await exec(sql(path.join(BATCH, '130.verify.sql')))).rows as Row[];
const failures = (rows: Row[]) => rows.filter((r) => r.result === 'FAIL');
const failedChecks = async () => failures(await verify()).map((r) => r.check);

/** The two consent_record CHECKs as the database holds them, found by what they say (as the migration finds them). */
const consentRules = async () => {
  const rows = (
    await exec(
      `select k.oid::text as oid, k.conname::text as name, pg_get_constraintdef(k.oid) as def
         from pg_constraint k where k.conrelid = 'app.consent_record'::regclass and k.contype = 'c'`,
    )
  ).rows as { oid: string; name: string; def: string }[];
  const list = rows.filter(
    (r) => r.def.includes("'CONTACT'") && r.def.includes("'MARKETING'") && !r.def.includes('purpose_target'),
  );
  const target = rows.filter(
    (r) => r.def.includes('purpose_target IS NOT NULL') && r.def.includes("'VERIFICATION_CHECK'"),
  );
  expect(list).toHaveLength(1);
  expect(target).toHaveLength(1);
  return { list: list[0]!, target: target[0]! };
};
const literals = (def: string) => [...def.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);

const holds = async (role: string, code: string) =>
  (
    await exec(`select count(*)::int as n from app.role_permission rp join app.role r on r.tenant_id = rp.tenant_id and r.id = rp.role_id
                 where r.tenant_id = '${A}' and r.code = '${role}' and rp.permission_code = '${code}'`)
  ).rows[0]!.n as number;

const CUSTOMER = 'cust_m130';
const consentSql = (id: string, purpose: string, target: string | null) =>
  `insert into app.consent_record (id, tenant_id, subject_type, subject_id, purpose, purpose_target, notice_version, channel, captured_by, captured_at)
   values ('${id}', '${A}', 'CUSTOMER', '${CUSTOMER}', '${purpose}', ${target === null ? 'null' : `'${target}'`}, 'V1', 'IN_PERSON', '${USER}', now())`;
/** A statement that is tried and rolled back, so it proves acceptance or refusal and leaves nothing behind. */
const probe = (statement: string) => exec(`begin; ${statement}; rollback;`);
const refused = async (statement: string, pattern: RegExp) => {
  await expect(probe(statement)).rejects.toThrow(pattern);
  await exec('rollback').catch(() => undefined);
};

const reportSql = (id: string, consent: string, bureau: string, outcome: string, summary: string) =>
  `insert into app.credit_report (id, tenant_id, customer_id, consent_record_id, bureau, provider, outcome, report_date, ${summary === 'none' ? '' : 'score, active_accounts, monthly_emi_amount, max_dpd_12m, enquiries_6m, '}pulled_by, pulled_at)
   values ('${id}', '${A}', '${CUSTOMER}', '${consent}', '${bureau}', 'CRIF', '${outcome}', '2026-11-28', ${summary === 'none' ? '' : summary + ', '}'${USER}', now())`;
const SCORED = '742, 3, 18400.00, 0, 1';

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'dsa-pre0130-'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql') && x < '20261001000130')) {
    copyFileSync(path.join(MIGRATIONS, f), path.join(tmp, f));
  }
  process.env.DSA_MIGRATIONS_DIR = tmp;
  const { startIsolationEnv } = await import('../../../tests/isolation/harness');
  env = await startIsolationEnv();
  A = env.A.tenantId;
  USER = env.A.userIds[0]!;
  BRANCH = env.A.branchId;
  await exec(`
    INSERT INTO app.role (id, tenant_id, code, name, is_template, created_by) VALUES
      ('rol_m130_rm_${A}', '${A}', 'ROLE-RM', 'Relationship manager', false, 'iso'),
      ('rol_m130_ops_${A}', '${A}', 'ROLE-LOAN-OPS', 'Loan operations', false, 'iso'),
      ('rol_m130_own_${A}', '${A}', 'ROLE-ORG-OWNER', 'DSA owner', false, 'iso'),
      ('rol_m130_bm_${A}', '${A}', 'ROLE-BRANCH-MGR', 'Branch manager', false, 'iso')
    ON CONFLICT DO NOTHING;
    INSERT INTO app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
    VALUES ('${CUSTOMER}', '${A}', 'INDIVIDUAL', 'Synthetic Person', '${BRANCH}', 'iso', 'iso');
  `);
}, 240_000);

afterAll(async () => {
  await env?.stop();
  delete process.env.DSA_MIGRATIONS_DIR;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

let before: Awaited<ReturnType<typeof consentRules>>;
let after: Awaited<ReturnType<typeof consentRules>>;

describe('TEST-CRP-M130 migration 0130 rehearsal', () => {
  it('TEST-CRP-M130-01 before the apply: no credit_report, five purposes, BUREAU_PULL refused, and the verify rows FAIL', async () => {
    before = await consentRules();
    expect(literals(before.list.def)).toEqual(EARLIER_PURPOSES);
    expect(literals(before.target.def)).toEqual(['SHARE_WITH_LENDER', 'VERIFICATION_CHECK']);
    expect((await exec(`select to_regclass('app.credit_report') as t`)).rows[0]!.t).toBeNull();

    await refused(consentSql('cnst_m130_pre', 'BUREAU_PULL', 'CIBIL'), new RegExp(before.list.name));
    const failed = await failedChecks();
    expect(failed).toContain('credit_report exists');
    expect(failed).toContain(
      'exactly one consent_record CHECK lists the purposes, it is validated, and it accepts BUREAU_PULL',
    );
    expect(failed).toContain('the two credit_report permissions are in the catalogue');
  });

  it('TEST-CRP-M130-02 applying 0130 leaves every verify row PASS; the CHECKs keep their names and every value; a second run changes nothing', async () => {
    await exec(sql(path.join(MIGRATIONS, M130)));
    const rows = await verify();
    expect(failures(rows), JSON.stringify(failures(rows))).toEqual([]);

    after = await consentRules();
    expect(after.list.name).toBe(before.list.name);
    expect(after.target.name).toBe(before.target.name);
    // Read from the constraint and extended, never retyped: the earlier values in their order, the new one last.
    expect(literals(after.list.def)).toEqual([...EARLIER_PURPOSES, 'BUREAU_PULL']);
    expect(literals(after.target.def)).toEqual(['SHARE_WITH_LENDER', 'VERIFICATION_CHECK', 'BUREAU_PULL']);

    // Idempotent: the same constraints (same oid, same definition), the same grants, no error.
    await exec(sql(path.join(MIGRATIONS, M130)));
    expect(await consentRules()).toEqual(after);
    expect(failures(await verify())).toEqual([]);
    expect(await holds('ROLE-LOAN-OPS', 'credit_report.pull')).toBe(1);
  });

  it('TEST-CRP-M130-03 the grants are exactly the six pairs, and the permissions are in the catalogue as M-130', async () => {
    for (const [role, code] of [
      ['ROLE-LOAN-OPS', 'credit_report.pull'],
      ['ROLE-ORG-OWNER', 'credit_report.pull'],
      ['ROLE-LOAN-OPS', 'credit_report.read'],
      ['ROLE-ORG-OWNER', 'credit_report.read'],
      ['ROLE-RM', 'credit_report.read'],
      ['ROLE-BRANCH-MGR', 'credit_report.read'],
    ] as const)
      expect(await holds(role, code), `${role} ${code}`).toBe(1);
    // The RM and the Branch manager cannot pull.
    expect(await holds('ROLE-RM', 'credit_report.pull')).toBe(0);
    expect(await holds('ROLE-BRANCH-MGR', 'credit_report.pull')).toBe(0);
    const total = await exec(
      `select count(*)::int as n from app.role_permission where tenant_id = '${A}' and permission_code in ('credit_report.pull','credit_report.read')`,
    );
    expect(total.rows[0]!.n).toBe(6);
    const catalogue = await exec(
      `select code, introduced_in from app.permission where code like 'credit_report.%' order by code`,
    );
    expect(catalogue.rows).toEqual([
      { code: 'credit_report.pull', introduced_in: 'M-130' },
      { code: 'credit_report.read', introduced_in: 'M-130' },
    ]);
  });

  it('TEST-CRP-M130-04 BUREAU_PULL is accepted with a bureau as the target and refused without one; the five earlier purposes behave as before', async () => {
    await probe(consentSql('cnst_m130_ok1', 'BUREAU_PULL', 'CIBIL'));
    await probe(consentSql('cnst_m130_ok2', 'BUREAU_PULL', 'CRIF'));
    await refused(consentSql('cnst_m130_notarget', 'BUREAU_PULL', null), new RegExp(after.target.name));
    // The earlier rules: a target is required for SHARE_WITH_LENDER and VERIFICATION_CHECK, and for no other earlier purpose.
    await probe(consentSql('cnst_m130_e1', 'CONTACT', null));
    await probe(consentSql('cnst_m130_e2', 'LOAN_PROCESSING', null));
    await probe(consentSql('cnst_m130_e3', 'MARKETING', null));
    await probe(consentSql('cnst_m130_e4', 'SHARE_WITH_LENDER', 'lnd_x'));
    await probe(consentSql('cnst_m130_e5', 'VERIFICATION_CHECK', 'KARZA'));
    await refused(consentSql('cnst_m130_e6', 'SHARE_WITH_LENDER', null), new RegExp(after.target.name));
    await refused(consentSql('cnst_m130_e7', 'VERIFICATION_CHECK', null), new RegExp(after.target.name));
    await refused(consentSql('cnst_m130_bad', 'SOMETHING_ELSE', 'x'), new RegExp(after.list.name));
    const left = await exec(`select count(*)::int as n from app.consent_record where id like 'cnst_m130_%'`);
    expect(left.rows[0]!.n).toBe(0);
  });

  it('TEST-CRP-M130-05 one ACTIVE BUREAU_PULL consent per customer and bureau (the unique index still holds), a second bureau is allowed', async () => {
    await probe(
      `${consentSql('cnst_m130_u1', 'BUREAU_PULL', 'CIBIL')}; ${consentSql('cnst_m130_u2', 'BUREAU_PULL', 'CRIF')}`,
    );
    await refused(
      `${consentSql('cnst_m130_u3', 'BUREAU_PULL', 'CIBIL')}; ${consentSql('cnst_m130_u4', 'BUREAU_PULL', 'CIBIL')}`,
      /consent_record_one_active_uq/,
    );
  });

  it('TEST-CRP-M130-06 the rollback with no report and no BUREAU_PULL consent restores the state before 0130 and removes what it added', async () => {
    await exec(sql(path.join(BATCH, '130.rollback.sql')));

    const restored = await consentRules();
    expect(restored.list.name).toBe(before.list.name);
    expect(restored.target.name).toBe(before.target.name);
    expect(literals(restored.list.def)).toEqual(EARLIER_PURPOSES);
    expect(literals(restored.target.def)).toEqual(['SHARE_WITH_LENDER', 'VERIFICATION_CHECK']);
    expect((await exec(`select to_regclass('app.credit_report') as t`)).rows[0]!.t).toBeNull();
    const left = await exec(
      `select count(*)::int as n from app.permission where code like 'credit_report.%'`,
    );
    expect(left.rows[0]!.n).toBe(0);
    expect(await holds('ROLE-LOAN-OPS', 'credit_report.pull')).toBe(0);
    await refused(consentSql('cnst_m130_after_rb', 'BUREAU_PULL', 'CIBIL'), new RegExp(before.list.name));
    // A second rollback has nothing to do, and the earlier purposes still work.
    await exec(sql(path.join(BATCH, '130.rollback.sql')));
    await probe(consentSql('cnst_m130_after_rb2', 'VERIFICATION_CHECK', 'KARZA'));
    expect(await failedChecks()).toContain('credit_report exists');
  });

  it('TEST-CRP-M130-07 0130 applies again after a rollback', async () => {
    await exec(sql(path.join(MIGRATIONS, M130)));
    expect(failures(await verify())).toEqual([]);
    expect(await holds('ROLE-RM', 'credit_report.read')).toBe(1);
    expect(await consentRules()).toEqual({
      list: expect.objectContaining({ name: before.list.name }),
      target: expect.objectContaining({ name: before.target.name }),
    });
  });

  it('TEST-CRP-M130-08 the rollback is refused while a BUREAU_PULL consent exists (no report yet), and then changes nothing', async () => {
    await exec(consentSql('cnst_m130_cr', 'BUREAU_PULL', 'CIBIL')); // kept: consent records are evidence
    const rulesBefore = await consentRules();

    await expect(exec(sql(path.join(BATCH, '130.rollback.sql')))).rejects.toThrow(
      /rollback refused: 1 BUREAU_PULL consent record/,
    );
    await exec('rollback').catch(() => undefined);

    expect(await consentRules()).toEqual(rulesBefore);
    expect(failures(await verify())).toEqual([]);
    expect(await holds('ROLE-LOAN-OPS', 'credit_report.pull')).toBe(1);
    expect((await exec(`select to_regclass('app.credit_report') as t`)).rows[0]!.t).not.toBeNull();
  });

  it('TEST-CRP-M130-09 credit_report takes a scored report and a report of no history, and refuses a half summary, a score out of range, an unknown bureau and a wrong outcome', async () => {
    await exec(reportSql('crp_m130_kept', 'cnst_m130_cr', 'CIBIL', 'SCORED', SCORED)); // kept: reports are history
    // Tried and rolled back.
    await probe(reportSql('crp_m130_p1', 'cnst_m130_cr', 'CRIF', 'NO_HISTORY', 'none'));
    await probe(reportSql('crp_m130_p2', 'cnst_m130_cr', 'EQUIFAX', 'SCORED', '900, 0, 0.00, 0, 0'));
    await refused(
      reportSql('crp_m130_h1', 'cnst_m130_cr', 'CIBIL', 'SCORED', 'none'),
      /violates check constraint/,
    );
    await refused(
      reportSql('crp_m130_h2', 'cnst_m130_cr', 'CIBIL', 'NO_HISTORY', SCORED),
      /violates check constraint/,
    );
    await refused(
      reportSql('crp_m130_h3', 'cnst_m130_cr', 'CIBIL', 'SCORED', '299, 3, 18400.00, 0, 1'),
      /violates check constraint/,
    );
    await refused(
      reportSql('crp_m130_h4', 'cnst_m130_cr', 'CIBIL', 'SCORED', '901, 3, 18400.00, 0, 1'),
      /violates check constraint/,
    );
    await refused(
      reportSql('crp_m130_h5', 'cnst_m130_cr', 'TRANSUNION', 'SCORED', SCORED),
      /violates check constraint/,
    );
    await refused(
      reportSql('crp_m130_h6', 'cnst_m130_cr', 'CIBIL', 'PARTIAL', SCORED),
      /violates check constraint/,
    );
    await refused(
      reportSql('crp_m130_h7', 'cnst_m130_cr', 'CIBIL', 'SCORED', '742, 3, -1.00, 0, 1'),
      /violates check constraint/,
    );
    await refused(
      reportSql('crp_m130_h8', 'cnst_m130_cr', 'CIBIL', 'SCORED', '742, -1, 18400.00, 0, 1'),
      /violates check constraint/,
    );
    const kept = await exec(`select count(*)::int as n from app.credit_report`);
    expect(kept.rows[0]!.n).toBe(1);
  });

  it('TEST-CRP-M130-10 a report cannot be updated or deleted, not even by the owner of the database', async () => {
    await expect(
      exec(`update app.credit_report set score = 800 where id = 'crp_m130_kept'`),
    ).rejects.toThrow();
    await expect(exec(`delete from app.credit_report where id = 'crp_m130_kept'`)).rejects.toThrow();
    const row = await exec(`select score from app.credit_report where id = 'crp_m130_kept'`);
    expect(row.rows[0]!.score).toBe(742);
  });

  it('TEST-CRP-M130-11 the rollback is refused while a report exists, and then changes nothing', async () => {
    const rulesBefore = await consentRules();

    await expect(exec(sql(path.join(BATCH, '130.rollback.sql')))).rejects.toThrow(
      /rollback refused: 1 credit_report row/,
    );
    await exec('rollback').catch(() => undefined);

    expect(await consentRules()).toEqual(rulesBefore);
    expect((await exec('select count(*)::int as n from app.credit_report')).rows[0]!.n).toBe(1);
    expect(failures(await verify())).toEqual([]);
    expect(await holds('ROLE-LOAN-OPS', 'credit_report.pull')).toBe(1);
  });
});
