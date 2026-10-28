// TEST-FLOW for staff invitations (owner: platform, API-USR-001; Architecture B): the invite, status and resend routes against a real
// database. The API only records requests (QUEUED); it holds no Supabase key and calls no sign-in service. The provisioning worker that
// sends them is tested in provisioning-worker.spec.ts. The cases run in order, and later cases build on the invitee the first creates.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_RESENDS } from '../../../apps/api/src/modules/platform/invitations';
import { ALL_ADMIN, startIsolationEnv, type IsolationEnv } from '../harness';

const INVITEE = 'Meera.Iyer@isolation.example.test';
const INVITEE_LC = INVITEE.toLowerCase();

let env: IsolationEnv;
let userId: string;
let seq = 0;
const key = (label: string) => `inv-flow-${label}-${seq++}`;

const one = async (text: string, params: unknown[] = []) => (await env.admin.query(text, params)).rows[0];
const scalar = async (text: string, params: unknown[] = []): Promise<number> =>
  (await env.admin.query(`select count(*)::int as n from (${text}) as q`, params)).rows[0].n;
const auditCount = (action: string) =>
  scalar(`select 1 from app.audit_event where action = $1 and entity_id = $2`, [action, userId]);
/** What the provisioning worker writes when the e-mail has gone out, with `sentAgo` and `expiresIn` relative to now. */
const markSent = (sentAgo: string, expiresIn: string) =>
  env.admin.query(
    `update app.staff_invitation
        set delivery_state = 'SENT', requested_at = now() - $2::interval, sent_at = now() - $2::interval,
            expires_at = now() + $3::interval
      where user_id = $1`,
    [userId, sentAgo, expiresIn],
  );
const resend = (tenant = env.A) =>
  request(env.appAs(tenant, ALL_ADMIN)).post(`/v1/users/${userId}/invitation/resend`);

