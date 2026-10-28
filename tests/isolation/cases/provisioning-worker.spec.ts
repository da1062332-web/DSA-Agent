// TEST-WRK: the provisioning worker end to end (owner: platform, API-USR-001; Architecture B, migration 0093). Invitations are recorded
// through the real API, delivered by the real worker code against the isolation database as dsa_api, and then accepted through the real
// principal resolver. Supabase Auth is a fake in memory: no e-mail is sent and nothing reaches a Supabase project.
import { randomUUID } from 'node:crypto';
import { AppError } from '@dsa/contracts';
import { createPrincipalResolver } from '@dsa/kernel';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTxRunner } from '../../../apps/api/src/kernel-min/tx-runner';
import { createInvitationAcceptedAudit } from '../../../apps/api/src/modules/platform/user-lifecycle';
import type { AuthAccount, AuthAdminPort } from '../../../apps/api/src/provisioning/auth-admin';
import {
  MAX_DELIVERY_ATTEMPTS,
  deliverInvitation,
  runInvitationDeliveries,
  type InvitationDeliveryDeps,
} from '../../../apps/api/src/provisioning/invitation-delivery';
import { ALL_ADMIN, startIsolationEnv, type IsolationEnv, type TenantFixture } from '../harness';

const REDIRECT = 'http://localhost:5173/accept-invitation';

/** Supabase Auth in memory. `failures` makes the next calls fail as a provider outage would; `during` runs inside the next send. */
class FakeAuth implements AuthAdminPort {
  accounts = new Map<string, AuthAccount>();
  emails: { kind: 'invite' | 'set-password'; email: string; redirectTo: string }[] = [];
  claimsWritten: { id: string; tenantId: string }[] = [];
  failures = 0;
  during?: () => Promise<void>;

  private outage(): void {
    if (this.failures > 0) {
      this.failures--;
      throw AppError.of('DEPENDENCY_UNAVAILABLE', 'The sign-in service did not accept the request.');
    }
  }
  private async inFlight(): Promise<void> {
    const hook = this.during;
    this.during = undefined;
    await hook?.();
  }
  add(email: string, tenantId: string | null): AuthAccount {
    const account = { id: randomUUID(), email, tenantId };
    this.accounts.set(account.id, account);
    return account;
  }
  async findAccountByEmail(email: string) {
    this.outage();
    return [...this.accounts.values()].find((a) => a.email === email.toLowerCase());
  }
  async getAccount(id: string) {
    this.outage();
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
    this.outage();
    await this.inFlight();
    const account = this.add(input.email, input.tenantId);
    this.claimsWritten.push({ id: account.id, tenantId: input.tenantId });
    this.emails.push({ kind: 'invite', email: input.email, redirectTo: input.redirectTo });
    return account;
  }
  async sendSetPasswordEmail(input: { email: string; redirectTo: string }) {
    this.outage();
    await this.inFlight();
    this.emails.push({ kind: 'set-password', email: input.email, redirectTo: input.redirectTo });
  }
  async deleteAccount(id: string) {
    this.accounts.delete(id);
  }
}

let env: IsolationEnv;
let auth: FakeAuth;
let seq = 0;
const worker = (workerId = 'worker-a'): InvitationDeliveryDeps => ({
  txRunner: createTxRunner(env.db),
  audit: env.deps.audit,
  authAdmin: auth,
  redirectTo: REDIRECT,
  workerId,
});

const one = async (text: string, params: unknown[] = []) => (await env.admin.query(text, params)).rows[0];
const invitationRow = (invitationId: string) =>
  one(
    `select status, delivery_state, delivery_attempts, last_failure, claimed_by,
            next_attempt_at > now() as retry_later, extract(epoch from (expires_at - sent_at))::int as ttl
       from app.staff_invitation where id = $1`,
    [invitationId],
  );
const userRow = (userId: string) =>
  one(`select status, idp_subject from app.app_user where id = $1`, [userId]);
const auditCount = async (action: string, userId: string) =>
  (
    await one(`select count(*)::int as n from app.audit_event where action = $1 and entity_id = $2`, [
      action,
      userId,
    ])
  ).n;

