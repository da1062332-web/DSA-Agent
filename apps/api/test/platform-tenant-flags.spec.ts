// Per-tenant feature flags in the platform console (owner: Platform squad; Module 1 / MOD-ADM SUB-ADM.02).
// A platform operator opens one tenant and sets its overrides of the TENANT-scope flags. These tests pin: which tenant is selected, that a
// tenant-scoped change touches that tenant's override only (never a GLOBAL flag, the TENANT default, or another tenant), that every call is
// refused outside the platform realm, and that a stale If-Match is a 409. The database side (row-level security, the foreign key, the
// real table) is in platform-tenant-flags.int.spec.ts.
import {
  PLATFORM_TENANT_ID,
  type AuditEventInput,
  type PlatformTenantSummary,
  type RequestContext,
  type Tx,
  type TxRunner,
} from '@dsa/contracts';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../src/http/error-handler';
import { PlatformAdminService } from '../src/modules/platform-admin/platform-admin-service';
import { InMemoryPlatformStore } from '../src/modules/platform-admin/platform-store';
import { createRouter } from '../src/modules/platform-admin/router';
import { createTestDeps, fakeAuth, testPrincipal } from './support/fake-auth';

const tenant = (id: string, slug: string): PlatformTenantSummary => ({
  id,
  slug,
  legalName: `${slug} Pvt Ltd`,
  tenantType: 'DSA_ORG',
  dataRegion: 'IN',
  timezone: 'Asia/Kolkata',
  status: 'ACTIVE',
  createdAt: '2026-10-01T00:00:00.000Z',
  createdBy: 'SYSTEM:platform',
  healthStatus: 'HEALTHY',
  activeUsersCount: 5,
  applicationsCount: null,
  entitlements: [],
});

const grant = (code: string) => ({ code, scope: 'TENANT' as const, branchIds: [] });

const operator = testPrincipal({
  id: 'usr_operator_01',
  tenantId: PLATFORM_TENANT_ID,
  grants: ['platform.console', 'platform.flags'].map(grant),
});
/** A support operator: may look at a tenant, may not touch flags. */
const supportOnly = testPrincipal({
  id: 'usr_support_01',
  tenantId: PLATFORM_TENANT_ID,
  grants: [grant('platform.console')],
});
/** The bug the realm model closes: a customer tenant's administrator that holds the platform permission codes. */
const tenantAdminWithPlatformCodes = testPrincipal({
  id: 'usr_tenant_admin_98',
  tenantId: 'ten_alpha',
  grants: ['platform.console', 'platform.flags', 'config.manage'].map(grant),
});
const salesUser = testPrincipal({ id: 'usr_sales_01', tenantId: 'ten_alpha', grants: [grant('lead.read')] });

/** A fresh store, service and audit log per test, so no test depends on another's writes. */
function setup(principal = operator) {
  const auditLog: AuditEventInput[] = [];
  const txRunner: TxRunner = {
    async withTenantTx<T>(_ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
      return fn({} as Tx);
    },
  };
  const deps = createTestDeps({
    txRunner,
    audit: {
      async record(_tx: Tx, _ctx: RequestContext, e: AuditEventInput): Promise<string> {
        auditLog.push(e);
        return 'aud_test';
      },
    },
  });
  const store = new InMemoryPlatformStore();
  store.tenants.push(tenant('ten_alpha', 'alpha'), tenant('ten_beta', 'beta'));
  const service = new PlatformAdminService(deps, store);
  const appFor = (p = principal) => {
    const app = express();
    app.use(express.json());
    app.use(fakeAuth(p));
    app.use(createRouter(deps, service));
    app.use(errorHandler());
    return app;
  };
  return { store, auditLog, appFor, app: appFor() };
}

const FLAG = 'crm.lead_auto_qualify'; // TENANT scope, default false in the unit-test store (the database gets it from migration 0058)
const tenantFlags = (app: express.Express, id: string) =>
  request(app).get(`/platform/v1/tenants/${id}/flags`);
const putTenantFlag = (app: express.Express, id: string, key: string, body: unknown, ifMatch?: string) => {
  const r = request(app).put(`/platform/v1/tenants/${id}/flags/${key}`);
  if (ifMatch !== undefined) r.set('If-Match', ifMatch);
  return r.send(body as object);
};
const globalRows = async (app: express.Express) =>
  (await request(app).get('/platform/v1/flags')).body.data as {
    key: string;
    scope: string;
    value: boolean;
    lockVersion: number;
  }[];

