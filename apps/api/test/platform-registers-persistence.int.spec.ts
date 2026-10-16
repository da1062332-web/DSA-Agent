// Master data and the release register survive an API restart (owner: Dev 1; Modules 1 and 40). The REAL server process is started, stopped and
// started again against one throwaway database; the caller is a platform-realm user with the platform role from migration 0050.
import { PLATFORM_TENANT_ID } from '@dsa/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintTestToken } from '../../../packages/kernel/src/testing/test-token';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import { apiRoleUrl, call, LOCAL_JWT_SECRET, LOCAL_SUPABASE_URL, startApi } from './support/spawn-api';

let env: IsolationEnv;
let dbUrl: string;
let platformToken: string;
let customerToken: string;

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
     VALUES ('usr_platform_regs', $1, 'sub-platform-regs', 'operator2@platform.example.com', 'Platform Operator', $2, 'iso', 'iso')`,
    [PLATFORM_TENANT_ID, branch],
  );
  await env.admin.query(
    `INSERT INTO app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, created_by) VALUES ('ura_platform_regs', $1, 'usr_platform_regs', $2, 'TENANT', 'iso')`,
    [PLATFORM_TENANT_ID, role],
  );
  platformToken = await mintTestToken({
    supabaseUrl: LOCAL_SUPABASE_URL,
    jwtSecret: LOCAL_JWT_SECRET,
    sub: 'sub-platform-regs',
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

describe('master data survives a restart of the real server', () => {
  it('TEST-REGISTERS-01 the baseline lists are there, an import is kept across a restart, a dry run writes nothing, and versions advance', async () => {
    const first = await startApi(dbUrl);
    try {
      const all = await call(first, platformToken, 'GET', '/platform/v1/master-data');
      expect(all.status, first.log()).toBe(200);
      expect(Object.keys(all.body.data)).toEqual(
        expect.arrayContaining([
          'STATES',
          'OCCUPATIONS',
          'REASON_CODES',
          'PINCODES',
          'LOAN_CATEGORIES',
          'KYC_DOCUMENT_TYPES',
        ]),
      );
      expect(all.body.data.STATES.map((i: { code: string }) => i.code)).toEqual(
        expect.arrayContaining(['MH', 'KA', 'DL', 'TN']),
      );

      const dry = await call(first, platformToken, 'POST', '/platform/v1/master-data/imports', {
        listCode: 'states',
        dryRun: true,
        items: [
          { code: 'GJ', label: 'Gujarat', attributes: { gstCode: '24' } },
          { code: 'MH', label: 'Maharashtra (renamed)' },
        ],
      });
      expect(dry.status, first.log()).toBe(200);
      expect(dry.body).toMatchObject({ dryRun: true, newItemsCount: 1, updatedItemsCount: 1 });
      expect(
        (await env.admin.query(`SELECT 1 FROM app.master_data_item WHERE dataset = 'states' AND code = 'GJ'`))
          .rows,
      ).toHaveLength(0);

      const real = await call(first, platformToken, 'POST', '/platform/v1/master-data/imports', {
        listCode: 'STATES',
        items: [
          { code: 'GJ', label: 'Gujarat', attributes: { gstCode: '24' } },
          { code: 'MH', label: 'Maharashtra (renamed)' },
        ],
      });
      expect(real.status, first.log()).toBe(201);
      expect(real.body).toMatchObject({ dryRun: false, newItemsCount: 1, updatedItemsCount: 1 });
    } finally {
      await first.stop();
    }

    const second = await startApi(dbUrl);
    try {
      const body = (await call(second, platformToken, 'GET', '/platform/v1/master-data?listCode=STATES'))
        .body;
      const states = body.data.STATES as Array<{
        code: string;
        label: string;
        version: number;
        attributes: Record<string, unknown>;
      }>;
      expect(states.find((i) => i.code === 'GJ')).toMatchObject({
        label: 'Gujarat',
        version: 1,
        attributes: { gstCode: '24' },
      });
      expect(states.find((i) => i.code === 'MH')).toMatchObject({
        label: 'Maharashtra (renamed)',
        version: 2,
      });
      expect(states.find((i) => i.code === 'KA')).toMatchObject({ version: 1 }); // untouched
    } finally {
      await second.stop();
    }
    const audited = await env.admin.query(
      `SELECT actor_id FROM app.audit_event WHERE action = 'platform.master_data_imported'`,
    );
    expect(audited.rows.map((r) => r.actor_id)).toEqual(['usr_platform_regs']); // the real import is audited, the dry run is not
  }, 300_000);

  it('TEST-REGISTERS-02 a customer-tenant user cannot import master data, and nothing is written', async () => {
    const api = await startApi(dbUrl);
    try {
      const res = await call(api, customerToken, 'POST', '/platform/v1/master-data/imports', {
        listCode: 'states',
        items: [{ code: 'XX', label: 'Nowhere' }],
      });
      expect(res.status).toBe(403);
    } finally {
      await api.stop();
    }
    expect(
      (await env.admin.query(`SELECT 1 FROM app.master_data_item WHERE dataset = 'states' AND code = 'XX'`))
        .rows,
    ).toHaveLength(0);
  }, 200_000);
});

describe('the release register survives a restart of the real server', () => {
  it('TEST-REGISTERS-03 no gate is passed until an operator records it, and what they record is still there after a restart, with a version and an audit trail', async () => {
    const first = await startApi(dbUrl);
    let etag: string;
    try {
      const list = await call(first, platformToken, 'GET', '/platform/v1/releases');
      expect(list.status, first.log()).toBe(200);
      expect(list.body.candidate).toBe('v0.1.0-rc.1');
      expect(list.body.releases[0].gates).toEqual({
        rel001: false,
        rel002: false,
        rel003: false,
        rel004: false,
      });
      etag = `"${list.body.releases[0].lockVersion}"`;

      const put = await call(
        first,
        platformToken,
        'PUT',
        '/platform/v1/releases/v0.1.0-rc.1',
        { gates: { rel001: true, rel002: true }, gitTag: 'v0.1.0-rc.1' },
        { 'If-Match': etag },
      );
      expect(put.status, first.log()).toBe(200);
      expect(put.body.gates).toEqual({ rel001: true, rel002: true, rel003: false, rel004: false });
    } finally {
      await first.stop();
    }

    const second = await startApi(dbUrl);
    try {
      const release = (await call(second, platformToken, 'GET', '/platform/v1/releases')).body.releases[0];
      expect(release).toMatchObject({
        gitTag: 'v0.1.0-rc.1',
        gates: { rel001: true, rel002: true, rel003: false, rel004: false },
      });
      expect(release.lockVersion).toBeGreaterThan(1);
      const stale = await call(
        second,
        platformToken,
        'PUT',
        '/platform/v1/releases/v0.1.0-rc.1',
        { status: 'PUBLISHED' },
        { 'If-Match': etag },
      );
      expect(stale.status).toBe(409);
    } finally {
      await second.stop();
    }
    const trail = await env.admin.query(
      `SELECT actor_id, before, after FROM app.audit_event WHERE action = 'release.updated' AND entity_id = 'v0.1.0-rc.1'`,
    );
    expect(trail.rows).toHaveLength(1);
    expect(trail.rows[0].before.gates.rel001).toBe(false);
    expect(trail.rows[0].after.gates.rel001).toBe(true);
    expect(trail.rows[0].actor_id).toBe('usr_platform_regs');
  }, 300_000);

  it('TEST-REGISTERS-04 a customer-tenant user can neither read nor change the release register', async () => {
    const api = await startApi(dbUrl);
    try {
      expect((await call(api, customerToken, 'GET', '/platform/v1/releases')).status).toBe(403);
      expect(
        (await call(api, customerToken, 'PUT', '/platform/v1/releases/v0.1.0-rc.1', { status: 'PUBLISHED' }))
          .status,
      ).toBe(403);
    } finally {
      await api.stop();
    }
    expect(
      (await env.admin.query(`SELECT status FROM app.platform_release WHERE version = 'v0.1.0-rc.1'`)).rows[0]
        .status,
    ).toBe('CANDIDATE');
  }, 200_000);
});
