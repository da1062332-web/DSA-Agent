// TEST-ERASE: Delete account (POST /v1/users/:id/erasure) against a real database. The person's details are erased, their work is handed
// over, roles end, invitations are revoked, and no old token or e-mail address can reach the record again. The provisioning worker then
// deletes their Supabase sign-in account (a fake here: nothing reaches Supabase).
import { createPrincipalResolver } from '@dsa/kernel';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTxRunner } from '../../../apps/api/src/kernel-min/tx-runner';
import type { AuthAccount, AuthAdminPort } from '../../../apps/api/src/provisioning/auth-admin';
import { runSignInErasures } from '../../../apps/api/src/provisioning/sign-in-erasure';
import { ALL_ADMIN, startIsolationEnv, type IsolationEnv } from '../harness';

let env: IsolationEnv;
let seq = 0;
const key = () => `erase-${Date.now()}-${seq++}`;
const one = async (text: string, params: unknown[] = []) => (await env.admin.query(text, params)).rows[0];
const versionOf = async (id: string) =>
  (await one(`select lock_version from app.app_user where id = $1`, [id])).lock_version;
const erase = async (id: string, body: object, tenant = env.A) =>
  request(env.appAs(tenant, ALL_ADMIN))
    .post(`/v1/users/${id}/erasure`)
    .set('Idempotency-Key', key())
    .set('If-Match', `"${await versionOf(id).catch(() => 0)}"`)
    .send(body);

beforeAll(async () => {
  env = await startIsolationEnv();
});

afterAll(async () => {
  await env?.stop();
});

