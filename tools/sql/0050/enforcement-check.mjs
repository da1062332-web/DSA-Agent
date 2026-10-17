// tools/sql/0050/enforcement-check.mjs — REAL role-enforcement test for the platform realm (migration 0050).
//
// Connects as the API's own database role (dsa_api, from DATABASE_URL) and checks what PostgreSQL really lets that role see and do for a
// platform session, a customer-tenant session and a session with no tenant. This is the test verify-behaviour.sql cannot be: that script
// runs as postgres, which row-level security does not apply to. Nothing here needs a role-switching privilege.
//
//   node --env-file=apps/api/.env tools/sql/0050/enforcement-check.mjs                 # reads, plus writes that must be REFUSED
//   node --env-file=apps/api/.env tools/sql/0050/enforcement-check.mjs --with-writes   # also tries writes that must be ALLOWED
//
// Safety: everything runs inside one transaction that is ALWAYS rolled back (also when a check fails or the script crashes), so no row
// is ever kept. Refused writes change nothing. --with-writes inserts and updates inside that transaction and then rolls it back. The
// script refuses to run as a superuser, as postgres/service_role, or as any role that can bypass RLS, because the result would be
// meaningless. It prints no connection string. Exit code 0 only if every check passes.
/* global process, console, URL */
import pg from 'pg';

const PLATFORM = 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG';
const FORBIDDEN = /^(postgres|supabase_admin|service_role)(\..*)?$/;
const withWrites = process.argv.includes('--with-writes');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'DATABASE_URL is not set. Run with: node --env-file=apps/api/.env tools/sql/0050/enforcement-check.mjs',
  );
  process.exit(2);
}
if (FORBIDDEN.test(decodeURIComponent(new URL(url).username))) {
  console.error(
    'DATABASE_URL connects as a privileged role. It must be the API role (dsa_api), or the test proves nothing.',
  );
  process.exit(2);
}

const db = new pg.Client({ connectionString: url });
const results = [];
const check = (name, ok, detail = '') =>
  results.push({
    ok,
    line: `${ok ? 'PASS' : 'FAIL'} | [ROLE-ENFORCEMENT] ${name}${detail ? ' | ' + detail : ''}`,
  });
const skip = (name, why) =>
  results.push({ ok: true, skipped: true, line: `SKIP | [ROLE-ENFORCEMENT] ${name} | ${why}` });

const as = (tenantId) => db.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
const count = async (tenantId, sql, params = []) => {
  await as(tenantId);
  return Number((await db.query(sql, params)).rows[0].n);
};
/** Runs a statement that must be REFUSED by row-level security (SQLSTATE 42501). A savepoint keeps the transaction usable. */
const refused = async (tenantId, sql, params = []) => {
  await db.query('SAVEPOINT s');
  try {
    await as(tenantId);
    await db.query(sql, params);
    await db.query('RELEASE SAVEPOINT s');
    return { refused: false, detail: 'it was ALLOWED' };
  } catch (e) {
    await db.query('ROLLBACK TO SAVEPOINT s');
    return { refused: e.code === '42501', detail: `${e.code}: ${String(e.message).slice(0, 90)}` };
  }
};
/** Runs a write and returns how many rows it changed (row-level security filters rows silently on UPDATE). */
const changed = async (tenantId, sql, params = []) => {
  await as(tenantId);
  return (await db.query(sql, params)).rowCount;
};

