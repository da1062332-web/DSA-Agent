// Per-tenant feature flags against a REAL PostgreSQL (owner: Platform squad; Module 1 / MOD-ADM SUB-ADM.02). The real server process runs
// against one throwaway database that has every migration (0068 included). The unit spec (platform-tenant-flags.spec.ts) covers the API rules
// with a test double; this one proves the same things on the real tables and policies: the override goes to its own table, the shared flag
// table is untouched, a customer tenant can read its own rows but never write, and the foreign key refuses a flag that is not TENANT scope.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PLATFORM_TENANT_ID } from '@dsa/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintTestToken } from '../../../packages/kernel/src/testing/test-token';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import { apiRoleUrl, call, LOCAL_JWT_SECRET, LOCAL_SUPABASE_URL, startApi } from './support/spawn-api';

const ROOT = path.resolve(__dirname, '../../..');
const FLAG = 'crm.lead_auto_qualify';

let env: IsolationEnv;
let dbUrl: string;
let platformToken: string;
let customerToken: string;

const sqlFile = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
const flagTable = async () =>
  (await env.admin.query(`SELECT * FROM app.feature_flag ORDER BY key, scope`)).rows;

beforeAll(async () => {
  env = await startIsolationEnv();
  dbUrl = apiRoleUrl(env.admin);

  const branch = (
    await env.admin.query(`SELECT id FROM app.branch WHERE tenant_id = $1 LIMIT 1`, [PLATFORM_TENANT_ID])
  ).rows[0].id;
  const role = (
    await env.admin.query(
      `SELECT id FROM app.role WHERE tenant_id = $1 AND code = 'ROLE-PLATFORM-SUPERADMIN'`,
      [PLATFORM_TENANT_ID],
    )
  ).rows[0].id;
  await env.admin.query(
    `INSERT INTO app.app_user (id, tenant_id, idp_subject, email, display_name, primary_branch_id, created_by, updated_by)
     VALUES ('usr_platform_tflags', $1, 'sub-platform-tflags', 'operator@platform.example.com', 'Platform Operator', $2, 'iso', 'iso')`,
    [PLATFORM_TENANT_ID, branch],
  );
  await env.admin.query(
    `INSERT INTO app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, created_by) VALUES ('ura_platform_tflags', $1, 'usr_platform_tflags', $2, 'TENANT', 'iso')`,
    [PLATFORM_TENANT_ID, role],
  );
  platformToken = await mintTestToken({
    supabaseUrl: LOCAL_SUPABASE_URL,
    jwtSecret: LOCAL_JWT_SECRET,
    sub: 'sub-platform-tflags',
    tenantId: PLATFORM_TENANT_ID,
    aal: 'aal2',
  });
  customerToken = await mintTestToken({
    supabaseUrl: LOCAL_SUPABASE_URL,
    jwtSecret: LOCAL_JWT_SECRET,
    sub: 'sub-iso-a0',
    tenantId: env.A.tenantId,
    aal: 'aal2',
  });
}, 240_000);

afterAll(async () => {
  await env?.stop();
});

