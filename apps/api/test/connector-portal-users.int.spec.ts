// Connector portal users against a real database: invitation through the standard pipeline (INVITED, placeholder subject, a QUEUED
// staff_invitation row), delivery by the real provisioning worker with an in-memory Auth admin, activation only on the invitee's first
// password sign-in, resend, revocation, suspension and reactivation, and who may do each. No role is ever assigned. Synthetic data only.
import crypto, { randomUUID } from 'node:crypto';
import type { PermissionCode, Principal } from '@dsa/contracts';
import { createPrincipalResolver } from '@dsa/kernel';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import type { AuthAccount, AuthAdminPort } from '../src/provisioning/auth-admin';
import { runInvitationDeliveries } from '../src/provisioning/invitation-delivery';
import { createProductionDeps } from '../src/wiring';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import { fakeAuth, testPrincipal } from './support/fake-auth';

/** Supabase Auth in memory: accounts and the e-mails it was asked to send. */
class FakeAuth implements AuthAdminPort {
  accounts = new Map<string, AuthAccount>();
  emails: string[] = [];
  async findAccountByEmail(email: string) {
    return [...this.accounts.values()].find((a) => a.email === email.toLowerCase());
  }
  async getAccount(id: string) {
    return this.accounts.get(id);
  }
  async listAccounts() {
    return [...this.accounts.values()];
  }
  async createInvitedAccount(input: {
    email: string;
    displayName: string;
    tenantId: string;
    redirectTo: string;
  }) {
    const account = { id: randomUUID(), email: input.email.toLowerCase(), tenantId: input.tenantId };
    this.accounts.set(account.id, account);
    this.emails.push(input.email);
    return account;
  }
  async sendSetPasswordEmail(input: { email: string; redirectTo: string }) {
    this.emails.push(input.email);
  }
  async deleteAccount(id: string) {
    this.accounts.delete(id);
  }
}

let env: IsolationEnv;
let auth: FakeAuth;
const userId = (suffix: string) => `usr_${'0'.repeat(23)}${suffix}`;
const MANAGER = userId('PM1');
const CON_P = 'con_pu_active';
const CON_T = 'con_pu_terminated';
const CON_O = 'con_pu_other';
const h = (s: string) => crypto.createHash('sha256').update(s).digest();
let seq = 0;
const key = (label: string) => `pu_${label}_${Math.random().toString(36).slice(2, 10)}_${seq++}`;

beforeAll(async () => {
  env = await startIsolationEnv();
  auth = new FakeAuth();
  const a = env.A;
  const q = (text: string, values: unknown[]) => env.admin.query(text, values);
  await q(
    `insert into app.app_user (id, tenant_id, idp_subject, email, display_name, primary_branch_id, created_by, updated_by)
     values ($1, $2, 'sub-pu-mgr', 'mgr@pu.example.com', 'Portal Manager', $3, 'iso', 'iso')`,
    [MANAGER, a.tenantId, a.branchId],
  );
  const connector = (id: string, status: string, n: number) =>
    q(
      `insert into app.connector (id, tenant_id, connector_type, legal_name, contact_person, mobile_e164, mobile_hash, email, email_hash,
                                  encrypted_pan, pan_hash, pan_masked, primary_branch_id, relationship_owner_user_id, status,
                                  created_by, updated_by)
       values ($1, $2, 'INDIVIDUAL', $3, 'Synthetic Contact', $4, $5, $6, $7, $8, $9, 'XXXXX1234X', $10, $11, $12, 'iso', 'iso')`,
      [
        id,
        a.tenantId,
        `Synthetic Portal Partner ${n}`,
        `+91987650070${n}`,
        h(`m-${id}`),
        `${id}@pu.example.com`,
        h(`e-${id}`),
        Buffer.from('synthetic'),
        h(`p-${id}`),
        a.branchId,
        MANAGER,
        status,
      ],
    );
  await connector(CON_P, 'ACTIVE', 1);
  await connector(CON_T, 'TERMINATED', 2);
  await connector(CON_O, 'ACTIVE', 3);
}, 240_000);

afterAll(async () => {
  await env?.stop();
});

const grant = (code: PermissionCode) => ({ code, scope: 'TENANT' as const, branchIds: [] });
const as = (overrides: Partial<Principal>, tenant = () => env.A) =>
  createApp({
    deps: createProductionDeps(createTxRunner(env.db)),
    corsAllowedOrigins: [],
    auth: fakeAuth(
      testPrincipal({
        tenantId: tenant().tenantId,
        primaryBranchId: tenant().branchId,
        authTime: new Date().toISOString(),
        ...overrides,
      }),
    ),
  });
const manager = () => as({ id: MANAGER, grants: [grant('connector.manage'), grant('connector.read')] });
const deliver = () =>
  runInvitationDeliveries({
    txRunner: createTxRunner(env.db),
    audit: env.deps.audit,
    authAdmin: auth,
    redirectTo: 'http://localhost:5173/accept-invitation',
    workerId: 'worker-pu',
  });