async function invite(
  tenant: TenantFixture,
  email: string,
): Promise<{ userId: string; invitationId: string }> {
  const res = await request(env.appAs(tenant, ALL_ADMIN))
    .post('/v1/users/invitations')
    .set('Idempotency-Key', `wrk-invite-${seq++}-${Date.now()}`)
    .send({ displayName: 'Invitee Person', email, primaryBranchId: tenant.branchId, roleIds: [] });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const inv = await one(`select id from app.staff_invitation where user_id = $1`, [res.body.id]);
  return { userId: res.body.id, invitationId: inv.id };
}

beforeAll(async () => {
  env = await startIsolationEnv();
});

afterAll(async () => {
  await env?.stop();
});

describe('the provisioning worker', () => {
  it('TEST-WRK-01 success: the account is created with this tenant’s claim, the user is bound, the invitation is SENT, and a password sign-in then activates the user', async () => {
    auth = new FakeAuth();
    const { userId, invitationId } = await invite(env.A, 'success@wrk.example.test');
    const outcomes = await runInvitationDeliveries(worker());
    expect(outcomes.find((o) => o.invitationId === invitationId)).toMatchObject({
      result: 'SENT',
      authAccount: 'CREATED',
    });

    const account = [...auth.accounts.values()].find((a) => a.email === 'success@wrk.example.test')!;
    expect(auth.claimsWritten).toEqual([{ id: account.id, tenantId: env.A.tenantId }]);
    expect(auth.emails).toEqual([
      { kind: 'invite', email: 'success@wrk.example.test', redirectTo: REDIRECT },
    ]);
    expect(await userRow(userId)).toEqual({ status: 'INVITED', idp_subject: account.id });
    expect(await invitationRow(invitationId)).toMatchObject({
      status: 'PENDING',
      delivery_state: 'SENT',
      delivery_attempts: 1,
      claimed_by: null,
      ttl: 24 * 60 * 60,
    });
    expect(await auditCount('user.invitation_sent', userId)).toBe(1);

    const resolver = createPrincipalResolver(createTxRunner(env.db), {
      onInvitationAccepted: createInvitationAcceptedAudit(env.deps),
    });
    const token = (methods: string[]) => ({
      subject: account.id,
      tenantId: env.A.tenantId,
      aal: 'aal1' as const,
      mfaVerifiedAt: null,
      email: 'success@wrk.example.test',
      authMethods: methods,
    });
    // The link session sets the password but cannot activate; the password sign-in does.
    await expect(
      resolver.resolve(token(['otp']), { correlationId: 'wrk', now: new Date() }),
    ).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect((await resolver.resolve(token(['password']), { correlationId: 'wrk', now: new Date() })).id).toBe(
      userId,
    );
    expect(await userRow(userId)).toMatchObject({ status: 'ACTIVE' });
    expect(await auditCount('user.activated', userId)).toBe(1);
  });

  it('TEST-WRK-02 retry: a provider outage puts the request back with a delay; once due again it is sent, with one account and one e-mail', async () => {
    auth = new FakeAuth();
    auth.failures = 1;
    const { userId, invitationId } = await invite(env.A, 'retry@wrk.example.test');
    expect(await deliverInvitation(worker(), env.A.tenantId, invitationId)).toMatchObject({
      result: 'RETRY',
      failure: 'DELIVERY_RETRY',
    });
    expect(await invitationRow(invitationId)).toMatchObject({
      delivery_state: 'QUEUED',
      last_failure: 'DELIVERY_RETRY',
      delivery_attempts: 1,
      retry_later: true,
      claimed_by: null,
    });
    expect(await auditCount('user.invitation_failed', userId)).toBe(1);
    // Not due yet: nothing happens.
    expect(await deliverInvitation(worker(), env.A.tenantId, invitationId)).toMatchObject({
      result: 'SKIPPED',
    });

    await env.admin.query(`update app.staff_invitation set next_attempt_at = now() where id = $1`, [
      invitationId,
    ]);
    expect(await deliverInvitation(worker(), env.A.tenantId, invitationId)).toMatchObject({ result: 'SENT' });
    expect(auth.accounts.size).toBe(1);
    expect(auth.emails).toHaveLength(1);
    expect(await invitationRow(invitationId)).toMatchObject({
      delivery_state: 'SENT',
      delivery_attempts: 2,
      last_failure: null,
    });
  });

  it('TEST-WRK-03 duplicates: two workers delivering the same request at once send one e-mail and create one account', async () => {
    auth = new FakeAuth();
    const { invitationId } = await invite(env.A, 'race@wrk.example.test');
    const results = await Promise.all([
      deliverInvitation(worker('worker-a'), env.A.tenantId, invitationId),
      deliverInvitation(worker('worker-b'), env.A.tenantId, invitationId),
    ]);
    expect(results.map((r) => r.result).sort()).toEqual(['SENT', 'SKIPPED']);
    expect(auth.accounts.size).toBe(1);
    expect(auth.emails).toHaveLength(1);
  });

  it('TEST-WRK-04 a worker that stopped mid-send: its stale claim is taken over, the account it created is reused, and the user is bound once', async () => {
    auth = new FakeAuth();
    const { userId, invitationId } = await invite(env.A, 'stale@wrk.example.test');
    // Worker A created the account and crashed before recording anything.
    const orphan = auth.add('stale@wrk.example.test', env.A.tenantId);
    await env.admin.query(
      `update app.staff_invitation set delivery_state = 'SENDING', claimed_by = 'worker-a', claimed_at = now() - interval '11 minutes',
              delivery_attempts = 1 where id = $1`,
      [invitationId],
    );
    expect(await deliverInvitation(worker('worker-b'), env.A.tenantId, invitationId)).toMatchObject({
      result: 'SENT',
      authAccount: 'REUSED',
    });
    expect(auth.accounts.size).toBe(1);
    expect(auth.emails).toEqual([
      { kind: 'set-password', email: 'stale@wrk.example.test', redirectTo: REDIRECT },
    ]);
    expect(await userRow(userId)).toEqual({ status: 'INVITED', idp_subject: orphan.id });
  });

  it('TEST-WRK-05 an address held by another tenant’s account, or by an account with no tenant claim, fails for good: nothing is adopted, claimed or sent', async () => {
    auth = new FakeAuth();
    auth.add('taken@wrk.example.test', env.B.tenantId);
    auth.add('bare@wrk.example.test', null);
    for (const email of ['taken@wrk.example.test', 'bare@wrk.example.test']) {
      const { userId, invitationId } = await invite(env.A, email);
      expect(await deliverInvitation(worker(), env.A.tenantId, invitationId)).toMatchObject({
        result: 'FAILED',
        failure: 'EMAIL_NOT_AVAILABLE',
      });
      expect(await invitationRow(invitationId)).toMatchObject({
        delivery_state: 'FAILED',
        last_failure: 'EMAIL_NOT_AVAILABLE',
      });
      expect(await userRow(userId)).toEqual({ status: 'INVITED', idp_subject: `invite:${userId}` });
    }
    expect(auth.claimsWritten).toEqual([]);
    expect(auth.emails).toEqual([]);
  });

  it('TEST-WRK-06 after the last allowed attempt, an outage fails the request for good instead of retrying', async () => {
    auth = new FakeAuth();
    auth.failures = 1;
    const { invitationId } = await invite(env.A, 'exhausted@wrk.example.test');
    await env.admin.query(`update app.staff_invitation set delivery_attempts = $2 where id = $1`, [
      invitationId,
      MAX_DELIVERY_ATTEMPTS - 1,
    ]);
    expect(await deliverInvitation(worker(), env.A.tenantId, invitationId)).toMatchObject({
      result: 'FAILED',
      failure: 'DELIVERY_FAILED',
    });
    expect(await invitationRow(invitationId)).toMatchObject({
      delivery_state: 'FAILED',
      delivery_attempts: MAX_DELIVERY_ATTEMPTS,
    });
  });

  it('TEST-WRK-07 expiry: a request older than an invitation’s lifetime is not sent late; it is EXPIRED without any call to Supabase', async () => {
    auth = new FakeAuth();
    const { invitationId } = await invite(env.A, 'late@wrk.example.test');
    await env.admin.query(
      `update app.staff_invitation set requested_at = now() - interval '25 hours' where id = $1`,
      [invitationId],
    );
    expect(await deliverInvitation(worker(), env.A.tenantId, invitationId)).toMatchObject({
      result: 'FAILED',
      failure: 'REQUEST_EXPIRED',
    });
    expect(await invitationRow(invitationId)).toMatchObject({ status: 'EXPIRED', delivery_state: 'FAILED' });
    expect(auth.accounts.size + auth.emails.length).toBe(0);
  });

  it('TEST-WRK-08 deactivation: a user deactivated before or during delivery is never sent an invitation that works, and stays deactivated', async () => {
    auth = new FakeAuth();
    // Before: nothing is called.
    const before = await invite(env.A, 'gone-before@wrk.example.test');
    await env.admin.query(`update app.app_user set status = 'DEACTIVATED' where id = $1`, [before.userId]);
    expect(await deliverInvitation(worker(), env.A.tenantId, before.invitationId)).toMatchObject({
      result: 'CANCELLED',
    });
    expect(auth.accounts.size).toBe(0);
    expect(await invitationRow(before.invitationId)).toMatchObject({
      status: 'REVOKED',
      delivery_state: 'CANCELLED',
    });

    // During: the e-mail went out, but the invitation is revoked and the user is not reactivated.
    const during = await invite(env.A, 'gone-during@wrk.example.test');
    auth.during = async () => {
      await env.admin.query(`update app.app_user set status = 'DEACTIVATED' where id = $1`, [during.userId]);
    };
    expect(await deliverInvitation(worker(), env.A.tenantId, during.invitationId)).toMatchObject({
      result: 'CANCELLED',
    });
    expect(await invitationRow(during.invitationId)).toMatchObject({
      status: 'REVOKED',
      delivery_state: 'CANCELLED',
    });
    expect((await userRow(during.userId)).status).toBe('DEACTIVATED');
    expect(await auditCount('user.invitation_cancelled', during.userId)).toBe(1);
  });

  it('TEST-WRK-09 tenant isolation: each claim is the tenant of its own invitation, the same address cannot be claimed by a second tenant, and discovery answers only the worker', async () => {
    auth = new FakeAuth();
    const inA = await invite(env.A, 'shared@wrk.example.test');
    const inB = await invite(env.B, 'shared@wrk.example.test');
    expect(await deliverInvitation(worker(), env.A.tenantId, inA.invitationId)).toMatchObject({
      result: 'SENT',
    });
    expect(await deliverInvitation(worker(), env.B.tenantId, inB.invitationId)).toMatchObject({
      result: 'FAILED',
      failure: 'EMAIL_NOT_AVAILABLE',
    });
    expect(auth.claimsWritten.map((c) => c.tenantId)).toEqual([env.A.tenantId]);
    expect((await userRow(inB.userId)).idp_subject).toBe(`invite:${inB.userId}`);

    // A tenant context cannot list other tenants' work.
    const runner = createTxRunner(env.db);
    const asTenant = {
      principal: {
        kind: 'SERVICE' as const,
        id: 'x',
        tenantId: env.A.tenantId,
        primaryBranchId: null,
        managedTeamMemberIds: [],
        queueIds: [],
        grants: [],
        authTime: null,
      },
      correlationId: 'wrk',
      now: new Date(),
    };
    await expect(
      runner.withTenantTx(asTenant, (tx) =>
        (tx as unknown as { query: (q: string) => Promise<unknown> }).query(
          'select * from app.pending_staff_invitation_deliveries(5, 600)',
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('TEST-WRK-10 resend to a bound invitee: the bound account gets a set-password e-mail; an account that no longer matches fails as a conflict', async () => {
    auth = new FakeAuth();
    const { userId, invitationId } = await invite(env.A, 'again@wrk.example.test');
    await deliverInvitation(worker(), env.A.tenantId, invitationId);
    await env.admin.query(
      `update app.staff_invitation set delivery_state = 'QUEUED', next_attempt_at = now(), requested_at = now() where id = $1`,
      [invitationId],
    );
    expect(await deliverInvitation(worker(), env.A.tenantId, invitationId)).toMatchObject({
      result: 'SENT',
      authAccount: 'REUSED',
    });
    expect(auth.emails.map((e) => e.kind)).toEqual(['invite', 'set-password']);
    expect(auth.accounts.size).toBe(1);

    const bound = (await userRow(userId)).idp_subject as string;
    auth.accounts.set(bound, { id: bound, email: 'someone.else@wrk.example.test', tenantId: env.A.tenantId });
    await env.admin.query(
      `update app.staff_invitation set delivery_state = 'QUEUED', next_attempt_at = now(), requested_at = now() where id = $1`,
      [invitationId],
    );
    expect(await deliverInvitation(worker(), env.A.tenantId, invitationId)).toMatchObject({
      result: 'FAILED',
      failure: 'SUBJECT_CONFLICT',
    });
    expect(auth.emails).toHaveLength(2);
  });
});
