// Upgrade rehearsal for migrations 0100, 0101 and 0102 (TEST-UPG). A database is built from the migrations before 0100, historical data is
// written as it would be then, and the three migrations are applied to it. The data must survive, the new rules must hold, the verify
// scripts must pass, and each rollback must do what it says: refuse when data would be lost, and remove exactly its own objects otherwise.
// Local container only. The real migrations folder is not changed: the rehearsal copies the earlier ones into a temporary folder.
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IsolationEnv } from '../../../tests/isolation/harness';

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const BATCH = path.join(ROOT, 'tools/sql/batch');
const file = (prefix: string) => readdirSync(MIGRATIONS).find((f) => f.startsWith(prefix))!;
const M98 = file('20261001000100_');
const M99 = file('20261001000101_');
const M100 = file('20261001000102_');
const sql = (name: string) => readFileSync(name, 'utf8');
const verifyRows = async (env: IsolationEnv, script: string) =>
  (await env.admin.query(sql(path.join(BATCH, script)))).rows as { check: string; result: string }[];

let env: IsolationEnv;
let tmp = '';
const DISPUTE_LENDER = 'dsp_hist_lender';
const DISPUTE_CONNECTOR = 'dsp_hist_connector';
const CONNECTOR = 'con_upg_1';
const VER_CUSTOMER = 'ver_01JZ000000000000000000000H';

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'dsa-pre0100-'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql') && x < '20261001000100')) {
    copyFileSync(path.join(MIGRATIONS, f), path.join(tmp, f));
  }
  process.env.DSA_MIGRATIONS_DIR = tmp;
  // Imported after the variable is set: the harness reads it when it loads.
  const { startIsolationEnv } = await import('../../../tests/isolation/harness');
  env = await startIsolationEnv();

  // Historical data, as it would be before 0100: an active connector with a connector dispute and a lender dispute, a customer's
  // verification, and an existing document type. None of it has the new columns.
  const a = env.A;
  const q = (text: string, values: unknown[]) => env.admin.query(text, values);
  const hash = (s: string) => Buffer.from(s.padEnd(32, '0').slice(0, 32));
  await q(
    `insert into app.connector (id, tenant_id, connector_type, legal_name, contact_person, mobile_e164, mobile_hash, email, email_hash,
                                encrypted_pan, pan_hash, pan_masked, primary_branch_id, relationship_owner_user_id, status, created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Historical Partner', 'Contact', '+919876507001', $3, 'hist@upg.example.com', $4, $5, $6, 'XXXXX1234X', $7, $8, 'ACTIVE', 'iso', 'iso')`,
    [
      CONNECTOR,
      a.tenantId,
      hash('mh'),
      hash('eh'),
      Buffer.from('synthetic'),
      hash('ph'),
      a.branchId,
      a.userIds[0],
    ],
  );
  await q(
    `insert into app.dispute (id, tenant_id, party_type, party_id, subject_type, subject_id, reason, created_by, updated_by)
     values ($1, $2, 'LENDER', 'lnd_hist', 'STATEMENT_LINE', 'stl_hist_1', 'Historical lender dispute', 'iso', 'iso'),
            ($3, $2, 'CONNECTOR', $4, 'PAYOUT', 'pay_hist_1', 'Historical connector dispute', 'iso', 'iso')`,
    [DISPUTE_LENDER, a.tenantId, DISPUTE_CONNECTOR, CONNECTOR],
  );
  await q(
    `insert into app.document_type (id, tenant_id, code, name, category, created_by, updated_by)
     values ('dtp_hist_pan', $1, 'PAN_CARD', 'PAN card', 'IDENTITY', 'iso', 'iso')`,
    [a.tenantId],
  );
  await q(
    `insert into app.consent_record (id, tenant_id, subject_type, subject_id, purpose, purpose_target, notice_version, channel,
                                     captured_by, captured_at, status)
     values ('cns_upg_1', $1, 'CUSTOMER', 'cust_upg_1', 'VERIFICATION_CHECK', 'pt_upg', 'PORTAL-V1', 'OTP', $2, now(), 'ACTIVE')`,
    [a.tenantId, a.userIds[0]],
  );
  await q(
    `insert into app.verification (id, tenant_id, subject_type, subject_id, check_type, method, purpose, consent_record_id, result,
                                   minimal_result, evidence_ref, performed_by, performed_at)
     values ($1, $2, 'CUSTOMER', 'cust_upg_1', 'PAN', 'MANUAL', 'KYC', 'cns_upg_1', 'VERIFIED', '{}', 'evidence-ref', $3, now())`,
    [VER_CUSTOMER, a.tenantId, a.userIds[0]],
  );
  // The upgrade itself, as the migration runner would apply it.
  for (const f of [M98, M99, M100]) await env.admin.query(sql(path.join(MIGRATIONS, f)));
}, 300_000);