const one = async (text: string, params: unknown[]) => (await env.admin.query(text, params)).rows[0];
const invite = (connectorId: string, email: string, displayName: string, idem = key('invite')) =>
  request(manager())
    .post(`/v1/connectors/${connectorId}/users`)
    .set('Idempotency-Key', idem)
    .send({ email, displayName });
const signIn = (subject: string, email: string) =>
  createPrincipalResolver(createTxRunner(env.db)).resolve(
    { subject, tenantId: env.A.tenantId, aal: 'aal1', mfaVerifiedAt: null, email, authMethods: ['password'] },
    { correlationId: `corr_${seq++}`, now: new Date() },
  );

let first = ''; // the portal user taken through the whole lifecycle
let second = ''; // the one whose invitation is withdrawn

describe('connector portal users (TEST-CPU)', () => {
  it('TEST-CPU-01 an invitation creates an INVITED connector login with no role, a placeholder subject and a QUEUED invitation', async () => {
    const res = await invite(CON_P, 'Partner.One@pu.example.com', 'Partner One');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      connectorId: CON_P,
      email: 'partner.one@pu.example.com',
      status: 'INVITED',
      invitation: { state: 'PENDING', deliveryState: 'QUEUED', sentAt: null },
    });
    first = res.body.id;
    const row = await one(
      `select user_type, status, idp_subject, connector_id from app.app_user where id = $1`,
      [first],
    );
    expect(row).toMatchObject({ user_type: 'CONNECTOR', status: 'INVITED', connector_id: CON_P });
    // Not a synthetic identity: the placeholder no token can carry, until the worker binds the real Auth subject.
    expect(row.idp_subject).toBe(`invite:${first}`);
    expect(
      await one(`select status, delivery_state from app.staff_invitation where user_id = $1`, [first]),
    ).toEqual({
      status: 'PENDING',
      delivery_state: 'QUEUED',
    });
    expect(
      (await one(`select count(*)::int as n from app.user_role_assignment where user_id = $1`, [first])).n,
    ).toBe(0);
    expect(
      (
        await one(
          `select count(*)::int as n from app.audit_event where action = 'connector.portal_user_invited' and entity_id = $1`,
          [first],
        )
      ).n,
    ).toBe(1);
  });

  it('TEST-CPU-02 a retried request returns the same login; the same e-mail again, in any case, is refused', async () => {
    const idem = key('replay');
    const created = await invite(CON_P, 'partner.two@pu.example.com', 'Partner Two', idem);
    expect(created.status).toBe(201);
    second = created.body.id;
    const replay = await invite(CON_P, 'partner.two@pu.example.com', 'Partner Two', idem);
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.id).toBe(second);
    const duplicate = await invite(CON_O, 'PARTNER.TWO@pu.example.com', 'Partner Two Again');
    expect(duplicate.status).toBe(422);
    expect(duplicate.body.error.details[0].issue).toBe('DUPLICATE_EMAIL');
    expect(
      (
        await one(
          `select count(*)::int as n from app.app_user where lower(email::text) = 'partner.two@pu.example.com'`,
          [],
        )
      ).n,
    ).toBe(1);
  });

  it('TEST-CPU-03 a terminated connector gets no portal invitation', async () => {
    const res = await invite(CON_T, 'nobody@pu.example.com', 'Nobody');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('TEST-CPU-04 the provisioning worker delivers it and binds the real Auth subject; the login stays INVITED', async () => {
    const outcomes = await deliver();
    expect(outcomes.filter((o) => o.result === 'SENT').length).toBeGreaterThanOrEqual(2);
    const row = await one(`select status, idp_subject from app.app_user where id = $1`, [first]);
    expect(row.status).toBe('INVITED');
    const account = await auth.findAccountByEmail('partner.one@pu.example.com');
    expect(row.idp_subject).toBe(account!.id);
    const list = await request(manager()).get(`/v1/connectors/${CON_P}/users`);
    const listed = list.body.items.find((u: { id: string }) => u.id === first);
    expect(listed.invitation.deliveryState).toBe('SENT');
    expect(listed.invitation.sentAt).not.toBeNull();
  });

  it('TEST-CPU-05 the login becomes ACTIVE only on the first password sign-in, and then uses the portal with no grant', async () => {
    const account = await auth.findAccountByEmail('partner.one@pu.example.com');
    const principal = await signIn(account!.id, 'partner.one@pu.example.com');
    expect(principal).toMatchObject({ id: first, userType: 'CONNECTOR', grants: [] });
    expect((await one(`select status from app.app_user where id = $1`, [first])).status).toBe('ACTIVE');
    expect((await one(`select status from app.staff_invitation where user_id = $1`, [first])).status).toBe(
      'ACCEPTED',
    );
    const portal = createApp({
      deps: createProductionDeps(createTxRunner(env.db)),
      corsAllowedOrigins: [],
      auth: fakeAuth(principal),
    });
    expect((await request(portal).get('/portal/v1/referrals')).status).toBe(200);
    expect((await request(portal).get(`/v1/connectors/${CON_P}/users`)).status).toBe(403);
  });

  it('TEST-CPU-06 a resend waits for the cooldown, then queues a new e-mail', async () => {
    const early = await request(manager()).post(`/v1/connectors/${CON_P}/users/${second}/invitation/resend`);
    expect(early.status).toBe(409);
    await env.admin.query(
      `update app.staff_invitation set requested_at = now() - interval '2 minutes' where user_id = $1`,
      [second],
    );
    const resent = await request(manager()).post(`/v1/connectors/${CON_P}/users/${second}/invitation/resend`);
    expect(resent.status, JSON.stringify(resent.body)).toBe(202);
    expect(resent.body.invitation).toMatchObject({ deliveryState: 'QUEUED', resendCount: 1 });
    // An accepted invitation is complete: nothing to resend.
    expect(
      (await request(manager()).post(`/v1/connectors/${CON_P}/users/${first}/invitation/resend`)).status,
    ).toBe(409);
  });

  it('TEST-CPU-07 a withdrawn invitation deactivates the login, and the login can never be activated', async () => {
    const res = await request(manager())
      .post(`/v1/connectors/${CON_P}/users/${second}/invitation/revocation`)
      .send({ reason: 'Partner asked for a different contact' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('DEACTIVATED');
    expect(res.body.invitation.state).toBe('NONE');
    // The queued e-mail is not sent, and a later sign-in cannot activate the login.
    await deliver();
    expect(await auth.findAccountByEmail('partner.two@pu.example.com')).toBeDefined();
    const subject = (await one(`select idp_subject from app.app_user where id = $1`, [second]))
      .idp_subject as string;
    await expect(signIn(subject, 'partner.two@pu.example.com')).rejects.toThrow();
    expect((await one(`select status from app.app_user where id = $1`, [second])).status).toBe('DEACTIVATED');
  });

  it('TEST-CPU-08 suspension ends portal access on the next request; reactivation restores it', async () => {
    const account = await auth.findAccountByEmail('partner.one@pu.example.com');
    const suspended = await request(manager())
      .post(`/v1/connectors/${CON_P}/users/${first}/access`)
      .send({ action: 'SUSPEND', reason: 'Investigation of unusual activity' });
    expect(suspended.status, JSON.stringify(suspended.body)).toBe(200);
    expect(suspended.body.status).toBe('SUSPENDED');
    await expect(signIn(account!.id, 'partner.one@pu.example.com')).rejects.toThrow();
    const again = await request(manager())
      .post(`/v1/connectors/${CON_P}/users/${first}/access`)
      .send({ action: 'SUSPEND', reason: 'Investigation of unusual activity' });
    expect(again.status).toBe(409);
    const reactivated = await request(manager())
      .post(`/v1/connectors/${CON_P}/users/${first}/access`)
      .send({ action: 'REACTIVATE', reason: 'Investigation closed' });
    expect(reactivated.status, JSON.stringify(reactivated.body)).toBe(200);
    expect(reactivated.body.status).toBe('ACTIVE');
    expect(await signIn(account!.id, 'partner.one@pu.example.com')).toMatchObject({ id: first });
    expect(
      (
        await one(
          `select count(*)::int as n from app.audit_event where entity_id = $1 and action in ('connector.portal_user_suspended', 'connector.portal_user_reactivated')`,
          [first],
        )
      ).n,
    ).toBe(2);
  });

  it('TEST-CPU-09 only connector managers of the tenant manage portal users, and only through the connector the login belongs to', async () => {
    const rm = as({ id: MANAGER, grants: [grant('connector.read')] });
    expect((await request(rm).get(`/v1/connectors/${CON_P}/users`)).status).toBe(403);
    const otherTenant = as(
      { id: userId('PB1'), grants: [grant('connector.manage'), grant('connector.read')] },
      () => env.B,
    );
    expect((await request(otherTenant).get(`/v1/connectors/${CON_P}/users`)).status).toBe(404);
    expect(
      (
        await request(otherTenant)
          .post(`/v1/connectors/${CON_P}/users`)
          .set('Idempotency-Key', key('xt'))
          .send({ email: 'cross@pu.example.com', displayName: 'Cross Tenant' })
      ).status,
    ).toBe(404);
    // A login linked to CON_P cannot be reached through another connector's path.
    const wrongPath = await request(manager())
      .post(`/v1/connectors/${CON_O}/users/${first}/access`)
      .send({ action: 'SUSPEND', reason: 'Wrong connector path' });
    expect(wrongPath.status).toBe(404);
    // A staff account is not a portal user.
    const staff = await request(manager())
      .post(`/v1/connectors/${CON_P}/users/${MANAGER}/access`)
      .send({ action: 'SUSPEND', reason: 'Not a portal user' });
    expect(staff.status).toBe(404);
  });
});