try {
  await db.connect();
  const me = (
    await db.query(
      `select current_user as u, rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    )
  ).rows[0];
  if (me.rolsuper || me.rolbypassrls) {
    console.error(
      `Connected as ${me.u}, which is a superuser or bypasses RLS. Refusing: the result would prove nothing.`,
    );
    process.exit(2);
  }
  check(`connected as ${me.u}: not a superuser and cannot bypass row-level security`, true);
  await db.query('BEGIN');
  await db.query(`set local statement_timeout = '20s'`);
  await db.query(`set local lock_timeout = '5s'`);

  // ---- which tenants exist, as the platform session sees them
  await as(PLATFORM);
  const tenants = (await db.query(`select id, tenant_type from tenant order by created_at, id`)).rows;
  const customers = tenants.filter((t) => t.tenant_type !== 'PLATFORM').map((t) => t.id);
  check(
    'the platform session sees the platform tenant and every customer tenant',
    tenants.some((t) => t.id === PLATFORM) && customers.length >= 2,
    `${tenants.length} tenant rows`,
  );
  const [A, B] = customers;
  if (!A || !B) throw new Error('needs at least two customer tenants');

  // ---- visibility
  check(
    'a customer-tenant session sees only its own tenant row',
    (await count(A, 'select count(*) as n from tenant')) === 1 &&
      (await count(B, 'select count(*) as n from tenant')) === 1,
  );
  check(
    'a session with no tenant sees no tenant row',
    (await count('', 'select count(*) as n from tenant')) === 0,
  );
  check(
    'any session can read the feature flags and master data',
    (await count(A, 'select count(*) as n from feature_flag')) > 0 &&
      (await count('', 'select count(*) as n from master_data_item')) > 0,
  );

  // support requests: find a tenant that has one, then prove the platform sees it and another tenant does not
  let owner = null;
  for (const t of customers)
    if ((await count(t, 'select count(*) as n from support_access_grant')) > 0) {
      owner = t;
      break;
    }
  const platformGrants = await count(PLATFORM, 'select count(*) as n from support_access_grant');
  if (owner) {
    const other = customers.find((t) => t !== owner);
    check(
      'a platform session sees support-access requests (at least those the target tenant sees)',
      platformGrants >= (await count(owner, 'select count(*) as n from support_access_grant')),
    );
    check(
      "another tenant sees none of that tenant's support requests",
      (await count(other, 'select count(*) as n from support_access_grant where tenant_id = $1', [owner])) ===
        0,
    );
  } else {
    skip('support-access visibility', 'no support-access request exists to look at');
  }

  // data corrections: business values, never visible to the platform session
  let holder = null;
  for (const t of customers)
    if ((await count(t, 'select count(*) as n from data_correction_request')) > 0) {
      holder = t;
      break;
    }
  if (holder) {
    check(
      'a platform session sees NO data-correction rows although a tenant has some',
      (await count(PLATFORM, 'select count(*) as n from data_correction_request')) === 0 &&
        (await count(
          customers.find((t) => t !== holder),
          'select count(*) as n from data_correction_request where tenant_id = $1',
          [holder],
        )) === 0,
    );
  } else {
    skip('data-correction invisibility', 'no data-correction row exists to hide');
  }

  // no business table leaks to the platform realm
  for (const table of [
    'customer',
    'lead',
    'loan_application',
    'app_user',
    'role',
    'role_permission',
    'audit_event',
    'complaint',
    'message',
    'task',
  ]) {
    const exists = (await db.query(`select to_regclass('app.' || quote_ident($1)) is not null as e`, [table]))
      .rows[0].e;
    if (!exists) continue;
    const n = await count(PLATFORM, `select count(*) as n from ${table} where tenant_id <> $1`, [PLATFORM]);
    check(`a platform session sees no rows of customer tenants in ${table}`, n === 0, `${n} rows`);
  }

  // ---- the aggregate: answers in the platform realm only
  await as(PLATFORM);
  const counts = await db.query('select count(*) as n from platform_tenant_user_counts()');
  check('the user-count function answers in the platform realm', Number(counts.rows[0].n) >= 0);
  check(
    'the user-count function is refused to a customer session',
    (await refused(A, 'select * from platform_tenant_user_counts()')).refused,
  );
  check(
    'the user-count function is refused to a session with no tenant',
    (await refused('', 'select * from platform_tenant_user_counts()')).refused,
  );

  // ---- writes that MUST be refused (nothing can be kept)
  for (const [label, who] of [
    ['a customer session', A],
    ['a session with no tenant', ''],
  ]) {
    const f = await refused(
      who,
      `insert into feature_flag (key, scope, value, owner, updated_by) values ('zz_enforcement_check', 'GLOBAL', true, 'check', 'check')`,
    );
    check(`${label} may NOT insert a feature flag`, f.refused, f.detail);
    const m = await refused(
      who,
      `insert into master_data_item (dataset, code, label, created_by) values ('zz_check', 'zz', 'zz', 'check')`,
    );
    check(`${label} may NOT insert master data`, m.refused, m.detail);
  }
  check(
    'a customer session may NOT change a feature flag (the update reaches 0 rows)',
    (await changed(A, `update feature_flag set description = description`)) === 0,
  );
  check(
    'a customer session may NOT change master data (0 rows)',
    (await changed(A, `update master_data_item set label = label`)) === 0,
  );
  const sup = await refused(
    A,
    `insert into support_access_grant (id, tenant_id, support_user_id, reason, expires_at, status, created_by) values ('sag_zz_check', $1, 'usr_x', 'check', now() + interval '1 hour', 'PENDING', 'check')`,
    [A],
  );
  check('a customer session may NOT file a support request, even for itself', sup.refused, sup.detail);
  check(
    "a customer session may NOT approve another tenant's support request (0 rows)",
    (await changed(B, `update support_access_grant set status = 'ACTIVE' where tenant_id = $1`, [A])) === 0,
  );
  check(
    'a platform session may NOT approve any support request (0 rows)',
    (await changed(
      PLATFORM,
      `update support_access_grant set status = 'ACTIVE', approved_by = 'usr_platform'`,
    )) === 0,
  );
  const pre = await refused(
    PLATFORM,
    `insert into support_access_grant (id, tenant_id, support_user_id, reason, expires_at, status, approved_by, created_by) values ('sag_zz_check2', $1, 'usr_x', 'check', now() + interval '1 hour', 'ACTIVE', 'usr_x', 'check')`,
    [A],
  );
  check('a platform session may NOT file a pre-approved (ACTIVE) support request', pre.refused, pre.detail);
  const self = await refused(
    PLATFORM,
    `insert into support_access_grant (id, tenant_id, support_user_id, reason, expires_at, status, created_by) values ('sag_zz_check3', $1, 'usr_x', 'check', now() + interval '1 hour', 'PENDING', 'check')`,
    [PLATFORM],
  );
  check(
    'a platform session may NOT file a support request against the platform tenant',
    self.refused,
    self.detail,
  );
  const corr = await refused(
    PLATFORM,
    `insert into data_correction_request (id, tenant_id, justification, script_ref, requested_by, status, created_by) values ('dcr_zz_check', $1, 'check', 'SCR-1', 'usr_x', 'PENDING', 'check')`,
    [A],
  );
  check(
    'a platform session may NOT insert a data correction for a customer tenant',
    corr.refused,
    corr.detail,
  );

  // ---- writes that MUST be allowed (opt-in; still rolled back)
  if (withWrites) {
    const ok = async (name, fn) => {
      await db.query('SAVEPOINT w');
      try {
        const detail = await fn();
        await db.query('RELEASE SAVEPOINT w');
        check(name, true, detail);
      } catch (e) {
        await db.query('ROLLBACK TO SAVEPOINT w');
        check(name, false, `${e.code}: ${String(e.message).slice(0, 90)}`);
      }
    };
    await ok('a platform session may insert a feature flag', async () => {
      await as(PLATFORM);
      await db.query(
        `insert into feature_flag (key, scope, value, owner, updated_by) values ('zz_enforcement_check', 'GLOBAL', true, 'check', 'check')`,
      );
    });
    await ok('a platform session may update a feature flag (1 row)', async () => {
      if (
        (await changed(
          PLATFORM,
          `update feature_flag set description = description where key = 'zz_enforcement_check'`,
        )) !== 1
      )
        throw new Error('not 1 row');
    });
    await ok('a platform session may insert master data', async () => {
      await as(PLATFORM);
      await db.query(
        `insert into master_data_item (dataset, code, label, created_by) values ('zz_check', 'zz', 'zz', 'check')`,
      );
    });
    await ok('a platform session may file a PENDING support request for a customer tenant', async () => {
      await as(PLATFORM);
      await db.query(
        `insert into support_access_grant (id, tenant_id, support_user_id, reason, expires_at, status, created_by) values ('sag_zz_ok', $1, 'usr_platform', 'check', now() + interval '1 hour', 'PENDING', 'check')`,
        [A],
      );
    });
    await ok(
      'the target tenant sees that request; another tenant and the platform realm cannot change it',
      async () => {
        if ((await count(A, `select count(*) as n from support_access_grant where id = 'sag_zz_ok'`)) !== 1)
          throw new Error('target tenant does not see it');
        if (
          (await changed(B, `update support_access_grant set status = 'ACTIVE' where id = 'sag_zz_ok'`)) !== 0
        )
          throw new Error('another tenant changed it');
        if (
          (await changed(
            PLATFORM,
            `update support_access_grant set status = 'ACTIVE' where id = 'sag_zz_ok'`,
          )) !== 0
        )
          throw new Error('the platform realm changed it');
      },
    );
    await ok('the target tenant may approve it (1 row)', async () => {
      if (
        (await changed(
          A,
          `update support_access_grant set status = 'ACTIVE', approved_by = 'usr_admin', approved_at = now() where id = 'sag_zz_ok'`,
        )) !== 1
      )
        throw new Error('not 1 row');
    });
    await ok('a customer session may insert a data correction for its own tenant', async () => {
      await as(A);
      await db.query(
        `insert into data_correction_request (id, tenant_id, justification, script_ref, requested_by, status, created_by) values ('dcr_zz_ok', $1, 'check', 'SCR-1', 'usr_x', 'PENDING', 'check')`,
        [A],
      );
    });
    check(
      '...and neither another tenant nor the platform realm can see it',
      (await count(B, `select count(*) as n from data_correction_request where id = 'dcr_zz_ok'`)) === 0 &&
        (await count(
          PLATFORM,
          `select count(*) as n from data_correction_request where id = 'dcr_zz_ok'`,
        )) === 0,
    );
  } else {
    skip(
      'writes that must be ALLOWED',
      'not run: pass --with-writes to try them (they are inserted and updated inside this transaction, then rolled back)',
    );
  }
} catch (e) {
  // A crash is reported as a failed check, never as a pass, and the rollback below still runs.
  results.push({
    ok: false,
    line: `FAIL | [ROLE-ENFORCEMENT] the script stopped before finishing | ${String(e && e.message ? e.message : e).slice(0, 160)}`,
  });
} finally {
  // Always roll back. If the connection never opened, this is a harmless no-op.
  try {
    await db.query('ROLLBACK');
  } catch {
    /* nothing open */
  }
  await db.end().catch(() => undefined);
}

console.log(results.map((r) => r.line).join('\n'));
const failed = results.filter((r) => !r.ok).length;
const skipped = results.filter((r) => r.skipped).length;
console.log(
  `\nRESULT: PASS=${results.length - failed - skipped} FAIL=${failed} SKIP=${skipped}. The transaction was rolled back: nothing was kept.`,
);
process.exit(failed > 0 ? 1 : 0);
