// TEST-INV for staff invitations (owner: platform, API-USR-001). An invited user becomes active only when all of these hold: the token
// belongs to the sign-in account the invitation linked to the record, the session was signed in with a password (a link alone does not
// count), the tenant is active, and the invitation was SENT by the provisioning worker and is PENDING and not expired. Acceptance and
// activation are audited in the same transaction, once. Identity binding (D5): with the e-mail fallback off, only the subject matches.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrincipalResolver, type PrincipalResolver } from '@dsa/kernel';
import { createTxRunner } from '../../../apps/api/src/kernel-min/tx-runner';
import { createInvitationAcceptedAudit } from '../../../apps/api/src/modules/platform/user-lifecycle';
import { startIsolationEnv, type IsolationEnv } from '../harness';

const LINKED = 'auth-invitee-linked-0001';
const LINKED_TWO = 'auth-invitee-linked-0002';
const LINKED_THREE = 'auth-invitee-linked-0003';
const LINKED_FOUR = 'auth-invitee-linked-0004';
const OTHER_SUBJECT = 'auth-someone-else-0005';
const EMAIL_ONE = 'invitee.one@isolation.example.test';
const EMAIL_TWO = 'invitee.two@isolation.example.test';
const EMAIL_THREE = 'invitee.three@isolation.example.test';
const EMAIL_FOUR = 'invitee.four@isolation.example.test';
const DAY = 24 * 60 * 60 * 1000;

let env: IsolationEnv;
let resolver: PrincipalResolver;
let strictResolver: PrincipalResolver;
const fallbacks: string[] = [];

beforeAll(async () => {
  env = await startIsolationEnv();
  const runner = createTxRunner(env.db);
  resolver = createPrincipalResolver(runner, {
    onInvitationAccepted: createInvitationAcceptedAudit(env.deps),
    onEmailFallback: (userId) => fallbacks.push(userId),
  });
  strictResolver = createPrincipalResolver(runner, { emailFallback: false });
  const a = env.A;
  const creator = a.userIds[0];
  const invite = async (
    userId: string,
    invitationId: string,
    subject: string,
    email: string,
    expiresAt: Date,
    deliveryState = 'SENT',
  ) => {
    await env.admin.query(
      `insert into app.app_user (id, tenant_id, idp_subject, email, display_name, user_type, status, availability,
                                 primary_branch_id, created_by, updated_by)
       values ($1, $2, $3, $4, 'Invitee', 'STAFF', 'INVITED', 'OFF_DUTY', $5, $6, $6)`,
      [userId, a.tenantId, subject, email, a.branchId, creator],
    );
    await env.admin.query(
      `insert into app.staff_invitation (id, tenant_id, user_id, status, delivery_state, sent_at, expires_at, created_by, updated_by)
       values ($1, $2, $3, 'PENDING', $4, now(), $5, $6, $6)`,
      [invitationId, a.tenantId, userId, deliveryState, expiresAt, creator],
    );
  };
  await invite('usr_inv_a1', 'inv_iso_a1', LINKED, EMAIL_ONE, new Date(Date.now() + DAY));
  await invite('usr_inv_a2', 'inv_iso_a2', LINKED_TWO, EMAIL_TWO, new Date(Date.now() + DAY));
  await invite('usr_inv_a3', 'inv_iso_a3', LINKED_THREE, EMAIL_THREE, new Date(Date.now() - 60_000));
  // Bound, but the worker has not reported the e-mail as sent (still QUEUED).
  await invite('usr_inv_a4', 'inv_iso_a4', LINKED_FOUR, EMAIL_FOUR, new Date(Date.now() + DAY), 'QUEUED');
});

afterAll(async () => {
  await env?.stop();
});

const tokenFor = (
  tenantId: string,
  subject: string,
  email: string,
  authMethods: string[] = ['password'],
) => ({
  subject,
  tenantId,
  aal: 'aal1' as const,
  mfaVerifiedAt: null,
  email,
  authMethods,
});
const signIn = (tenantId: string, subject: string, email: string, authMethods?: string[], r = resolver) =>
  r.resolve(tokenFor(tenantId, subject, email, authMethods), { correlationId: 'inv', now: new Date() });
const statusOf = async (id: string) =>
  (await env.admin.query(`select status, availability from app.app_user where id = $1`, [id])).rows[0];
const invitationOf = async (userId: string) =>
  (await env.admin.query(`select status, accepted_at from app.staff_invitation where user_id = $1`, [userId]))
    .rows[0];
const auditCount = async (action: string, userId: string) =>
  (
    await env.admin.query(
      `select count(*)::int as n from app.audit_event where action = $1 and entity_id = $2`,
      [action, userId],
    )
  ).rows[0].n;