describe('staff invitation requests (API side)', () => {
  beforeAll(async () => {
    env = await startIsolationEnv();
  });

  afterAll(async () => {
    await env?.stop();
  });

  it('TEST-FLOW-01 an invitation records an INVITED user with a placeholder subject and a QUEUED invitation, and is audited', async () => {
    const res = await request(env.appAs(env.A, ALL_ADMIN))
      .post('/v1/users/invitations')
      .set('Idempotency-Key', key('create'))
      .send({ displayName: 'Meera Iyer', email: INVITEE, primaryBranchId: env.A.branchId, roleIds: [] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    userId = res.body.id;

    expect(await one(`select status, email, idp_subject from app.app_user where id = $1`, [userId])).toEqual({
      status: 'INVITED',
      email: INVITEE_LC,
      idp_subject: `invite:${userId}`,
    });
    expect(
      await one(
        `select status, delivery_state, delivery_attempts, resend_count from app.staff_invitation where user_id = $1`,
        [userId],
      ),
    ).toEqual({ status: 'PENDING', delivery_state: 'QUEUED', delivery_attempts: 0, resend_count: 0 });
    expect(await auditCount('user.invited')).toBe(1);
  });

  it('TEST-FLOW-02 the same e-mail again is refused as a duplicate, with no second record', async () => {
    const res = await request(env.appAs(env.A, ALL_ADMIN))
      .post('/v1/users/invitations')
      .set('Idempotency-Key', key('duplicate'))
      .send({ displayName: 'Meera Iyer', email: INVITEE, primaryBranchId: env.A.branchId, roleIds: [] });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].issue).toBe('DUPLICATE_EMAIL');
    expect(await scalar(`select 1 from app.staff_invitation where user_id = $1`, [userId])).toBe(1);
  });

  it('TEST-FLOW-03 the status shows the invitation as queued and not yet sent; another tenant cannot read it', async () => {
    const mine = await request(env.appAs(env.A, ALL_ADMIN)).get(`/v1/users/${userId}/invitation`);
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({
      userStatus: 'INVITED',
      invitationState: 'PENDING',
      deliveryState: 'QUEUED',
      sentAt: null,
    });
    // The countdown the UI shows: one minute after the request, on the server's clock, with all resends left.
    const requested = (await one(`select requested_at from app.staff_invitation where user_id = $1`, [userId])).requested_at;
    expect(Date.parse(mine.body.nextResendAt) - requested.getTime()).toBe(60_000);
    expect(Date.parse(mine.body.serverTime)).toBeGreaterThanOrEqual(requested.getTime());
    expect(mine.body.resendsLeft).toBe(5);
    expect((await request(env.appAs(env.B, ALL_ADMIN)).get(`/v1/users/${userId}/invitation`)).status).toBe(
      404,
    );
  });

  it('TEST-FLOW-04 a resend is refused while the first e-mail is still queued', async () => {
    const res = await resend();
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/still being sent/);
  });

  it('TEST-FLOW-05 once sent, a resend within the cooldown is refused', async () => {
    await markSent('10 seconds', '1 day');
    const res = await resend();
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/moment ago/);
  });

  it('TEST-FLOW-06 after the cooldown, a resend queues one new e-mail, counts it, and is audited; another tenant cannot', async () => {
    await markSent('2 minutes', '1 day');
    expect((await resend(env.B)).status).toBe(404);
    const res = await resend();
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toEqual({ id: userId, invitation: 'QUEUED' });
    expect(
      await one(
        `select status, delivery_state, delivery_attempts, resend_count from app.staff_invitation where user_id = $1`,
        [userId],
      ),
    ).toEqual({ status: 'PENDING', delivery_state: 'QUEUED', delivery_attempts: 0, resend_count: 1 });
    expect(await auditCount('user.invitation_resent')).toBe(1);
  });

  it('TEST-FLOW-07 after the maximum number of sends, a resend is refused', async () => {
    await markSent('2 minutes', '1 day');
    await env.admin.query(`update app.staff_invitation set resend_count = $2 where user_id = $1`, [
      userId,
      MAX_RESENDS,
    ]);
    const res = await resend();
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/maximum/);
  });

  it('TEST-FLOW-08 an expired invitation is shown as EXPIRED, and a resend queues it again', async () => {
    await markSent('2 days', '-1 day');
    await env.admin.query(`update app.staff_invitation set resend_count = 1 where user_id = $1`, [userId]);
    expect(
      (await request(env.appAs(env.A, ALL_ADMIN)).get(`/v1/users/${userId}/invitation`)).body.invitationState,
    ).toBe('EXPIRED');
    expect((await resend()).status).toBe(202);
    expect(
      await one(`select status, delivery_state from app.staff_invitation where user_id = $1`, [userId]),
    ).toEqual({
      status: 'PENDING',
      delivery_state: 'QUEUED',
    });
  });

  it('TEST-FLOW-10 an administrator cannot make an invited user ACTIVE, directly or by suspending and reactivating (D4)', async () => {
    const admin = env.appAs(env.A, ALL_ADMIN);
    const direct = await request(admin).patch(`/v1/users/${userId}`).send({ status: 'ACTIVE' });
    expect(direct.status).toBe(409);
    expect(direct.body.error.message).toMatch(/only by setting a password and signing in/);
    expect((await one(`select status from app.app_user where id = $1`, [userId])).status).toBe('INVITED');

    // Suspend the invitee (allowed), then try both ways back to ACTIVE: refused, because no invitation was ever accepted.
    expect((await request(admin).patch(`/v1/users/${userId}`).send({ status: 'SUSPENDED' })).status).toBe(
      200,
    );
    expect((await request(admin).patch(`/v1/users/${userId}`).send({ status: 'ACTIVE' })).status).toBe(409);
    const version = (await one(`select lock_version from app.app_user where id = $1`, [userId])).lock_version;
    const reactivate = await request(admin)
      .post(`/v1/users/${userId}/suspension`)
      .set('If-Match', `"${version}"`)
      .send({ action: 'REACTIVATE', reason: 'Test of the invitation rule' });
    expect(reactivate.status, JSON.stringify(reactivate.body)).toBe(409);
    expect((await one(`select status from app.app_user where id = $1`, [userId])).status).toBe('SUSPENDED');
    expect(await auditCount('user.reactivated')).toBe(0);
    await env.admin.query(`update app.app_user set status = 'INVITED' where id = $1`, [userId]);
  });

  it('TEST-FLOW-11 a user who never had an invitation is suspended and reactivated as before', async () => {
    const admin = env.appAs(env.A, ALL_ADMIN);
    const other = env.A.userIds[1];
    expect((await request(admin).patch(`/v1/users/${other}`).send({ status: 'SUSPENDED' })).status).toBe(200);
    const back = await request(admin).patch(`/v1/users/${other}`).send({ status: 'ACTIVE' });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.status).toBe('ACTIVE');
  });

  it('TEST-FLOW-09 an invitee who has already signed in (ACTIVE) cannot be sent a new invitation', async () => {
    await env.admin.query(
      `update app.app_user set status = 'ACTIVE', availability = 'AVAILABLE' where id = $1`,
      [userId],
    );
    const res = await resend();
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/Only an invited user/);
  });
});