describe('Delete account', () => {
  it('TEST-ERASE-01 refusals: an active user needs a hand-over user; nobody deletes themselves; another tenant cannot', async () => {
    const target = env.A.userIds[1];
    const none = await erase(target, { reason: 'Left the company' });
    expect(none.status).toBe(422);
    expect(none.body.error.details[0]).toMatchObject({ field: 'handoverToUserId', issue: 'REQUIRED' });
    const self = await erase(env.A.userIds[0], { handoverToUserId: target, reason: 'Left the company' });
    expect(self.status).toBe(403);
    const cross = await request(env.appAs(env.B, ALL_ADMIN))
      .post(`/v1/users/${target}/erasure`)
      .set('Idempotency-Key', key())
      .set('If-Match', '"0"')
      .send({ handoverToUserId: env.B.userIds[1], reason: 'Left the company' });
    expect(cross.status).toBe(404);
    expect((await one(`select status, display_name from app.app_user where id = $1`, [target])).status).toBe(
      'ACTIVE',
    );
  });

  it('TEST-ERASE-02 an active user is erased: no name, e-mail or mobile, deactivated, roles ended, audited without personal data', async () => {
    const target = env.A.userIds[1];
    await env.admin.query(`update app.app_user set mobile_e164 = '+919812345678' where id = $1`, [target]);
    // The seed already makes the target a team member; make them the team's manager and a work-queue member too.
    await env.admin.query(`update app.team set manager_user_id = $1 where id = $2`, [target, env.A.teamId]);
    await env.admin.query(
      `insert into app.work_queue_member (id, tenant_id, queue_id, user_id, can_pick, can_assign, created_by)
       values ('wqm_iso_erase_a', $1, $2, $3, true, false, 'iso')`,
      [env.A.tenantId, env.A.queueId, target],
    );
    const res = await erase(target, { handoverToUserId: env.A.userIds[0], reason: 'Left the company' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ deleted: true, teamsLeft: 1, queuesLeft: 1, teamsWithoutManager: 1 });
    const open = async (table: string) =>
      (
        await one(
          `select count(*)::int as n from app.${table} where user_id = $1 and effective_range @> now()`,
          [target],
        )
      ).n;
    expect(await open('team_membership')).toBe(0);
    expect(await open('work_queue_member')).toBe(0);
    expect(
      (await one(`select manager_user_id from app.team where id = $1`, [env.A.teamId])).manager_user_id,
    ).toBeNull();
    expect(
      await one(
        `select status, display_name, email::text as email, mobile_e164, idp_subject from app.app_user where id = $1`,
        [target],
      ),
    ).toEqual({
      status: 'DEACTIVATED',
      display_name: 'Deleted user',
      email: `erased+${target.toLowerCase()}@erased.invalid`,
      mobile_e164: null,
      idp_subject: 'sub-iso-a1', // the worker deletes the sign-in account, then retires this
    });
    expect(
      (
        await one(
          `select count(*)::int as n from app.user_role_assignment where user_id = $1 and effective_range @> now()`,
          [target],
        )
      ).n,
    ).toBe(0);
    const audit = await one(
      `select before, after from app.audit_event where action = 'user.erased' and entity_id = $1`,
      [target],
    );
    expect(JSON.stringify(audit)).not.toContain('iso-a.example.com');
    expect(audit.after).toMatchObject({ status: 'DEACTIVATED', erased: true });

    // Deleting again is refused.
    expect((await erase(target, { handoverToUserId: env.A.userIds[0], reason: 'Again' })).status).toBe(409);
  });

  it('TEST-ERASE-03 neither the old sign-in nor the old e-mail address reaches the erased record', async () => {
    const resolver = createPrincipalResolver(createTxRunner(env.db));
    const token = (subject: string, email: string) => ({
      subject,
      tenantId: env.A.tenantId,
      aal: 'aal1' as const,
      mfaVerifiedAt: null,
      email,
      authMethods: ['password'],
    });
    await expect(
      resolver.resolve(token('sub-iso-a1', 'user1@iso-a.example.com'), {
        correlationId: 'erase',
        now: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(
      resolver.resolve(token('some-new-account', 'user1@iso-a.example.com'), {
        correlationId: 'erase',
        now: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('TEST-ERASE-04 an invited user is erased without a hand-over: the invitation is revoked and the placeholder sign-in retired at once', async () => {
    const invited = await request(env.appAs(env.A, ALL_ADMIN))
      .post('/v1/users/invitations')
      .set('Idempotency-Key', key())
      .send({
        displayName: 'Never Joined',
        email: 'never.joined@erase.example.test',
        primaryBranchId: env.A.branchId,
        roleIds: [],
      });
    expect(invited.status).toBe(201);
    const id = invited.body.id as string;
    const res = await erase(id, { reason: 'Invited by mistake' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await one(`select status, idp_subject from app.app_user where id = $1`, [id])).toEqual({
      status: 'DEACTIVATED',
      idp_subject: `erased:${id}`,
    });
    expect(
      await one(`select status, delivery_state from app.staff_invitation where user_id = $1`, [id]),
    ).toEqual({
      status: 'REVOKED',
      delivery_state: 'CANCELLED',
    });
  });

  it('TEST-ERASE-05 the worker deletes the erased user’s own sign-in account, never another tenant’s, and retires the subject', async () => {
    // Tenant B user 1 is erased too; its account carries another tenant's claim and must be kept.
    const otherTarget = env.B.userIds[1];
    expect(
      (await erase(otherTarget, { handoverToUserId: env.B.userIds[0], reason: 'Left the company' }, env.B))
        .status,
    ).toBe(200);

    const accounts = new Map<string, AuthAccount>([
      ['sub-iso-a1', { id: 'sub-iso-a1', email: 'user1@iso-a.example.com', tenantId: env.A.tenantId }],
      ['sub-iso-b1', { id: 'sub-iso-b1', email: 'user1@iso-b.example.com', tenantId: env.A.tenantId }],
    ]);
    const deleted: string[] = [];
    const auth = {
      getAccount: async (id: string) => accounts.get(id),
      deleteAccount: async (id: string) => {
        deleted.push(id);
        accounts.delete(id);
      },
    } as unknown as AuthAdminPort;
    const outcomes = await runSignInErasures({
      txRunner: createTxRunner(env.db),
      audit: env.deps.audit,
      authAdmin: auth,
      redirectTo: 'http://localhost:5173/accept-invitation',
      workerId: 'worker-erase',
    });
    expect(outcomes.map((o) => [o.userId, o.result]).sort()).toEqual(
      [
        [env.A.userIds[1], 'DELETED'],
        [otherTarget, 'KEPT_OTHER_TENANT'],
      ].sort(),
    );
    expect(deleted).toEqual(['sub-iso-a1']);
    expect(
      (await one(`select idp_subject from app.app_user where id = $1`, [env.A.userIds[1]])).idp_subject,
    ).toBe(`erased:${env.A.userIds[1]}`);
    expect(
      (await one(`select count(*)::int as n from app.audit_event where action = 'user.sign_in_deleted'`)).n,
    ).toBe(2);
    // Nothing is left to do on the next pass.
    expect(
      await runSignInErasures({
        txRunner: createTxRunner(env.db),
        audit: env.deps.audit,
        authAdmin: auth,
        redirectTo: '',
        workerId: 'w',
      }),
    ).toEqual([]);
  });

  it('TEST-ERASE-06 a deleted account cannot be changed by any route: profile, status, roles, suspension or deactivation', async () => {
    const target = env.A.userIds[1]; // deleted in TEST-ERASE-02
    const admin = env.appAs(env.A, ALL_ADMIN);
    const deletedMessage = /has been deleted/;
    const before = await one(`select display_name, status, lock_version from app.app_user where id = $1`, [
      target,
    ]);

    for (const body of [{ displayName: 'Back again' }, { status: 'SUSPENDED' }, { status: 'ACTIVE' }]) {
      const res = await request(admin).patch(`/v1/users/${target}`).send(body);
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect(res.body.error.message).toMatch(deletedMessage);
    }
    const role = await request(admin)
      .post(`/v1/users/${target}/roles`)
      .send({ roleId: 'role_any', scopeType: 'TENANT' });
    expect(role.status).toBe(409);
    expect(role.body.error.message).toMatch(deletedMessage);
    const version = `"${before.lock_version}"`;
    const reactivate = await request(admin)
      .post(`/v1/users/${target}/suspension`)
      .set('If-Match', version)
      .send({ action: 'REACTIVATE', reason: 'Try to bring it back' });
    expect(reactivate.status).toBe(409);
    expect(reactivate.body.error.message).toMatch(deletedMessage);
    const deactivate = await request(admin)
      .post(`/v1/users/${target}/deactivation`)
      .set('Idempotency-Key', key())
      .set('If-Match', version)
      .send({ handoverToUserId: env.A.userIds[0], reason: 'Again' });
    expect(deactivate.status).toBe(409);
    expect(deactivate.body.error.message).toMatch(deletedMessage);

    expect(
      await one(`select display_name, status, lock_version from app.app_user where id = $1`, [target]),
    ).toEqual(before);
  });

  it('TEST-ERASE-07 the staff list can leave deleted accounts out or show only them; names on old records still resolve', async () => {
    const target = env.A.userIds[1]; // deleted
    const admin = env.appAs(env.A, ALL_ADMIN);
    const ids = (res: request.Response) => (res.body.data as { id: string }[]).map((u) => u.id);

    const all = await request(admin).get('/v1/users');
    expect(all.status).toBe(200);
    expect(all.body.data.find((u: { id: string }) => u.id === target)).toMatchObject({
      displayName: 'Deleted user',
      deleted: true,
    });
    const directory = await request(admin).get('/v1/users?deleted=exclude');
    expect(ids(directory)).not.toContain(target);
    expect(ids(directory)).toContain(env.A.userIds[0]);
    const onlyDeleted = await request(admin).get('/v1/users?deleted=only');
    expect(ids(onlyDeleted)).toContain(target);
    expect(onlyDeleted.body.data.every((u: { deleted: boolean }) => u.deleted)).toBe(true);
    expect((await request(admin).get('/v1/users?deleted=maybe')).status).toBe(422);

    // The single record and the picker list (people without user.manage) still name it, so old leads and tasks stay readable.
    expect((await request(admin).get(`/v1/users/${target}`)).body).toMatchObject({
      deleted: true,
      displayName: 'Deleted user',
    });
    const picker = await request(env.appAs(env.A, [])).get('/v1/users');
    expect(picker.body.data.find((u: { id: string }) => u.id === target)).toMatchObject({ deleted: true });
  });
});
