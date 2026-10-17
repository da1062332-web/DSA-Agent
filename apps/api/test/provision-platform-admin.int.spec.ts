// Provisioning the first platform operator, against a real database (owner: Dev 1; MODULE 1 platform realm).
// Runs on a throwaway local PostgreSQL with a fake Supabase Admin API; it never touches the hosted project or Supabase Auth.
// Proves: a dry run writes nothing; apply creates the account without a password; the provisioned user really resolves to the platform
// grants (through the same resolver the API uses) and needs MFA; it is repeatable and recovers a half-finished run; an account that
// belongs to another tenant is never touched; a database failure removes the Auth account the run created.
import { PLATFORM_TENANT_ID, isPlatformRealm, PLATFORM_PERMISSIONS } from '@dsa/contracts';
import { createPrincipalResolver, requiresMfa } from '@dsa/kernel';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import {
  ProvisionError,
  provisionPlatformAdmin,
  type AuthAdmin,
} from '../../../tools/provision-platform-admin';

let env: IsolationEnv;
let tool: pg.Client; // connects as dsa_api, like the real tool, so row-level security applies

beforeAll(async () => {
  env = await startIsolationEnv();
  tool = new pg.Client({
    host: env.admin.host,
    port: env.admin.port,
    database: env.admin.database,
    user: 'dsa_api',
    password: 'isolation',
  });
  await tool.connect();
}, 180_000);
afterAll(async () => {
  await tool?.end();
  await env?.stop();
});

// One counter for the whole file: every fake account gets a distinct id, as Supabase Auth would give.
let authSeq = 0;

/** In-memory stand-in for the Supabase Admin API that records every call. */
class FakeAuth implements AuthAdmin {
  users = new Map<string, { id: string; email: string; app_metadata: Record<string, unknown> }>();
  created: Record<string, unknown>[] = [];
  deleted: string[] = [];
  async listUsers(page: number, perPage: number) {
    const all = [...this.users.values()];
    return { users: all.slice((page - 1) * perPage, page * perPage) };
  }
  async createUser(input: {
    email: string;
    email_confirm: boolean;
    app_metadata: Record<string, unknown>;
    user_metadata: Record<string, unknown>;
  }) {
    this.created.push(input);
    const id = `00000000-0000-4000-8000-${String((authSeq += 1)).padStart(12, '0')}`;
    this.users.set(id, { id, email: input.email, app_metadata: input.app_metadata });
    return { id };
  }
  async inviteUser(email: string) {
    return this.createUser({ email, email_confirm: true, app_metadata: {}, user_metadata: {} });
  }
  async setAppMetadata(id: string, app_metadata: Record<string, unknown>) {
    this.users.get(id)!.app_metadata = app_metadata;
  }
  async generateRecoveryLink(email: string) {
    return `https://auth.invalid/recover?for=${encodeURIComponent(email)}&token=fake-one-time-token`;
  }
  async deleteUser(id: string) {
    this.deleted.push(id);
    this.users.delete(id);
  }
}

const base = {
  displayName: 'Priya Platform',
  role: 'superadmin' as const,
  apply: true,
  delivery: 'link' as const,
};
const rows = async (sql: string, params: unknown[] = []) => (await env.admin.query(sql, params)).rows;

