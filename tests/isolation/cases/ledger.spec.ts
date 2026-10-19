// TEST-SEC-001 cases for module ledger (owner: Dev 5, MOD-LED; Release 3 scope, built early).
// Tenant B holds every ledger permission and still must not see or change tenant A accounts, journals or lines.
// Named operationIds: API-LED-001, API-LED-001-CREATE, API-LED-003, API-LED-003-POST, API-LED-006, API-LED-002,
// API-LED-004, API-LED-005. The table level (row-level security for the real dsa_api role) is proven directly in the last case.
import type { PermissionCode } from '@dsa/contracts';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../harness';

let env: IsolationEnv;
const ACC_BANK = 'acc_iso_a_bank';
const ACC_PAY = 'acc_iso_a_pay';
const JOURNAL = 'jnl_iso_a_1';

beforeAll(async () => {
  env = await startIsolationEnv();
  const a = env.A.tenantId;
  await env.admin.query(
    `INSERT INTO app.ledger_account (id, tenant_id, code, name, type) VALUES
       ($1, $3, '1010-ISO-BANK', 'Iso bank', 'ASSET'), ($2, $3, '2100-ISO-PAYABLE', 'Iso payable', 'LIABILITY')`,
    [ACC_BANK, ACC_PAY, a],
  );
  await env.admin.query('BEGIN');
  await env.admin.query(
    `INSERT INTO app.ledger_journal (id, tenant_id, journal_number, reference_type, reference_id, period, posted_by)
     VALUES ($1, $2, 'JNL-ISO-1', 'MANUAL', 'ref-iso', '2026-10', $3)`,
    [JOURNAL, a, env.A.userIds[0]],
  );
  await env.admin.query(
    `INSERT INTO app.ledger_journal_line (id, tenant_id, journal_id, account_id, entry_type, amount, line_number) VALUES
       ('jln_iso_1', $1, $2, $3, 'DEBIT', 100.00, 1), ('jln_iso_2', $1, $2, $4, 'CREDIT', 100.00, 2)`,
    [a, JOURNAL, ACC_BANK, ACC_PAY],
  );
  await env.admin.query('COMMIT');
}, 240_000);

afterAll(async () => {
  await env?.stop();
});

const LED: PermissionCode[] = ['finance.view', 'finance.period_close', 'export.run'];

describe('TEST-SEC-001 ledger: tenants never cross', () => {
  it('API-LED-001 API-LED-003: tenant B lists none of tenant A accounts or journals, tenant A sees its own', async () => {
    const own = await request(env.appAs(env.A, LED)).get('/v1/ledger/accounts');
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(JSON.stringify(own.body)).toContain(ACC_BANK);

    const other = await request(env.appAs(env.B, LED)).get('/v1/ledger/accounts');
    expect(other.status).toBe(200);
    expect(JSON.stringify(other.body)).not.toContain(ACC_BANK);
    expect(JSON.stringify(other.body)).not.toContain(env.A.tenantId);

    const journals = await request(env.appAs(env.B, LED)).get('/v1/ledger/journals');
    expect(journals.status).toBe(200);
    expect(JSON.stringify(journals.body)).not.toContain(JOURNAL);
  });

  it('API-LED-002: tenant B cannot read the balance of a tenant A account', async () => {
    const res = await request(env.appAs(env.B, LED)).get(`/v1/ledger/accounts/${ACC_BANK}/balance`);
    expect(res.status).toBe(404);
  });

  it('API-LED-001-CREATE: tenant B can use the same account code, independently of tenant A', async () => {
    const res = await request(env.appAs(env.B, [...LED, 'finance.view']))
      .post('/v1/ledger/accounts')
      .set('Idempotency-Key', 'iso-led-create-1')
      .send({ code: '1010-ISO-BANK', name: 'B bank', type: 'ASSET' });
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    const count = await env.admin.query(
      `SELECT tenant_id FROM app.ledger_account WHERE code = '1010-ISO-BANK' ORDER BY tenant_id`,
    );
    expect(count.rows.map((r) => r.tenant_id).sort()).toEqual([env.A.tenantId, env.B.tenantId].sort());
  });

  it('API-LED-003-POST: tenant B cannot post to a tenant A account code it does not own', async () => {
    const res = await request(env.appAs(env.B, LED))
      .post('/v1/ledger/journals')
      .set('Idempotency-Key', 'iso-led-post-1')
      .send({
        referenceType: 'MANUAL',
        referenceId: 'iso',
        period: '2026-10',
        lines: [
          { accountCode: '2100-ISO-PAYABLE', entryType: 'DEBIT', amount: '5.00' },
          { accountCode: '1010-ISO-BANK', entryType: 'CREDIT', amount: '5.00' },
        ],
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const lines = await env.admin.query(
      `SELECT count(*)::int AS n FROM app.ledger_journal_line WHERE tenant_id = $1`,
      [env.B.tenantId],
    );
    expect(lines.rows[0].n).toBe(0);
  });

  it('API-LED-006 API-LED-004 API-LED-005: tenant B period close, statements and export touch only its own tenant', async () => {
    const close = await request(env.appAs(env.B, LED))
      .post('/v1/ledger/periods/2026-10/close')
      .set('Idempotency-Key', 'iso-led-close-1')
      .send({});
    expect(JSON.stringify(close.body)).not.toContain(env.A.tenantId);
    const periodsOfA = await env.admin.query(
      `SELECT count(*)::int AS n FROM app.ledger_period WHERE tenant_id = $1`,
      [env.A.tenantId],
    );
    expect(periodsOfA.rows[0].n).toBe(0);

    const statements = await request(env.appAs(env.B, LED)).get('/v1/connectors/con_iso_a/statements');
    expect(JSON.stringify(statements.body)).not.toContain(ACC_BANK);

    const exp = await request(env.appAs(env.B, LED))
      .post('/v1/ledger/exports')
      .set('Idempotency-Key', 'iso-led-exp-1')
      .send({ format: 'JSON' });
    expect(JSON.stringify(exp.body)).not.toContain(ACC_BANK);
    expect(JSON.stringify(exp.body)).not.toContain(JOURNAL);
  });

  it('row-level security: the real dsa_api role sees only the tenant it is set to, and cannot change or delete journal lines', async () => {
    const c = new pg.Client({
      host: env.admin.host,
      port: env.admin.port,
      database: env.admin.database,
      user: 'dsa_api',
      password: 'isolation',
    });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [env.B.tenantId]);
      for (const table of ['ledger_account', 'ledger_journal', 'ledger_journal_line']) {
        const r = await c.query(`SELECT count(*)::int AS n FROM app.${table} WHERE tenant_id = $1`, [
          env.A.tenantId,
        ]);
        expect(r.rows[0].n, table).toBe(0);
      }
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [env.A.tenantId]);
      expect((await c.query(`SELECT count(*)::int AS n FROM app.ledger_journal_line`)).rows[0].n).toBe(2);
      await expect(
        c.query(`UPDATE app.ledger_journal_line SET amount = 1 WHERE id = 'jln_iso_1'`),
      ).rejects.toThrow();
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [env.A.tenantId]);
      await expect(c.query(`DELETE FROM app.ledger_journal_line WHERE id = 'jln_iso_1'`)).rejects.toThrow();
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      await c.end();
    }
  });
});
