// The two verification scripts for migration 0050, rehearsed on a throwaway PostgreSQL (owner: Dev 1; MODULE 1 platform realm).
//   tools/sql/0050/verify-behaviour.sql   policy logic + enforcement preconditions, run as a role that does NOT have SET on dsa_api
//                                         (the hosted situation: postgres, not superuser, bypasses RLS, cannot SET ROLE dsa_api)
//   tools/sql/0050/enforcement-check.mjs  REAL role enforcement: connects as dsa_api itself
// Proves both pass on a correct database, and, by breaking the policies on purpose, that both can FAIL. Never touches hosted.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPostgres } from '../../../tests/guard/start-postgres';

const ROOT = path.resolve(__dirname, '../../..');
const OPS = path.join(ROOT, 'tools/sql/0050');
const MIGRATIONS_DIR = process.env.DSA_MIGRATIONS_DIR ?? path.join(ROOT, 'supabase/migrations');
const A = 'ten_01M4SXZ9E66W8T6DNJYBVNS3FA';
const B = 'ten_01M4SXZHMRM52X9HA4DE1G5G12';
const C = 'ten_01JTESTTENANT00000000000000';

let container: StartedPostgreSqlContainer;
let admin: pg.Client; // superuser, for setup and for breaking things on purpose
let verifier: pg.Client; // like hosted postgres: not superuser, bypasses RLS, has no SET on dsa_api

