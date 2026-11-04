// The partner invitation lifecycle and the portal's states, against a real database and the production resolver. An invited login
// becomes ACTIVE only on its first sign-in with the password it set, and the portal opens only when the login is ACTIVE and its
// connector is ACTIVE. Nothing here activates a connector: that needs the consent decision (docs/CONNECTOR_VERIFICATION_DECISION.md).
// Synthetic data only.
import crypto from 'node:crypto';
import { createPrincipalResolver, type VerifiedToken } from '@dsa/kernel';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { createProductionDeps } from '../src/wiring';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import { fakeAuth, testPrincipal } from './support/fake-auth';

let env: IsolationEnv;
let resolver: ReturnType<typeof createPrincipalResolver>;

const PORTAL_PENDING =
  'Your portal account is active, but your connector onboarding is awaiting verification and activation.';
const PORTAL_SUSPENDED = 'Your portal access has been suspended. Please contact your DSA administrator.';
const PORTAL_NOT_LINKED =
  'This portal login is not linked to an active connector. Please contact your DSA administrator.';
const INVITATION_PENDING =
  'Your connector portal invitation is pending. Please complete the invitation process using the link sent to your registered email.';
const INVITATION_EXPIRED = 'This invitation has expired. Ask for a new one.';
const UNAUTHENTICATED_MESSAGE = 'Missing or invalid access token.';

const C = { ok: 'con_life_ok', pending: 'con_life_pend', suspended: 'con_life_csusp' };
const U = {
  ok: 'usr_life_ok',
  pending: 'usr_life_pend',
  connSuspended: 'usr_life_csusp',
  loginSuspended: 'usr_life_susp',
  invited: 'usr_life_inv',
  invitedNoPassword: 'usr_life_inv2',
  invitedExpired: 'usr_life_exp',
  notLinked: 'usr_life_noconn',
};
const I = { accepts: 'inv_life_1', noPassword: 'inv_life_2', expired: 'inv_life_3' };

const sha = (s: string) => crypto.createHash('sha256').update(s).digest();

const token = (subject: string, authMethods: string[]): VerifiedToken => ({
  subject,
  tenantId: env.A.tenantId,
  aal: 'aal1',
  mfaVerifiedAt: null,
  email: null,
  authMethods,
});

const resolve = (subject: string, authMethods: string[], correlationId: string) =>
  resolver.resolve(token(subject, authMethods), { correlationId, now: new Date() });

/** The portal's HTTP surface as one partner login. The login's standing is read from the database by the portal itself. */
const portalAs = (userId: string) =>
  createApp({
    deps: createProductionDeps(createTxRunner(env.db)),
    corsAllowedOrigins: [],
    auth: fakeAuth(
      testPrincipal({
        id: userId,
        tenantId: env.A.tenantId,
        primaryBranchId: env.A.branchId,
        userType: 'CONNECTOR',
      }),
    ),
  });