describe('TEST-TFLAG per-tenant feature flags', () => {
  it('TEST-TFLAG-01 selecting a tenant returns that tenant only, and an unknown tenant is a 404', async () => {
    const { app, auditLog } = setup();
    const alpha = await request(app).get('/platform/v1/tenants/ten_alpha');
    expect(alpha.status).toBe(200);
    expect(alpha.body).toMatchObject({ id: 'ten_alpha', slug: 'alpha' });
    expect(alpha.body).not.toHaveProperty('leads');
    const beta = await request(app).get('/platform/v1/tenants/ten_beta');
    expect(beta.body).toMatchObject({ id: 'ten_beta', slug: 'beta' });

    const unknown = await request(app).get('/platform/v1/tenants/ten_missing');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('NOT_FOUND');
    // Looking at a tenant across the realm boundary is written to the audit trail.
    expect(auditLog.filter((e) => e.action === 'platform.tenant_viewed').map((e) => e.entityId)).toEqual([
      'ten_alpha',
      'ten_beta',
    ]);
  });

  it('TEST-TFLAG-02 the tenant page lists TENANT-scope flags only, as default plus override, for the selected tenant', async () => {
    const { app } = setup();
    const res = await tenantFlags(app, 'ten_alpha');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const f of res.body.data) {
      expect(f).toMatchObject({ tenantId: 'ten_alpha', scope: 'TENANT', overridden: false, lockVersion: 0 });
      expect(f.value).toBe(f.defaultValue);
    }
    const keys = res.body.data.map((f: { key: string }) => f.key);
    expect(keys).toContain(FLAG);
    expect(keys).not.toContain('bre.v2_engine'); // a GLOBAL flag is not a tenant flag
    expect(keys).not.toContain('mfa.enforce_all');
    expect((await tenantFlags(app, 'ten_missing')).status).toBe(404);
  });

  it('TEST-TFLAG-03 a tenant-scoped update changes that tenant only: not the GLOBAL flags, not the TENANT default, not another tenant', async () => {
    const { app, store } = setup();
    const globalBefore = await globalRows(app);
    const defaultBefore = globalBefore.find((f) => f.key === FLAG && f.scope === 'TENANT')!;
    expect(defaultBefore.value).toBe(false);

    const put = await putTenantFlag(app, 'ten_alpha', FLAG, { value: true }, '"0"');
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      tenantId: 'ten_alpha',
      key: FLAG,
      scope: 'TENANT',
      value: true,
      defaultValue: false,
      overridden: true,
      lockVersion: 1,
      updatedBy: 'usr_operator_01',
    });
    expect(put.headers.etag).toBe('"1"');

    // Alpha sees the override; Beta still sees the default.
    const alphaFlag = (await tenantFlags(app, 'ten_alpha')).body.data.find(
      (f: { key: string }) => f.key === FLAG,
    );
    const betaFlag = (await tenantFlags(app, 'ten_beta')).body.data.find(
      (f: { key: string }) => f.key === FLAG,
    );
    expect(alphaFlag).toMatchObject({ value: true, overridden: true });
    expect(betaFlag).toMatchObject({ tenantId: 'ten_beta', value: false, overridden: false, lockVersion: 0 });

    // The shared flag table is exactly as it was: every GLOBAL row and the TENANT default row, value and version.
    expect(await globalRows(app)).toEqual(globalBefore);
    expect(store.audit).toContain('platform.tenant_flag_set');
  });

  it('TEST-TFLAG-04 global and tenant stay separate: the old route cannot set a tenant override, the new route cannot reach a global flag', async () => {
    const { app } = setup();
    // 1. Changing the GLOBAL flag through the existing route leaves tenant overrides alone.
    await putTenantFlag(app, 'ten_alpha', FLAG, { value: true }, '0');
    const g = await request(app)
      .put('/platform/v1/flags/bre.v2_engine')
      .send({ scope: 'GLOBAL', value: false });
    expect(g.status).toBe(200);
    const alphaFlag = (await tenantFlags(app, 'ten_alpha')).body.data.find(
      (f: { key: string }) => f.key === FLAG,
    );
    expect(alphaFlag).toMatchObject({ value: true, overridden: true, lockVersion: 1 });

    // 2. A GLOBAL key through the tenant route is not found, and its value does not move.
    const viaTenant = await putTenantFlag(app, 'ten_alpha', 'mfa.enforce_all', { value: false }, '0');
    expect(viaTenant.status).toBe(404);
    expect(viaTenant.body.error.code).toBe('NOT_FOUND');
    const mfa = (await globalRows(app)).find((f) => f.key === 'mfa.enforce_all')!;
    expect(mfa.value).toBe(true);

    // 3. The body cannot choose a scope or a tenant: it is a 422 and nothing is written.
    for (const body of [
      { value: false, scope: 'GLOBAL' },
      { value: false, scope: 'TENANT' },
      { value: false, tenantId: 'ten_beta' },
    ]) {
      const res = await putTenantFlag(app, 'ten_alpha', FLAG, body, '"1"');
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    const stillAlpha = (await tenantFlags(app, 'ten_alpha')).body.data.find(
      (f: { key: string }) => f.key === FLAG,
    );
    expect(stillAlpha).toMatchObject({ value: true, lockVersion: 1 });
    const beta = (await tenantFlags(app, 'ten_beta')).body.data.find((f: { key: string }) => f.key === FLAG);
    expect(beta).toMatchObject({ overridden: false });
  });

  it('TEST-TFLAG-05 a non-boolean value, an unknown flag and an unknown tenant are refused and write nothing', async () => {
    const { app, store } = setup();
    expect((await putTenantFlag(app, 'ten_alpha', FLAG, { value: 'yes' }, '0')).status).toBe(422);
    expect((await putTenantFlag(app, 'ten_alpha', FLAG, {}, '0')).status).toBe(422);
    expect((await putTenantFlag(app, 'ten_alpha', 'no.such_flag', { value: true }, '0')).status).toBe(404);
    expect((await putTenantFlag(app, 'ten_missing', FLAG, { value: true }, '0')).status).toBe(404);
    expect(store.audit).not.toContain('platform.tenant_flag_set');
    const f = (await tenantFlags(app, 'ten_alpha')).body.data.find((x: { key: string }) => x.key === FLAG);
    expect(f.overridden).toBe(false);
  });

  it('TEST-TFLAG-06 optimistic concurrency: If-Match is required, a stale version is a 409 that changes nothing, the current one succeeds', async () => {
    const { app } = setup();
    // required
    const missing = await putTenantFlag(app, 'ten_alpha', FLAG, { value: true });
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');
    expect((await putTenantFlag(app, 'ten_alpha', FLAG, { value: true }, 'abc')).status).toBe(422);

    // first write: the version the operator saw is 0
    const first = await putTenantFlag(app, 'ten_alpha', FLAG, { value: true }, '"0"');
    expect(first.status).toBe(200);
    expect(first.body.lockVersion).toBe(1);

    // a second operator still holding version 0 loses
    const stale = await putTenantFlag(app, 'ten_alpha', FLAG, { value: false }, '"0"');
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect(stale.body.error.message).toContain('Current version: 1');
    let f = (await tenantFlags(app, 'ten_alpha')).body.data.find((x: { key: string }) => x.key === FLAG);
    expect(f).toMatchObject({ value: true, lockVersion: 1 });

    // a wrong future version also loses
    expect((await putTenantFlag(app, 'ten_alpha', FLAG, { value: false }, '"999"')).status).toBe(409);

    // the current version wins and moves the version on
    const second = await putTenantFlag(app, 'ten_alpha', FLAG, { value: false }, first.headers.etag);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ value: false, overridden: true, lockVersion: 2 });
    f = (await tenantFlags(app, 'ten_alpha')).body.data.find((x: { key: string }) => x.key === FLAG);
    expect(f.lockVersion).toBe(2);
  });

  it('TEST-TFLAG-07 only a platform operator: tenant users, tenant admins holding platform codes, support-only operators and anonymous callers are refused', async () => {
    const { appFor, auditLog, store } = setup();
    const calls: [string, string, unknown?][] = [
      ['get', '/platform/v1/tenants/ten_alpha'],
      ['get', '/platform/v1/tenants/ten_alpha/flags'],
      ['put', `/platform/v1/tenants/ten_alpha/flags/${FLAG}`, { value: true }],
    ];
    const send = (app: express.Express, [method, path, body]: [string, string, unknown?]) => {
      const r = (request(app) as unknown as Record<string, (p: string) => request.Test>)[method]!(path);
      if (method === 'put') r.set('If-Match', '0');
      return r.send((body ?? {}) as object);
    };

    for (const principal of [tenantAdminWithPlatformCodes, salesUser]) {
      for (const call of calls) {
        const res = await send(appFor(principal), call);
        expect(res.status, `${principal.id} ${call[0]} ${call[1]}`).toBe(403);
      }
    }
    // A refusal on a platform route is itself audited, with the permission that was wanted.
    expect(
      auditLog.some((e) => e.action === 'platform.access_denied' && e.permissionUsed === 'platform.flags'),
    ).toBe(true);

    // Support access: the overview opens, the flags do not.
    const support = appFor(supportOnly);
    expect((await send(support, calls[0]!)).status).toBe(200);
    expect((await send(support, calls[1]!)).status).toBe(403);
    expect((await send(support, calls[2]!)).status).toBe(403);

    // No session at all.
    const anonymous = express();
    anonymous.use(express.json());
    anonymous.use(createRouter(createTestDeps({}), new PlatformAdminService(createTestDeps({}), store)));
    anonymous.use(errorHandler());
    for (const call of calls) expect((await send(anonymous, call)).status, call[1]).toBe(401);

    // Nothing was written by any refused call.
    expect(store.audit).not.toContain('platform.tenant_flag_set');
    const f = (await tenantFlags(appFor(), 'ten_alpha')).body.data.find(
      (x: { key: string }) => x.key === FLAG,
    );
    expect(f.overridden).toBe(false);
  });
});