describe('TEST-PROV provisioning a platform operator', () => {
  it('TEST-PROV-01 a dry run reports the plan and writes nothing to Auth or the database', async () => {
    const auth = new FakeAuth();
    const result = await provisionPlatformAdmin(auth, tool, {
      ...base,
      email: 'dry@platform.test',
      apply: false,
    });
    expect(result).toMatchObject({
      mode: 'DRY_RUN',
      authUser: 'WOULD_CREATE',
      appUser: 'WOULD_CREATE',
      roleAssignment: 'WOULD_CREATE',
    });
    expect(auth.users.size).toBe(0);
    expect(await rows(`select 1 from app.app_user where email = 'dry@platform.test'`)).toHaveLength(0);
  });

  it('TEST-PROV-02 apply creates a password-less account bound to the platform tenant, plus the user, branch and role assignment', async () => {
    const auth = new FakeAuth();
    const result = await provisionPlatformAdmin(auth, tool, { ...base, email: 'Priya@Platform.test' });
    expect(result).toMatchObject({
      mode: 'APPLIED',
      authUser: 'CREATED',
      appUser: 'CREATED',
      roleAssignment: 'CREATED',
      email: 'priya@platform.test',
    });
    expect(result.oneTimeLink).toContain('token=');

    // No password was ever supplied, and the trusted tenant claim is the platform tenant.
    expect(auth.created).toHaveLength(1);
    expect(auth.created[0]).not.toHaveProperty('password');
    expect(auth.created[0]).toMatchObject({
      email: 'priya@platform.test',
      email_confirm: true,
      app_metadata: { tenant_id: PLATFORM_TENANT_ID },
    });

    const user = (
      await rows(
        `select u.id, u.tenant_id, u.idp_subject, u.status, b.code as branch from app.app_user u join app.branch b on b.id = u.primary_branch_id and b.tenant_id = u.tenant_id where u.email = 'priya@platform.test'`,
      )
    )[0];
    expect(user).toMatchObject({
      tenant_id: PLATFORM_TENANT_ID,
      idp_subject: result.authUserId,
      status: 'ACTIVE',
      branch: 'PLATFORM',
    });
    // The hosted app_user also has a legacy password_hash column that no migration creates. It must stay empty.
    if (
      (
        await rows(
          `select 1 from information_schema.columns where table_schema = 'app' and table_name = 'app_user' and column_name = 'password_hash'`,
        )
      ).length > 0
    ) {
      expect(
        (await rows(`select password_hash from app.app_user where email = 'priya@platform.test'`))[0]
          .password_hash,
      ).toBeNull();
    }

    const ura = await rows(
      `select r.code, a.scope_type, a.created_by, a.user_id, a.effective_range @> now() as active from app.user_role_assignment a join app.role r on r.id = a.role_id where a.user_id = $1`,
      [user.id],
    );
    expect(ura).toEqual([
      {
        code: 'ROLE-PLATFORM-SUPERADMIN',
        scope_type: 'TENANT',
        created_by: 'SYSTEM:provision-platform-admin',
        user_id: user.id,
        active: true,
      },
    ]);
    expect(ura[0].created_by).not.toBe(user.id); // SOD-05
  });

  it('TEST-PROV-03 the provisioned user resolves, through the API resolver, to exactly the platform grants and must use MFA', async () => {
    const auth = new FakeAuth();
    const result = await provisionPlatformAdmin(auth, tool, { ...base, email: 'resolve@platform.test' });
    const principal = await createPrincipalResolver(createTxRunner(env.db)).resolve(
      { subject: result.authUserId!, tenantId: PLATFORM_TENANT_ID, aal: 'aal1', mfaVerifiedAt: null },
      { correlationId: 'corr-prov', now: new Date() },
    );
    expect(principal.tenantId).toBe(PLATFORM_TENANT_ID);
    expect(isPlatformRealm(principal)).toBe(true);
    expect(principal.grants.map((g) => g.code).sort()).toEqual(
      [...PLATFORM_PERMISSIONS, 'audit.read'].sort(),
    );
    expect(principal.grants.every((g) => g.scope === 'TENANT')).toBe(true);
    expect(requiresMfa(principal)).toBe(true); // the API refuses every call (except GET /v1/me) until TOTP is enrolled
    // No tenant permission comes with it.
    expect(
      principal.grants.some((g) => g.code === 'config.manage' || g.code === 'data_correction.approve'),
    ).toBe(false);
  });

  it('TEST-PROV-04 the support role gets only metadata and support-access permissions', async () => {
    const result = await provisionPlatformAdmin(new FakeAuth(), tool, {
      ...base,
      email: 'support@platform.test',
      role: 'support',
    });
    const principal = await createPrincipalResolver(createTxRunner(env.db)).resolve(
      { subject: result.authUserId!, tenantId: PLATFORM_TENANT_ID, aal: 'aal1', mfaVerifiedAt: null },
      { correlationId: 'corr-prov-2', now: new Date() },
    );
    expect(principal.grants.map((g) => g.code).sort()).toEqual([
      'platform.console',
      'platform.support_access',
    ]);
  });

  it('TEST-PROV-05 running it again changes nothing; --new-link reissues only the link', async () => {
    const auth = new FakeAuth();
    const first = await provisionPlatformAdmin(auth, tool, { ...base, email: 'again@platform.test' });
    const second = await provisionPlatformAdmin(auth, tool, { ...base, email: 'again@platform.test' });
    expect(second).toMatchObject({
      authUser: 'REUSED',
      appUser: 'EXISTS',
      roleAssignment: 'EXISTS',
      authUserId: first.authUserId,
      appUserId: first.appUserId,
    });
    expect(second.oneTimeLink).toBeUndefined();
    const third = await provisionPlatformAdmin(auth, tool, {
      ...base,
      email: 'again@platform.test',
      newLink: true,
    });
    expect(third.oneTimeLink).toContain('token=');
    expect(await rows(`select 1 from app.app_user where email = 'again@platform.test'`)).toHaveLength(1);
    expect(
      await rows(`select 1 from app.user_role_assignment where user_id = $1`, [first.appUserId]),
    ).toHaveLength(1);
  });

  it('TEST-PROV-06 a run that stopped after creating the Auth account is completed by running it again', async () => {
    const auth = new FakeAuth();
    await auth.createUser({
      email: 'half@platform.test',
      email_confirm: true,
      app_metadata: { tenant_id: PLATFORM_TENANT_ID },
      user_metadata: {},
    });
    const result = await provisionPlatformAdmin(auth, tool, { ...base, email: 'half@platform.test' });
    expect(result).toMatchObject({ authUser: 'REUSED', appUser: 'CREATED', roleAssignment: 'CREATED' });
    expect(auth.deleted).toEqual([]); // the pre-existing account is never deleted
  });

  it('TEST-PROV-07 an Auth account that belongs to another tenant, or to none, is refused and left untouched', async () => {
    const auth = new FakeAuth();
    await auth.createUser({
      email: 'taken@platform.test',
      email_confirm: true,
      app_metadata: { tenant_id: env.A.tenantId },
      user_metadata: {},
    });
    await auth.createUser({
      email: 'notenant@platform.test',
      email_confirm: true,
      app_metadata: {},
      user_metadata: {},
    });
    await expect(
      provisionPlatformAdmin(auth, tool, { ...base, email: 'taken@platform.test' }),
    ).rejects.toThrow(/never changes another tenant/);
    await expect(
      provisionPlatformAdmin(auth, tool, { ...base, email: 'notenant@platform.test' }),
    ).rejects.toThrow(ProvisionError);
    expect([...auth.users.values()].find((u) => u.email === 'taken@platform.test')!.app_metadata).toEqual({
      tenant_id: env.A.tenantId,
    });
    expect(auth.deleted).toEqual([]);
    expect(
      await rows(
        `select 1 from app.app_user where email in ('taken@platform.test','notenant@platform.test')`,
      ),
    ).toHaveLength(0);
  });

  it('TEST-PROV-08 if the database step fails, the Auth account created by this run is deleted and nothing is left behind', async () => {
    const auth = new FakeAuth();
    // A platform role that does not exist makes the prerequisites fail before anything is created...
    await env.admin.query(
      `update app.role set code = 'ROLE-PLATFORM-SUPPORT-OFF' where tenant_id = $1 and code = 'ROLE-PLATFORM-SUPPORT'`,
      [PLATFORM_TENANT_ID],
    );
    await expect(
      provisionPlatformAdmin(auth, tool, { ...base, email: 'norole@platform.test', role: 'support' }),
    ).rejects.toThrow(/does not exist in the platform tenant/);
    await env.admin.query(
      `update app.role set code = 'ROLE-PLATFORM-SUPPORT' where tenant_id = $1 and code = 'ROLE-PLATFORM-SUPPORT-OFF'`,
      [PLATFORM_TENANT_ID],
    );
    expect(auth.users.size).toBe(0);

    // ...and a failure inside the transaction (a clashing user id) rolls back and removes the account this run created.
    const flaky = new pg.Client({
      host: env.admin.host,
      port: env.admin.port,
      database: env.admin.database,
      user: 'dsa_api',
      password: 'isolation',
    });
    await flaky.connect();
    const realQuery = flaky.query.bind(flaky) as (...a: unknown[]) => Promise<unknown>;
    (flaky as unknown as { query: (...a: unknown[]) => Promise<unknown> }).query = (...a: unknown[]) => {
      if (typeof a[0] === 'string' && a[0].includes('insert into user_role_assignment'))
        return Promise.reject(new Error('simulated database failure'));
      return realQuery(...a);
    };
    await expect(
      provisionPlatformAdmin(auth, flaky, { ...base, email: 'fails@platform.test' }),
    ).rejects.toThrow(/simulated database failure/);
    await flaky.end();
    expect(auth.deleted).toHaveLength(1);
    expect(auth.users.size).toBe(0);
    expect(await rows(`select 1 from app.app_user where email = 'fails@platform.test'`)).toHaveLength(0); // the transaction rolled back
  });

  it('TEST-PROV-09 it refuses to run before migration 0050: no platform tenant means no changes', async () => {
    const auth = new FakeAuth();
    await env.admin.query(`update app.tenant set status = 'SUSPENDED' where id = $1`, [PLATFORM_TENANT_ID]);
    await expect(
      provisionPlatformAdmin(auth, tool, { ...base, email: 'early@platform.test' }),
    ).rejects.toThrow(/platform tenant is missing or not ACTIVE/);
    await env.admin.query(`update app.tenant set status = 'ACTIVE' where id = $1`, [PLATFORM_TENANT_ID]);
    expect(auth.users.size).toBe(0);
  });

  it('TEST-PROV-10 bad input is refused before anything happens', async () => {
    const auth = new FakeAuth();
    await expect(provisionPlatformAdmin(auth, tool, { ...base, email: 'not-an-email' })).rejects.toThrow(
      /e-mail address is not valid/,
    );
    await expect(
      provisionPlatformAdmin(auth, tool, { ...base, email: 'ok@platform.test', displayName: 'x' }),
    ).rejects.toThrow(/display name/);
    expect(auth.users.size).toBe(0);
  });
});