beforeAll(async () => {
  env = await startIsolationEnv();
  resolver = createPrincipalResolver(createTxRunner(env.db));
  const a = env.A;
  const q = (text: string, values: unknown[] = []) => env.admin.query(text, values);

  const connector = (id: string, mobile: string, status: string, legal: string) =>
    q(
      `insert into app.connector (id, tenant_id, connector_type, legal_name, contact_person, mobile_e164, mobile_hash, email, email_hash,
                                  encrypted_pan, pan_hash, pan_masked, primary_branch_id, relationship_owner_user_id, status,
                                  created_by, updated_by)
       values ($1, $2, 'INDIVIDUAL', $3, 'Synthetic Contact', $4, $5, $6, $7, $8, $9, 'XXXXX1234X', $10, $11, $12, 'iso', 'iso')`,
      [
        id,
        a.tenantId,
        legal,
        mobile,
        sha(`m-${id}`),
        `${id}@life.example.com`,
        sha(`e-${id}`),
        Buffer.from('synthetic'),
        sha(`p-${id}`),
        a.branchId,
        a.userIds[0],
        status,
      ],
    );
  await connector(C.ok, '+919876500601', 'ACTIVE', 'Synthetic Life Connector');
  await connector(C.pending, '+919876500602', 'PENDING_VERIFICATION', 'Synthetic Pending Connector');
  await connector(C.suspended, '+919876500603', 'SUSPENDED', 'Synthetic Suspended Connector');

  const login = (id: string, sub: string, status: string, connectorId: string | null, email: string) =>
    q(
      `insert into app.app_user (id, tenant_id, idp_subject, email, display_name, user_type, status, primary_branch_id, connector_id,
                                 created_by, updated_by)
       values ($1, $2, $3, $4, 'Partner Login', 'CONNECTOR', $5, $6, $7, 'iso', 'iso')`,
      [id, a.tenantId, sub, email, status, a.branchId, connectorId],
    );
  await login(U.ok, 'sub-life-ok', 'ACTIVE', C.ok, 'ok@life.example.com');
  await login(U.pending, 'sub-life-pend', 'ACTIVE', C.pending, 'pend@life.example.com');
  await login(U.connSuspended, 'sub-life-csusp', 'ACTIVE', C.suspended, 'csusp@life.example.com');
  await login(U.loginSuspended, 'sub-life-susp', 'SUSPENDED', C.ok, 'susp@life.example.com');
  await login(U.invited, 'sub-life-inv', 'INVITED', C.ok, 'inv@life.example.com');
  await login(U.invitedNoPassword, 'sub-life-inv2', 'INVITED', C.ok, 'inv2@life.example.com');
  await login(U.invitedExpired, 'sub-life-exp', 'INVITED', C.ok, 'exp@life.example.com');
  await login(U.notLinked, 'sub-life-noconn', 'ACTIVE', null, 'noconn@life.example.com');

  // One invitation per invited login, sent by the provisioning worker (SENT) and PENDING. The third one has run out.
  const invite = (id: string, userId: string, expiresSql: string) =>
    q(
      `insert into app.staff_invitation (id, tenant_id, user_id, status, delivery_state, requested_at, next_attempt_at, sent_at,
                                         expires_at, created_by, updated_by)
       values ($1, $2, $3, 'PENDING', 'SENT', now(), now(), now(), ${expiresSql}, 'iso', 'iso')`,
      [id, a.tenantId, userId],
    );
  await invite(I.accepts, U.invited, `now() + interval '1 day'`);
  await invite(I.noPassword, U.invitedNoPassword, `now() + interval '1 day'`);
  await invite(I.expired, U.invitedExpired, `now() - interval '1 minute'`);
});

afterAll(async () => {
  await env?.stop();
});

describe('partner invitation lifecycle (the resolver)', () => {
  it('an invited login that signs in with the password it set becomes ACTIVE, and its invitation is ACCEPTED once', async () => {
    const principal = await resolve('sub-life-inv', ['password'], 'life-1');
    expect(principal).toMatchObject({ id: U.invited, userType: 'CONNECTOR' });

    const user = await env.admin.query(`select status from app.app_user where id = $1`, [U.invited]);
    expect(user.rows[0].status).toBe('ACTIVE');
    const inv = await env.admin.query(`select status from app.staff_invitation where id = $1`, [I.accepts]);
    expect(inv.rows[0].status).toBe('ACCEPTED');

    // A later sign-in is an ordinary one: the invitation is not accepted a second time.
    await resolve('sub-life-inv', ['password'], 'life-2');
    const accepted = await env.admin.query(
      `select count(*)::int as n from app.staff_invitation where user_id = $1 and status = 'ACCEPTED'`,
      [U.invited],
    );
    expect(accepted.rows[0].n).toBe(1);
  });

  it('an invited login that signs in without the password is not activated, and is told to finish the invitation (state A)', async () => {
    await expect(resolve('sub-life-inv2', ['otp'], 'life-3')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: INVITATION_PENDING,
    });
    const user = await env.admin.query(`select status from app.app_user where id = $1`, [
      U.invitedNoPassword,
    ]);
    expect(user.rows[0].status).toBe('INVITED');
    const inv = await env.admin.query(`select status from app.staff_invitation where id = $1`, [
      I.noPassword,
    ]);
    expect(inv.rows[0].status).toBe('PENDING');
  });

  it('an expired invitation is refused with its message and recorded as EXPIRED, and the login stays INVITED', async () => {
    await expect(resolve('sub-life-exp', ['password'], 'life-4')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: INVITATION_EXPIRED,
    });
    const inv = await env.admin.query(`select status from app.staff_invitation where id = $1`, [I.expired]);
    expect(inv.rows[0].status).toBe('EXPIRED');
    const user = await env.admin.query(`select status from app.app_user where id = $1`, [U.invitedExpired]);
    expect(user.rows[0].status).toBe('INVITED');
  });

  it('a suspended partner login is refused with the suspension message, not a generic sign-in failure (state C)', async () => {
    await expect(resolve('sub-life-susp', ['password'], 'life-5')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: PORTAL_SUSPENDED,
    });
  });

  it('a token for no account is refused generically', async () => {
    await expect(resolve('sub-not-a-user', ['password'], 'life-6')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: UNAUTHENTICATED_MESSAGE,
    });
  });
});