describe('per-tenant feature flags on a real database', () => {
  it('TEST-TFLAG-INT-01 the selected tenant is returned; an unknown tenant and the platform tenant itself are 404', async () => {
    const api = await startApi(dbUrl);
    try {
      const a = await call(api, platformToken, 'GET', `/platform/v1/tenants/${env.A.tenantId}`);
      expect(a.status, api.log()).toBe(200);
      expect(a.body).toMatchObject({ id: env.A.tenantId, slug: 'iso-a', tenantType: 'DSA_ORG' });
      const b = await call(api, platformToken, 'GET', `/platform/v1/tenants/${env.B.tenantId}`);
      expect(b.body).toMatchObject({ id: env.B.tenantId, slug: 'iso-b' });

      expect((await call(api, platformToken, 'GET', '/platform/v1/tenants/ten_does_not_exist')).status).toBe(
        404,
      );
      // The platform tenant is not a customer: it has no overrides to manage.
      expect(
        (await call(api, platformToken, 'GET', `/platform/v1/tenants/${PLATFORM_TENANT_ID}`)).status,
      ).toBe(404);
      expect(
        (await call(api, platformToken, 'GET', `/platform/v1/tenants/${PLATFORM_TENANT_ID}/flags`)).status,
      ).toBe(404);
    } finally {
      await api.stop();
    }
  }, 200_000);

  it('TEST-TFLAG-INT-02 an override is stored for that tenant only, the shared flag table is untouched, and it survives a restart', async () => {
    const before = await flagTable();
    const first = await startApi(dbUrl);
    let etag: string | null;
    try {
      const list = await call(first, platformToken, 'GET', `/platform/v1/tenants/${env.A.tenantId}/flags`);
      expect(list.status, first.log()).toBe(200);
      const keys = list.body.data.map((f: { key: string }) => f.key);
      expect(keys).toContain(FLAG);
      expect(keys).not.toContain('mfa.enforce_all'); // GLOBAL
      const start = list.body.data.find((f: { key: string }) => f.key === FLAG);
      expect(start).toMatchObject({
        tenantId: env.A.tenantId,
        defaultValue: false,
        value: false,
        overridden: false,
        lockVersion: 0,
      });

      const put = await call(
        first,
        platformToken,
        'PUT',
        `/platform/v1/tenants/${env.A.tenantId}/flags/${FLAG}`,
        { value: true },
        { 'If-Match': '"0"' },
      );
      expect(put.status, first.log()).toBe(200);
      expect(put.body).toMatchObject({
        value: true,
        defaultValue: false,
        overridden: true,
        lockVersion: 1,
        updatedBy: 'usr_platform_tflags',
      });
      etag = put.etag;
      expect(etag).toBe('"1"');

      // tenant B is unaffected
      const b = await call(first, platformToken, 'GET', `/platform/v1/tenants/${env.B.tenantId}/flags`);
      expect(b.body.data.find((f: { key: string }) => f.key === FLAG)).toMatchObject({
        value: false,
        overridden: false,
      });
    } finally {
      await first.stop();
    }

    // the rows
    const rows = (
      await env.admin.query(
        `SELECT tenant_id, key, scope, value, lock_version, updated_by FROM app.tenant_feature_flag`,
      )
    ).rows;
    expect(rows).toEqual([
      {
        tenant_id: env.A.tenantId,
        key: FLAG,
        scope: 'TENANT',
        value: true,
        lock_version: 1,
        updated_by: 'usr_platform_tflags',
      },
    ]);
    // app.feature_flag is byte-for-byte what it was: no GLOBAL row, no TENANT default, no version moved
    expect(await flagTable()).toEqual(before);
    // and the change is in the audit trail, written by the same request
    const audit = await env.admin.query(
      `SELECT entity_id FROM app.audit_event WHERE action = 'platform.tenant_flag_set' AND tenant_id = $1`,
      [PLATFORM_TENANT_ID],
    );
    expect(audit.rows.map((r) => r.entity_id)).toEqual([`${env.A.tenantId}:${FLAG}`]);

    const second = await startApi(dbUrl); // a different process with an empty memory
    try {
      const again = await call(second, platformToken, 'GET', `/platform/v1/tenants/${env.A.tenantId}/flags`);
      expect(again.body.data.find((f: { key: string }) => f.key === FLAG)).toMatchObject({
        value: true,
        overridden: true,
        lockVersion: 1,
      });
      // If-Match: the version survived the restart; the old one is stale, the current one works
      const stale = await call(
        second,
        platformToken,
        'PUT',
        `/platform/v1/tenants/${env.A.tenantId}/flags/${FLAG}`,
        { value: false },
        { 'If-Match': '"0"' },
      );
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('VERSION_CONFLICT');
      const noHeader = await call(
        second,
        platformToken,
        'PUT',
        `/platform/v1/tenants/${env.A.tenantId}/flags/${FLAG}`,
        { value: false },
      );
      expect(noHeader.status).toBe(422);
      const ok = await call(
        second,
        platformToken,
        'PUT',
        `/platform/v1/tenants/${env.A.tenantId}/flags/${FLAG}`,
        { value: false },
        { 'If-Match': etag! },
      );
      expect(ok.status, second.log()).toBe(200);
      expect(ok.body).toMatchObject({ value: false, overridden: true, lockVersion: 2 });
    } finally {
      await second.stop();
    }
    expect(await flagTable()).toEqual(before);
  }, 300_000);

  it('TEST-TFLAG-INT-03 a GLOBAL flag cannot be overridden: the route says 404 and the database foreign key refuses it as well', async () => {
    const api = await startApi(dbUrl);
    try {
      const res = await call(
        api,
        platformToken,
        'PUT',
        `/platform/v1/tenants/${env.A.tenantId}/flags/mfa.enforce_all`,
        { value: false },
        { 'If-Match': '"0"' },
      );
      expect(res.status, api.log()).toBe(404);
      const scoped = await call(
        api,
        platformToken,
        'PUT',
        `/platform/v1/tenants/${env.A.tenantId}/flags/${FLAG}`,
        { value: true, scope: 'GLOBAL' },
        { 'If-Match': '"2"' },
      );
      expect(scoped.status).toBe(422);
    } finally {
      await api.stop();
    }
    expect(
      (await env.admin.query(`SELECT 1 FROM app.tenant_feature_flag WHERE key = 'mfa.enforce_all'`)).rows,
    ).toHaveLength(0);
    expect(
      (
        await env.admin.query(
          `SELECT value FROM app.feature_flag WHERE key = 'mfa.enforce_all' AND scope = 'GLOBAL'`,
        )
      ).rows[0].value,
    ).toBe(true);

    // Even the superuser cannot slip a row past the key: the flag must be defined with scope TENANT.
    await expect(
      env.admin.query(
        `INSERT INTO app.tenant_feature_flag (tenant_id, key, value, updated_by) VALUES ($1, 'mfa.enforce_all', false, 'x')`,
        [env.A.tenantId],
      ),
    ).rejects.toThrow(/foreign key|violates/i);
    await expect(
      env.admin.query(
        `INSERT INTO app.tenant_feature_flag (tenant_id, key, scope, value, updated_by) VALUES ($1, $2, 'GLOBAL', false, 'x')`,
        [env.A.tenantId, FLAG],
      ),
    ).rejects.toThrow(/check|violates/i);
  }, 200_000);

  it('TEST-TFLAG-INT-04 a customer tenant is refused on every route, and the policies let it read only its own rows and never write', async () => {
    const api = await startApi(dbUrl);
    try {
      const rows = (
        await env.admin.query(
          `SELECT value, lock_version FROM app.tenant_feature_flag WHERE tenant_id = $1 AND key = $2`,
          [env.A.tenantId, FLAG],
        )
      ).rows[0];
      for (const [method, p, body] of [
        ['GET', `/platform/v1/tenants/${env.A.tenantId}`, undefined],
        ['GET', `/platform/v1/tenants/${env.A.tenantId}/flags`, undefined],
        ['PUT', `/platform/v1/tenants/${env.A.tenantId}/flags/${FLAG}`, { value: true }],
      ] as const) {
        const res = await call(
          api,
          customerToken,
          method,
          p,
          body,
          method === 'PUT' ? { 'If-Match': `"${rows.lock_version}"` } : {},
        );
        expect(res.status, `${method} ${p}`).toBe(403);
      }
      expect(
        (
          await env.admin.query(
            `SELECT value, lock_version FROM app.tenant_feature_flag WHERE tenant_id = $1 AND key = $2`,
            [env.A.tenantId, FLAG],
          )
        ).rows[0],
      ).toEqual(rows);
    } finally {
      await api.stop();
    }

    // The database refuses on its own, as the API's own role (NOBYPASSRLS), whatever the API does.
    await env.admin.query(
      `INSERT INTO app.tenant_feature_flag (tenant_id, key, value, updated_by) VALUES ($1, $2, true, 'seed-b')`,
      [env.B.tenantId, FLAG],
    );
    const asApi = new pg.Client({ connectionString: dbUrl });
    await asApi.connect();
    try {
      const inSession = async <T>(tenantId: string, fn: () => Promise<T>) => {
        await asApi.query('BEGIN');
        try {
          await asApi.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
          return await fn();
        } finally {
          await asApi.query('ROLLBACK');
        }
      };
      // tenant A sees A's row and not B's
      const seenByA = await inSession(env.A.tenantId, async () =>
        (await asApi.query(`SELECT tenant_id FROM app.tenant_feature_flag`)).rows.map((r) => r.tenant_id),
      );
      expect(seenByA).toEqual([env.A.tenantId]);
      // tenant A cannot insert (for itself or anyone), update its own row, or touch B's
      await expect(
        inSession(env.A.tenantId, () =>
          asApi.query(
            `INSERT INTO app.tenant_feature_flag (tenant_id, key, value, updated_by) VALUES ($1, 'x.y', true, 'a')`,
            [env.A.tenantId],
          ),
        ),
      ).rejects.toThrow();
      const updateOwn = await inSession(env.A.tenantId, () =>
        asApi.query(`UPDATE app.tenant_feature_flag SET value = NOT value WHERE tenant_id = $1`, [
          env.A.tenantId,
        ]),
      );
      expect(updateOwn.rowCount).toBe(0);
      const updateB = await inSession(env.A.tenantId, () =>
        asApi.query(`UPDATE app.tenant_feature_flag SET value = NOT value WHERE tenant_id = $1`, [
          env.B.tenantId,
        ]),
      );
      expect(updateB.rowCount).toBe(0);
      // no session at all sees nothing
      await asApi.query('BEGIN');
      expect((await asApi.query(`SELECT 1 FROM app.tenant_feature_flag`)).rowCount).toBe(0);
      await asApi.query('ROLLBACK');
      // the platform realm sees every tenant's row
      const seenByPlatform = await inSession(PLATFORM_TENANT_ID, async () =>
        (await asApi.query(`SELECT tenant_id FROM app.tenant_feature_flag ORDER BY tenant_id`)).rows.map(
          (r) => r.tenant_id,
        ),
      );
      expect(seenByPlatform).toEqual([env.A.tenantId, env.B.tenantId].sort());
      // and nobody, platform included, can delete (NFR-SEC-003)
      await expect(
        inSession(PLATFORM_TENANT_ID, () => asApi.query(`DELETE FROM app.tenant_feature_flag`)),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await asApi.end();
    }
  }, 200_000);

  it('TEST-TFLAG-INT-05 the verify script passes, the rollback refuses while overrides exist and removes the table once empty, and re-applying restores it', async () => {
    const verify = async () =>
      (await env.admin.query(sqlFile('tools/sql/0068/verify.sql'))).rows as {
        check: string;
        result: string;
      }[];
    expect((await verify()).filter((r) => r.result !== 'PASS')).toEqual([]);
    expect(await verify()).toHaveLength(6);

    await expect(env.admin.query(sqlFile('tools/sql/0068/rollback.sql'))).rejects.toThrow(
      /rollback 0068 refused: \d+ tenant flag override/,
    );
    await env.admin.query('ROLLBACK').catch(() => undefined);
    expect(
      (await env.admin.query(`SELECT count(*)::int AS n FROM app.tenant_feature_flag`)).rows[0].n,
    ).toBeGreaterThan(0);

    await env.admin.query(`DELETE FROM app.tenant_feature_flag`);
    await env.admin.query(sqlFile('tools/sql/0068/rollback.sql'));
    expect(
      (await env.admin.query(`SELECT to_regclass('app.tenant_feature_flag') AS t`)).rows[0].t,
    ).toBeNull();
    // feature_flag is exactly as 0046 and 0050 left it
    expect(
      (
        await env.admin.query(
          `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'app' AND tablename = 'feature_flag'`,
        )
      ).rows[0].n,
    ).toBe(3);

    await env.admin.query(sqlFile('supabase/migrations/20261001000068_tenant_feature_flag_overrides.sql'));
    await env.admin.query(sqlFile('supabase/migrations/20261001000068_tenant_feature_flag_overrides.sql')); // idempotent
    expect((await verify()).filter((r) => r.result !== 'PASS')).toEqual([]);
  }, 200_000);
});