beforeAll(async () => {
  container = await startPostgres();
  admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    await admin.query(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
  }
  await admin.query(
    `CREATE ROLE dsa_api LOGIN PASSWORD 'rehearsal' NOBYPASSRLS IN ROLE dsa_app; ALTER ROLE dsa_api SET search_path = app, extensions;`,
  );
  // The hosted executing role: a member of dsa_api WITHOUT the SET option, able to read everything (BYPASSRLS), not a superuser.
  await admin.query(
    `CREATE ROLE verifier LOGIN PASSWORD 'verifier' NOSUPERUSER BYPASSRLS; GRANT dsa_app TO verifier; GRANT pg_read_all_data TO verifier;`,
  );
  const major = Number((await admin.query(`show server_version_num`)).rows[0].server_version_num) / 10000;
  await admin.query(
    major >= 16 ? `GRANT dsa_api TO verifier WITH SET FALSE, INHERIT FALSE` : `GRANT dsa_api TO verifier`,
  );
  // Data that makes the checks informative: tenants, a support request, a correction, a business row.
  for (const [id, slug] of [
    [A, 'alpha'],
    [B, 'beta'],
    [C, 'test-c'],
  ]) {
    await admin.query(
      `insert into app.tenant (id, slug, legal_name, tenant_type, created_by) values ($1, $2, $2, 'DSA_ORG', 'seed')`,
      [id, slug],
    );
  }
  await admin.query(
    `insert into app.organisation (id, tenant_id, legal_name, constitution, created_by, updated_by) values ('org_e_1', $1, 'Alpha', 'PVT_LTD', 's', 's')`,
    [A],
  );
  await admin.query(
    `insert into app.branch (id, tenant_id, organisation_id, code, name, created_by, updated_by) values ('br_e_1', $1, 'org_e_1', 'MUM01', 'Mumbai', 's', 's')`,
    [A],
  );
  await admin.query(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by) values ('cust_e_1', $1, 'INDIVIDUAL', 'Enforcement Customer', 'br_e_1', 's', 's')`,
    [A],
  );
  await admin.query(
    `insert into app.support_access_grant (id, tenant_id, support_user_id, reason, expires_at, status, created_by) values ('sag_e_1', $1, 'usr_platform', 'Seed request', now() + interval '1 hour', 'PENDING', 'seed')`,
    [A],
  );
  await admin.query(
    `insert into app.data_correction_request (id, tenant_id, justification, script_ref, requested_by, status, created_by) values ('dcr_e_1', $1, 'Seed correction', 'SCR-1', 'usr_x', 'PENDING', 'seed')`,
    [A],
  );
  verifier = new pg.Client({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    database: container.getDatabase(),
    user: 'verifier',
    password: 'verifier',
  });
  await verifier.connect();
}, 240_000);
afterAll(async () => {
  await verifier?.end();
  await admin?.end();
  await container?.stop();
});

const behaviourSql = () => readFileSync(path.join(OPS, 'verify-behaviour.sql'), 'utf8');

/** Runs verify-behaviour.sql the way the CLI does: it always ends in an error whose message carries the result. */
async function runBehaviour(
  client: pg.Client,
): Promise<{ message: string; pass: number; fail: number; lines: string[] }> {
  let message = '';
  try {
    await client.query(behaviourSql());
  } catch (e) {
    message = (e as Error).message;
  }
  const m = message.match(/RESULT: PASS=(\d+) FAIL=(\d+)/);
  return {
    message,
    pass: m ? Number(m[1]) : -1,
    fail: m ? Number(m[2]) : -1,
    lines: message.split('\n').filter((l) => /^(PASS|FAIL) \|/.test(l)),
  };
}

/** Runs enforcement-check.mjs as dsa_api, in a child process, exactly as a person would. */
function runEnforcement(args: string[] = [], user = 'dsa_api', password = 'rehearsal') {
  const url = `postgresql://${user}:${password}@${container.getHost()}:${container.getMappedPort(5432)}/${container.getDatabase()}`;
  const r = spawnSync(process.execPath, [path.join(OPS, 'enforcement-check.mjs'), ...args], {
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
  });
  const out = `${r.stdout}${r.stderr}`;
  const m = out.match(/RESULT: PASS=(\d+) FAIL=(\d+) SKIP=(\d+)/);
  return {
    code: r.status,
    out,
    pass: m ? Number(m[1]) : -1,
    fail: m ? Number(m[2]) : -1,
    skip: m ? Number(m[3]) : -1,
    lines: out.split('\n').filter((l) => /^(PASS|FAIL|SKIP) \|/.test(l)),
  };
}

describe('TEST-VERIFY the two verification scripts', () => {
  it('TEST-VERIFY-01 the rehearsal role is built like hosted: not a superuser, bypasses RLS, and has NO right to SET ROLE dsa_api', async () => {
    const r = (
      await admin.query(
        `select rolsuper, rolbypassrls, pg_has_role('verifier','dsa_api','MEMBER') as member from pg_roles where rolname = 'verifier'`,
      )
    ).rows[0];
    expect(r).toMatchObject({ rolsuper: false, rolbypassrls: true });
    const major = Number((await admin.query(`show server_version_num`)).rows[0].server_version_num) / 10000;
    if (major >= 16)
      expect(
        (await admin.query(`select pg_has_role('verifier','dsa_api','SET') as can_set`)).rows[0].can_set,
      ).toBe(false);
    // ...and the old approach genuinely fails for it, which is the hosted bug this rewrite fixes.
    await expect(verifier.query(`DO $$ BEGIN SET LOCAL ROLE dsa_api; END $$;`)).rejects.toThrow(
      /permission denied to set role/,
    );
  });

  it('TEST-VERIFY-02 verify-behaviour.sql passes as the hosted-like role, labels its tiers, and leaves nothing behind', async () => {
    const before = (
      await admin.query(
        `select (select count(*) from app.support_access_grant) as s, (select count(*) from app.data_correction_request) as c, (select count(*) from app.feature_flag) as f`,
      )
    ).rows[0];
    const r = await runBehaviour(verifier);
    expect(r.message).toContain('VERIFY-BEHAVIOUR (rolled back on purpose)');
    expect(r.message).toContain('NOT a test of enforcement');
    expect(r.fail).toBe(0);
    expect(r.pass).toBe(57); // 8 enforcement preconditions + 49 policy-logic checks, with a support request present and all 12 business tables
    expect(r.lines.filter((l) => l.includes('[ENFORCEMENT-PRECONDITIONS]')).length).toBe(8);
    expect(r.lines.filter((l) => l.includes('[POLICY-LOGIC]')).length).toBe(49);
    expect(r.lines.some((l) => l.includes('ROLE-ENFORCEMENT'))).toBe(false); // it never claims to test enforcement
    expect(
      (
        await admin.query(
          `select (select count(*) from app.support_access_grant) as s, (select count(*) from app.data_correction_request) as c, (select count(*) from app.feature_flag) as f`,
        )
      ).rows[0],
    ).toEqual(before);
    // the session is clean afterwards: still the same role, no tenant setting, no transaction left open
    expect(
      (
        await verifier.query(
          `select current_user as u, coalesce(nullif(current_setting('app.tenant_id', true), ''), '(none)') as t, txid_current_if_assigned() as x`,
        )
      ).rows[0],
    ).toEqual({ u: 'verifier', t: '(none)', x: null });
  });

  it('TEST-VERIFY-03 it also passes as a superuser (the rehearsal baseline), with the same result', async () => {
    const r = await runBehaviour(admin);
    expect(r.fail).toBe(0);
    expect(r.pass).toBe(57);
  });

  it('TEST-VERIFY-04 enforcement-check.mjs passes as dsa_api: refused writes are refused, reads are isolated, and nothing is kept', async () => {
    const r = runEnforcement();
    expect(r.out).toContain('connected as dsa_api');
    expect(r.fail).toBe(0);
    expect(r.code).toBe(0);
    expect([r.pass, r.skip]).toEqual([33, 1]); // 33 checks; the one SKIP is the opt-in allowed-write group
    expect(r.lines.filter((l) => l.startsWith('SKIP')).join()).toContain('--with-writes');
    expect(r.out).toContain('nothing was kept');
  });

  it('TEST-VERIFY-05 enforcement-check.mjs --with-writes also proves the ALLOWED writes, and still keeps nothing', async () => {
    const before = (
      await admin.query(
        `select (select count(*) from app.support_access_grant) as s, (select count(*) from app.data_correction_request) as c, (select count(*) from app.feature_flag) as f, (select count(*) from app.master_data_item) as m`,
      )
    ).rows[0];
    const r = runEnforcement(['--with-writes']);
    expect(r.fail).toBe(0);
    expect(r.code).toBe(0);
    expect([r.pass, r.skip]).toEqual([41, 0]); // the 8 allowed-write checks now run instead of being skipped
    expect(
      r.lines.filter(
        (l) =>
          l.startsWith('PASS') &&
          /may insert a feature flag|may file a PENDING|may approve it|own tenant/.test(l),
      ).length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      (
        await admin.query(
          `select (select count(*) from app.support_access_grant) as s, (select count(*) from app.data_correction_request) as c, (select count(*) from app.feature_flag) as f, (select count(*) from app.master_data_item) as m`,
        )
      ).rows[0],
    ).toEqual(before);
    expect(
      (
        await admin.query(
          `select count(*)::int as n from app.feature_flag where key = 'zz_enforcement_check'`,
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('TEST-VERIFY-06 enforcement-check.mjs refuses to run as a privileged role, because the result would prove nothing', async () => {
    // start-postgres already creates service_role (NOLOGIN); give it a login for this case, so the tool sees a real privileged login.
    await admin.query(
      `DO $$ BEGIN
         IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN ALTER ROLE service_role LOGIN PASSWORD 'svc';
         ELSE CREATE ROLE service_role LOGIN PASSWORD 'svc'; END IF;
       END $$;`,
    );
    const cases: [string, string, RegExp][] = [
      ['verifier', 'verifier', /superuser or bypasses RLS/], // can bypass row-level security
      [container.getUsername(), container.getPassword(), /superuser or bypasses RLS/], // a superuser
      ['service_role', 'svc', /privileged role/], // a role the tool refuses by name
    ];
    for (const [user, password, why] of cases) {
      const r = runEnforcement([], user, password);
      expect(r.code, user).toBe(2);
      expect(r.out, user).toMatch(why);
    }
  });

  describe('verify.sql check 27 (the only UPDATE policy on support requests is the tenant one), in sessions like the hosted CLI', () => {
    // The hosted CLI opens a fresh session whose search_path does not include app, so PostgreSQL prints policy expressions with the
    // schema: app.app_tenant(). A connection that earlier ran SET search_path = app prints app_tenant(). The check must pass for both.
    const verifySql = () => readFileSync(path.join(OPS, 'verify.sql'), 'utf8');
    const runVerify = async (searchPath?: string) => {
      const c = new pg.Client({
        host: container.getHost(),
        port: container.getMappedPort(5432),
        database: container.getDatabase(),
        user: container.getUsername(),
        password: container.getPassword(),
        options: searchPath ? `-c search_path=${searchPath}` : undefined,
      });
      await c.connect();
      try {
        return (await c.query(verifySql())).rows as { name: string; actual: string; result: string }[];
      } finally {
        await c.end();
      }
    };
    const row27 = (rows: { name: string; actual: string; result: string }[]) =>
      rows.find((r) => r.name.startsWith('a platform session cannot UPDATE support requests'))!;

    it('TEST-VERIFY-14 the whole script parses and returns all 32 rows; check 27 passes where the policy prints as app.app_tenant()', async () => {
      const rows = await runVerify();
      expect(rows).toHaveLength(32);
      const r = row27(rows);
      expect(r.actual).toContain('app.app_tenant()'); // the hosted representation
      expect(r.result).toBe('PASS');
    });

    it('TEST-VERIFY-15 check 27 passes just the same where the policy prints as app_tenant() (search_path includes app)', async () => {
      const r = row27(await runVerify('app,public'));
      expect(r.actual).not.toContain('app.app_tenant()');
      expect(r.result).toBe('PASS');
    });

    const mutate = async (name: string, breakSql: string, undoSql: string) => {
      await admin.query(breakSql);
      try {
        expect(row27(await runVerify()).result, `${name} must make check 27 FAIL`).toBe('FAIL');
      } finally {
        await admin.query(undoSql);
      }
      expect(row27(await runVerify()).result, `${name}: restored`).toBe('PASS');
    };

    it('TEST-VERIFY-16 check 27 FAILS if a platform UPDATE policy is added (a second UPDATE policy)', async () => {
      await mutate(
        'second UPDATE policy',
        `CREATE POLICY platform_update ON app.support_access_grant FOR UPDATE USING (app.is_platform_realm()) WITH CHECK (app.is_platform_realm());`,
        `DROP POLICY platform_update ON app.support_access_grant;`,
      );
    });

    it('TEST-VERIFY-17 check 27 FAILS if the tenant restriction is dropped from the UPDATE policy', async () => {
      await mutate(
        'tenant restriction dropped',
        `DROP POLICY grant_tenant_decide ON app.support_access_grant; CREATE POLICY grant_tenant_decide ON app.support_access_grant FOR UPDATE USING (status IN ('PENDING','ACTIVE')) WITH CHECK (tenant_id = app.app_tenant() AND status IN ('ACTIVE','DENIED','REVOKED'));`,
        `DROP POLICY grant_tenant_decide ON app.support_access_grant; CREATE POLICY grant_tenant_decide ON app.support_access_grant FOR UPDATE USING (tenant_id = app.app_tenant() AND status IN ('PENDING','ACTIVE')) WITH CHECK (tenant_id = app.app_tenant() AND status IN ('ACTIVE','DENIED','REVOKED'));`,
      );
    });

    it('TEST-VERIFY-18 check 27 FAILS if the platform realm is let in through the WITH CHECK of the UPDATE policy', async () => {
      await mutate(
        'platform realm in WITH CHECK',
        `DROP POLICY grant_tenant_decide ON app.support_access_grant; CREATE POLICY grant_tenant_decide ON app.support_access_grant FOR UPDATE USING (tenant_id = app.app_tenant() AND status IN ('PENDING','ACTIVE')) WITH CHECK ((tenant_id = app.app_tenant() AND status IN ('ACTIVE','DENIED','REVOKED')) OR app.is_platform_realm());`,
        `DROP POLICY grant_tenant_decide ON app.support_access_grant; CREATE POLICY grant_tenant_decide ON app.support_access_grant FOR UPDATE USING (tenant_id = app.app_tenant() AND status IN ('PENDING','ACTIVE')) WITH CHECK (tenant_id = app.app_tenant() AND status IN ('ACTIVE','DENIED','REVOKED'));`,
      );
    });

    it('TEST-VERIFY-19 check 27 FAILS if the UPDATE policy lets other statuses through (the tenant may then change finished requests)', async () => {
      await mutate(
        'status restriction dropped',
        `DROP POLICY grant_tenant_decide ON app.support_access_grant; CREATE POLICY grant_tenant_decide ON app.support_access_grant FOR UPDATE USING (tenant_id = app.app_tenant()) WITH CHECK (tenant_id = app.app_tenant() AND status IN ('ACTIVE','DENIED','REVOKED'));`,
        `DROP POLICY grant_tenant_decide ON app.support_access_grant; CREATE POLICY grant_tenant_decide ON app.support_access_grant FOR UPDATE USING (tenant_id = app.app_tenant() AND status IN ('PENDING','ACTIVE')) WITH CHECK (tenant_id = app.app_tenant() AND status IN ('ACTIVE','DENIED','REVOKED'));`,
      );
    });
  });

  describe('the checks can FAIL: each break below must be caught by BOTH scripts, then is undone', () => {
    const breakAndCheck = async (
      name: string,
      breakSql: string,
      undoSql: string,
      expectFailIn: { behaviour?: RegExp; enforcement?: RegExp; enforcementRefuses?: boolean },
    ) => {
      await admin.query(breakSql);
      try {
        const b = await runBehaviour(verifier);
        const e = runEnforcement();
        if (expectFailIn.behaviour) {
          expect(b.fail, `${name}: verify-behaviour.sql must report a FAIL`).toBeGreaterThan(0);
          expect(b.lines.filter((l) => l.startsWith('FAIL')).join('\n')).toMatch(expectFailIn.behaviour);
        }
        if (expectFailIn.enforcementRefuses) {
          expect(e.code, `${name}: enforcement-check.mjs must refuse to run`).toBe(2);
        } else if (expectFailIn.enforcement) {
          expect(e.fail, `${name}: enforcement-check.mjs must report a FAIL`).toBeGreaterThan(0);
          expect(e.code).toBe(1);
          expect(e.lines.filter((l) => l.startsWith('FAIL')).join('\n')).toMatch(expectFailIn.enforcement);
        }
      } finally {
        await admin.query(undoSql);
      }
      // restored: both pass again
      expect((await runBehaviour(verifier)).fail, `${name}: restored`).toBe(0);
      expect(runEnforcement().fail, `${name}: restored`).toBe(0);
    };

    it('TEST-VERIFY-07 a feature-flag insert policy that lets everyone in is caught', async () => {
      await breakAndCheck(
        'permissive flag_insert',
        `DROP POLICY flag_insert ON app.feature_flag; CREATE POLICY flag_insert ON app.feature_flag FOR INSERT WITH CHECK (true);`,
        `DROP POLICY flag_insert ON app.feature_flag; CREATE POLICY flag_insert ON app.feature_flag FOR INSERT WITH CHECK (app.is_platform_realm());`,
        {
          behaviour: /customer session may NOT insert a feature flag/,
          enforcement: /may NOT insert a feature flag/,
        },
      );
    });

    it('TEST-VERIFY-08 row-level security switched off on the support table is caught', async () => {
      await breakAndCheck(
        'RLS off on support_access_grant',
        `ALTER TABLE app.support_access_grant NO FORCE ROW LEVEL SECURITY; ALTER TABLE app.support_access_grant DISABLE ROW LEVEL SECURITY;`,
        `ALTER TABLE app.support_access_grant ENABLE ROW LEVEL SECURITY; ALTER TABLE app.support_access_grant FORCE ROW LEVEL SECURITY;`,
        {
          behaviour: /RLS is enabled and forced on support_access_grant/,
          enforcement: /support-access|support request|approve/,
        },
      );
    });

    it('TEST-VERIFY-09 a policy that shows data corrections to the platform realm is caught', async () => {
      await breakAndCheck(
        'platform reads corrections',
        `CREATE POLICY leak_corrections ON app.data_correction_request FOR SELECT USING (app.is_platform_realm());`,
        `DROP POLICY leak_corrections ON app.data_correction_request;`,
        {
          behaviour: /platform session would see NO data-correction rows/,
          enforcement: /NO data-correction rows/,
        },
      );
    });

    it('TEST-VERIFY-10 a platform session able to approve its own support request is caught', async () => {
      await breakAndCheck(
        'platform may update support',
        `CREATE POLICY platform_update ON app.support_access_grant FOR UPDATE USING (app.is_platform_realm()) WITH CHECK (app.is_platform_realm());`,
        `DROP POLICY platform_update ON app.support_access_grant;`,
        {
          behaviour: /platform session may NOT approve a support request/,
          enforcement: /platform session may NOT approve/,
        },
      );
    });

    it("TEST-VERIFY-11 a platform session able to read another tenant's business rows is caught", async () => {
      await breakAndCheck(
        'platform reads customers',
        `CREATE POLICY leak_customers ON app.customer FOR SELECT USING (app.is_platform_realm());`,
        `DROP POLICY leak_customers ON app.customer;`,
        {
          behaviour: /platform session would see no rows of other tenants in customer/,
          enforcement: /no rows of customer tenants in customer/,
        },
      );
    });

    it('TEST-VERIFY-12 an API role that can bypass RLS is caught: the preconditions fail and the enforcement test refuses to run', async () => {
      await breakAndCheck(
        'dsa_api bypasses RLS',
        `ALTER ROLE dsa_api BYPASSRLS;`,
        `ALTER ROLE dsa_api NOBYPASSRLS;`,
        {
          behaviour: /dsa_api is not a superuser and cannot bypass row-level security/,
          enforcementRefuses: true,
        },
      );
    });

    it('TEST-VERIFY-13 a user-count function that does not refuse a no-tenant session is caught (the bug the first rehearsal found)', async () => {
      await breakAndCheck(
        'is_platform_realm returns NULL',
        `CREATE OR REPLACE FUNCTION app.is_platform_realm() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT app.app_tenant() = 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG' $$;`,
        `CREATE OR REPLACE FUNCTION app.is_platform_realm() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(app.app_tenant() = 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG', false) $$;`,
        {
          behaviour:
            /is_platform_realm\(\) is false \(not NULL\) with no tenant|refused to a session with no tenant/,
          enforcement: /refused to a session with no tenant/,
        },
      );
    });
  });
});