afterAll(async () => {
  await env?.stop();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('upgrade to migrations 0100, 0101 and 0102 (TEST-UPG)', () => {
  it('TEST-UPG-01 the historical records survive the upgrade unchanged', async () => {
    const disputes = await env.admin.query(
      `select id, party_type, reason, status, category from app.dispute where id in ($1, $2) order by id`,
      [DISPUTE_LENDER, DISPUTE_CONNECTOR],
    );
    expect(disputes.rows).toEqual([
      {
        id: DISPUTE_CONNECTOR,
        party_type: 'CONNECTOR',
        reason: 'Historical connector dispute',
        status: 'OPEN',
        category: null,
      },
      {
        id: DISPUTE_LENDER,
        party_type: 'LENDER',
        reason: 'Historical lender dispute',
        status: 'OPEN',
        category: null,
      },
    ]);
    const connector = await env.admin.query(`select status, legal_name from app.connector where id = $1`, [
      CONNECTOR,
    ]);
    expect(connector.rows[0]).toEqual({ status: 'ACTIVE', legal_name: 'Historical Partner' });
    const verification = await env.admin.query(
      `select result, subject_type, connector_id from app.verification where id = $1`,
      [VER_CUSTOMER],
    );
    expect(verification.rows[0]).toEqual({
      result: 'VERIFIED',
      subject_type: 'CUSTOMER',
      connector_id: null,
    });
    const type = await env.admin.query(
      `select name, partner_upload from app.document_type where id = 'dtp_hist_pan'`,
    );
    expect(type.rows[0]).toEqual({ name: 'PAN card', partner_upload: false });
  });

  it('TEST-UPG-02 the new rules hold: a partner dispute needs a category, a category must be an approved one, and internal disputes do not', async () => {
    const insert = (id: string, party: string, partyId: string, category: string | null) =>
      env.admin.query(
        `insert into app.dispute (id, tenant_id, party_type, party_id, subject_type, subject_id, reason, category, created_by, updated_by)
         values ($1, $2, $3, $4, 'PAYOUT', 'pay_new', 'A new dispute reason', $5, 'iso', 'iso')`,
        [id, env.A.tenantId, party, partyId, category],
      );
    await expect(insert('dsp_new_partner_nocat', 'CONNECTOR', CONNECTOR, null)).rejects.toThrow(
      /dispute_partner_category_required/,
    );
    await expect(insert('dsp_new_partner_badcat', 'CONNECTOR', CONNECTOR, 'REFERRAL_STATUS')).rejects.toThrow(
      /dispute_category_check/,
    );
    await insert('dsp_new_partner_ok', 'CONNECTOR', CONNECTOR, 'PAYOUT');
    await insert('dsp_new_lender_nocat', 'LENDER', 'lnd_new', null);
    // The historical partner dispute, with no category, is untouched by the rule (NOT VALID applies to new rows).
    const historical = await env.admin.query(`select category from app.dispute where id = $1`, [
      DISPUTE_CONNECTOR,
    ]);
    expect(historical.rows[0].category).toBeNull();
  });

  it('TEST-UPG-03 the verify scripts report no FAIL on the upgraded database', async () => {
    for (const script of ['100.verify.sql', '101.verify.sql', '102.verify.sql']) {
      const rows = await verifyRows(env, script);
      expect(rows.length, script).toBeGreaterThan(0);
      expect(
        rows.filter((r) => r.result === 'FAIL'),
        script,
      ).toEqual([]);
    }
  });

  it('TEST-UPG-04 the verification record stays append-only: it cannot be changed or removed', async () => {
    await expect(
      env.admin.query(`update app.verification set notes = 'changed' where id = $1`, [VER_CUSTOMER]),
    ).rejects.toThrow();
    await expect(
      env.admin.query(`delete from app.verification where id = $1`, [VER_CUSTOMER]),
    ).rejects.toThrow();
  });

  it('TEST-UPG-05 applying the three migrations again changes nothing and fails nothing', async () => {
    const before = await env.admin.query(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint
        where conname in ('verification_subject_type_check', 'verification_connector_subject_check', 'verification_connector_fk',
                          'dispute_category_check', 'dispute_partner_category_required') order by conname`,
    );
    for (const f of [M98, M99, M100]) await env.admin.query(sql(path.join(MIGRATIONS, f)));
    const after = await env.admin.query(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint
        where conname in ('verification_subject_type_check', 'verification_connector_subject_check', 'verification_connector_fk',
                          'dispute_category_check', 'dispute_partner_category_required') order by conname`,
    );
    expect(after.rows).toEqual(before.rows);
  });

  it('TEST-UPG-06 the rollback of 0102 removes only its rule, and the rule can be applied again', async () => {
    await env.admin.query(sql(path.join(BATCH, '102.rollback.sql')));
    const gone = await env.admin.query(
      `select 1 from pg_constraint where conname = 'dispute_partner_category_required'`,
    );
    expect(gone.rows.length).toBe(0);
    await env.admin.query(sql(path.join(MIGRATIONS, M100)));
    const back = await env.admin.query(
      `select convalidated from pg_constraint where conname = 'dispute_partner_category_required'`,
    );
    expect(back.rows[0].convalidated).toBe(false);
  });

  it('TEST-UPG-07 the rollback of 0101 removes its own objects when no connector verification exists, and the migration applies again', async () => {
    await env.admin.query(sql(path.join(BATCH, '101.rollback.sql')));
    const cols = await env.admin.query(
      `select 1 from information_schema.columns where table_schema = 'app' and table_name = 'verification' and column_name = 'connector_id'`,
    );
    expect(cols.rows.length).toBe(0);
    await env.admin.query(sql(path.join(MIGRATIONS, M99)));
    expect((await verifyRows(env, '101.verify.sql')).filter((r) => r.result === 'FAIL')).toEqual([]);
  });

  it('TEST-UPG-08 the rollback of 0100 refuses while a dispute carries a category, and removes its columns once none does', async () => {
    await env.admin.query(`update app.dispute set category = 'OTHER' where id = $1`, [DISPUTE_LENDER]);
    await expect(env.admin.query(sql(path.join(BATCH, '100.rollback.sql')))).rejects.toThrow(
      /rollback refused/,
    );
    await env.admin.query('ROLLBACK');
    // Clear the categories the rehearsal set: the internal dispute's category is reset, and the partner dispute this file created is removed.
    // A partner dispute cannot be updated to a NULL category (0102 applies to every row written), so it is removed, not edited.
    await env.admin.query(`update app.dispute set category = null where id = $1`, [DISPUTE_LENDER]);
    await env.admin.query(`delete from app.dispute where id = 'dsp_new_partner_ok'`);
    await env.admin.query(sql(path.join(BATCH, '100.rollback.sql')));
    const cols = await env.admin.query(
      `select table_name from information_schema.columns where table_schema = 'app'
          and (table_name, column_name) in (('dispute', 'category'), ('document_type', 'partner_upload'))`,
    );
    expect(cols.rows).toEqual([]);
    await env.admin.query(sql(path.join(MIGRATIONS, M98)));
    await env.admin.query(sql(path.join(MIGRATIONS, M100)));
    expect((await verifyRows(env, '100.verify.sql')).filter((r) => r.result === 'FAIL')).toEqual([]);
  });

  it('TEST-UPG-09 once a connector verification exists, the rollback of 0101 refuses, and the record and its link stay', async () => {
    const id = 'ver_01JZ0000000000000000000K1';
    await env.admin.query(
      `insert into app.verification (id, tenant_id, subject_type, subject_id, check_type, method, purpose, consent_record_id, result,
                                     minimal_result, evidence_ref, performed_by, performed_at, connector_id)
       values ($1, $2, 'CONNECTOR', $3, 'PAN', 'MANUAL', 'KYC', 'cns_upg_1', 'VERIFIED', '{}', 'evidence-ref', $4, now(), $3)`,
      [id, env.A.tenantId, CONNECTOR, env.A.userIds[0]],
    );
    await expect(env.admin.query(sql(path.join(BATCH, '101.rollback.sql')))).rejects.toThrow(
      /rollback refused/,
    );
    await env.admin.query('ROLLBACK');
    const still = await env.admin.query(`select connector_id from app.verification where id = $1`, [id]);
    expect(still.rows[0].connector_id).toBe(CONNECTOR);
    expect((await verifyRows(env, '101.verify.sql')).filter((r) => r.result === 'FAIL')).toEqual([]);
  });
});