describe('activating an invited user on first sign-in', () => {
  it('TEST-INV-01 the linked account signs in with a password: the user becomes active, and acceptance and activation are each audited once', async () => {
    const principal = await signIn(env.A.tenantId, LINKED, EMAIL_ONE);
    expect(principal.id).toBe('usr_inv_a1');
    expect(principal.tenantId).toBe(env.A.tenantId);
    expect(await statusOf('usr_inv_a1')).toEqual({ status: 'ACTIVE', availability: 'AVAILABLE' });
    const inv = await invitationOf('usr_inv_a1');
    expect(inv.status).toBe('ACCEPTED');
    expect(inv.accepted_at).not.toBeNull();
    expect(await auditCount('user.invitation_accepted', 'usr_inv_a1')).toBe(1);
    expect(await auditCount('user.activated', 'usr_inv_a1')).toBe(1);
  });

  it('TEST-INV-02 an account that is not the linked one does not activate the invitation, even with the same e-mail', async () => {
    await expect(signIn(env.A.tenantId, OTHER_SUBJECT, EMAIL_TWO)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(await statusOf('usr_inv_a2')).toEqual({ status: 'INVITED', availability: 'OFF_DUTY' });
    expect((await invitationOf('usr_inv_a2')).status).toBe('PENDING');
  });

  it('TEST-INV-03 the same linked account in another tenant never matches the invitation', async () => {
    await expect(signIn(env.B.tenantId, LINKED_TWO, EMAIL_TWO)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(await statusOf('usr_inv_a2')).toEqual({ status: 'INVITED', availability: 'OFF_DUTY' });
  });

  it('TEST-INV-04 once active, the linked account keeps signing in, and nothing is audited again', async () => {
    const again = await signIn(env.A.tenantId, LINKED, EMAIL_ONE);
    expect(again.id).toBe('usr_inv_a1');
    expect(await statusOf('usr_inv_a1')).toEqual({ status: 'ACTIVE', availability: 'AVAILABLE' });
    expect(await auditCount('user.invitation_accepted', 'usr_inv_a1')).toBe(1);
    expect(await auditCount('user.activated', 'usr_inv_a1')).toBe(1);
  });

  it('TEST-INV-05 a session signed in by link or one-time code (no password) cannot activate the invitee', async () => {
    await expect(signIn(env.A.tenantId, LINKED_TWO, EMAIL_TWO, ['otp'])).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(signIn(env.A.tenantId, LINKED_TWO, EMAIL_TWO, [])).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(await statusOf('usr_inv_a2')).toEqual({ status: 'INVITED', availability: 'OFF_DUTY' });
    expect((await invitationOf('usr_inv_a2')).status).toBe('PENDING');
  });

  it('TEST-INV-06 an expired invitation is refused with the expiry message, recorded as EXPIRED, and cannot be used afterwards', async () => {
    await expect(signIn(env.A.tenantId, LINKED_THREE, EMAIL_THREE)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: expect.stringMatching(/expired/),
    });
    expect(await statusOf('usr_inv_a3')).toEqual({ status: 'INVITED', availability: 'OFF_DUTY' });
    expect((await invitationOf('usr_inv_a3')).status).toBe('EXPIRED');
    await expect(signIn(env.A.tenantId, LINKED_THREE, EMAIL_THREE)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(await auditCount('user.invitation_accepted', 'usr_inv_a3')).toBe(0);
  });

  it('TEST-INV-07 an invitation the worker has not reported as sent cannot activate the user, even with a password sign-in', async () => {
    await expect(signIn(env.A.tenantId, LINKED_FOUR, EMAIL_FOUR)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(await statusOf('usr_inv_a4')).toEqual({ status: 'INVITED', availability: 'OFF_DUTY' });
    expect((await invitationOf('usr_inv_a4')).status).toBe('PENDING');
  });
});

describe('identity binding (D5)', () => {
  it('TEST-INV-09 a session resolves to the user bound to its subject, even when another user of the tenant has the same e-mail address', async () => {
    // The seeded users of tenant A are bound to sub-iso-a0 and sub-iso-a1. The token carries user0's address and user1's subject.
    const principal = await signIn(env.A.tenantId, 'sub-iso-a1', 'user0@iso-a.example.com');
    expect(principal.id).toBe(env.A.userIds[1]);
  });

  it('TEST-INV-10 with the fallback on (the default), an unbound token may match by e-mail, and each such match is reported', async () => {
    fallbacks.length = 0;
    const principal = await signIn(env.A.tenantId, 'auth-unbound-0010', 'user0@iso-a.example.com');
    expect(principal.id).toBe(env.A.userIds[0]);
    expect(fallbacks).toEqual([env.A.userIds[0]]);
  });

  it('TEST-INV-11 with the fallback off, only the subject matches: the same unbound token is refused, a bound one still works', async () => {
    await expect(
      signIn(env.A.tenantId, 'auth-unbound-0010', 'user0@iso-a.example.com', undefined, strictResolver),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const bound = await signIn(env.A.tenantId, 'sub-iso-a0', 'anything@else.test', undefined, strictResolver);
    expect(bound.id).toBe(env.A.userIds[0]);
  });
});