describe('partner portal states (GET /portal/v1/eligibility and the data routes)', () => {
  it('an active login of an active connector is ELIGIBLE, and its data routes open (state D)', async () => {
    const app = portalAs(U.ok);
    const state = await request(app).get('/portal/v1/eligibility');
    expect(state.status).toBe(200);
    expect(state.body).toEqual({ state: 'ELIGIBLE', message: null });
    expect((await request(app).get('/portal/v1/referrals')).status).toBe(200);
    expect((await request(app).get('/portal/v1/statements')).status).toBe(200);
  });

  it('an active login whose connector is still pending is told so, and its data routes stay closed (state B)', async () => {
    const app = portalAs(U.pending);
    const state = await request(app).get('/portal/v1/eligibility');
    expect(state.body).toEqual({ state: 'CONNECTOR_PENDING', message: PORTAL_PENDING });

    const data = await request(app).get('/portal/v1/referrals');
    expect(data.status).toBe(403);
    expect(data.body.error.message).toBe(PORTAL_PENDING);
    expect(data.body.error.details?.[0]).toEqual({ issue: 'CONNECTOR_PENDING_VERIFICATION' });
  });

  it('a login whose connector is suspended is refused, and sees no connector data (state C)', async () => {
    const app = portalAs(U.connSuspended);
    const state = await request(app).get('/portal/v1/eligibility');
    expect(state.body).toEqual({ state: 'ACCESS_SUSPENDED', message: PORTAL_SUSPENDED });

    const data = await request(app).get('/portal/v1/statements');
    expect(data.status).toBe(403);
    expect(JSON.stringify(data.body)).not.toContain('Synthetic Suspended Connector');
  });

  it('a login whose own account is suspended is refused, and sees no connector data (state C)', async () => {
    const app = portalAs(U.loginSuspended);
    const state = await request(app).get('/portal/v1/eligibility');
    expect(state.body).toEqual({ state: 'ACCESS_SUSPENDED', message: PORTAL_SUSPENDED });
    expect((await request(app).get('/portal/v1/referrals')).status).toBe(403);
  });

  it('a partner login with no connector link is not eligible, and sees no connector data (state E)', async () => {
    const app = portalAs(U.notLinked);
    const state = await request(app).get('/portal/v1/eligibility');
    expect(state.body).toEqual({ state: 'NOT_LINKED', message: PORTAL_NOT_LINKED });
    expect((await request(app).get('/portal/v1/referrals')).status).toBe(403);
  });

  it('the partner document routes refuse a pending connector with the same state message as the portal', async () => {
    const res = await request(portalAs(U.pending)).get('/portal/v1/referrals/lead_life_none/documents');
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe(PORTAL_PENDING);
    expect(res.body.error.details?.[0]).toEqual({ issue: 'CONNECTOR_PENDING_VERIFICATION' });
  });

  it('a partner login cannot activate its own connector through the internal API', async () => {
    const res = await request(portalAs(U.ok)).post(`/v1/connectors/${C.pending}/activation`).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.details?.[0]).toEqual({ issue: 'CONNECTOR_IDENTITY_NOT_ALLOWED' });

    const row = await env.admin.query(`select status from app.connector where id = $1`, [C.pending]);
    expect(row.rows[0].status).toBe('PENDING_VERIFICATION');
  });
});
