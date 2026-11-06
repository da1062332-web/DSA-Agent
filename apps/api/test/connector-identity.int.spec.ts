// Connector portal identity on the real HTTP stack: supabaseAuth, the principal resolver, the internal-API gate (connector-identity-gate.ts),
// GET /v1/me and /portal/v1, against a real database. The unit half is connector-identity-gate.spec.ts and resolve-principal.spec.ts.
// The case that matters: a connector login whose role row is still open (written before migration 0097, or by a tool) must get no
// internal grants and must not see that role, while it still reaches its own portal. Synthetic data only.
import crypto from 'node:crypto';
import type { TokenVerifier, VerifiedToken } from '@dsa/kernel';
import { createPrincipalResolver } from '@dsa/kernel';
import { AppError } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { supabaseAuth } from '../src/http/supabase-auth';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { createProductionDeps } from '../src/wiring';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

let env: IsolationEnv;
let app: ReturnType<typeof createApp>;
let resolver: ReturnType<typeof createPrincipalResolver>;
const tokens = new Map<string, VerifiedToken>();

const CONNECTOR = 'con_id_1';
const PORTAL_USER = 'usr_id_portal';
const STAFF_USER = 'usr_id_staff';
const ROLE = 'role_id_rm_test';
const PORTAL_TOKEN = 'aaa.bbb.portal';
const STAFF_TOKEN = 'aaa.bbb.staff';

const verifier: TokenVerifier = {
  verify: async (raw) => {
    const t = tokens.get(raw);
    if (!t) throw AppError.of('UNAUTHENTICATED', 'Missing or invalid access token.');
    return t;
  },
};

beforeAll(async () => {
  env = await startIsolationEnv();
  const a = env.A;
  const q = (text: string, values: unknown[] = []) => env.admin.query(text, values);
  const h = (s: string) => crypto.createHash('sha256').update(s).digest();

  await q(
    `insert into app.connector (id, tenant_id, connector_type, legal_name, contact_person, mobile_e164, mobile_hash, email, email_hash,
                                encrypted_pan, pan_hash, pan_masked, primary_branch_id, relationship_owner_user_id, status,
                                created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Synthetic Identity Connector', 'Identity Person', '+919876500601', $3, 'con-id@example.com', $4,
             $5, $6, 'XXXXX1234X', $7, $8, 'ACTIVE', 'iso', 'iso')`,
    [
      CONNECTOR,
      a.tenantId,
      h('m-id'),
      h('e-id'),
      Buffer.from('synthetic'),
      h('p-id'),
      a.branchId,
      a.userIds[0],
    ],
  );
  await q(
    `insert into app.app_user (id, tenant_id, idp_subject, email, display_name, user_type, status, primary_branch_id, connector_id,
                               created_by, updated_by)
     values ($1, $2, 'sub-id-portal', 'portal-id@example.com', 'Portal Identity', 'CONNECTOR', 'ACTIVE', $3, $4, 'iso', 'iso')`,
    [PORTAL_USER, a.tenantId, a.branchId, CONNECTOR],
  );
  await q(
    `insert into app.app_user (id, tenant_id, idp_subject, email, display_name, user_type, status, primary_branch_id,
                               created_by, updated_by)
     values ($1, $2, 'sub-id-staff', 'staff-id@example.com', 'Staff Identity', 'STAFF', 'ACTIVE', $3, 'iso', 'iso')`,
    [STAFF_USER, a.tenantId, a.branchId],
  );
  await q(
    `insert into app.role (id, tenant_id, code, name, created_by) values ($1, $2, 'ROLE-RM-CONTAINMENT-TEST', 'Containment test role', 'iso')`,
    [ROLE, a.tenantId],
  );
  await q(
    `insert into app.role_permission (tenant_id, role_id, permission_code) values ($1, $2, 'lead.read')`,
    [a.tenantId, ROLE],
  );
  await q(
    `insert into app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by)
     values ('ura_id_staff', $1, $2, $3, 'TENANT', '{}', 'iso')`,
    [a.tenantId, STAFF_USER, ROLE],
  );
  // The residual row: an open role on a connector login. Migration 0097 would refuse it, so the guard is switched off for this one insert,
  // exactly as the hosted row could have been written before the guard existed.
  await q(`set session_replication_role = replica`);
  await q(
    `insert into app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by)
     values ('ura_id_portal', $1, $2, $3, 'TENANT', '{}', 'iso')`,
    [a.tenantId, PORTAL_USER, ROLE],
  );
  await q(`set session_replication_role = origin`);

  tokens.set(PORTAL_TOKEN, {
    subject: 'sub-id-portal',
    tenantId: a.tenantId,
    aal: 'aal1',
    mfaVerifiedAt: null,
    email: 'portal-id@example.com',
    authMethods: ['password'],
  });
  tokens.set(STAFF_TOKEN, {
    subject: 'sub-id-staff',
    tenantId: a.tenantId,
    aal: 'aal2',
    mfaVerifiedAt: new Date(),
    email: 'staff-id@example.com',
    authMethods: ['password'],
  });

  resolver = createPrincipalResolver(createTxRunner(env.db));
  app = createApp({
    deps: createProductionDeps(createTxRunner(env.db)),
    corsAllowedOrigins: [],
    auth: supabaseAuth({ verifier, resolver }),
  });
}, 240_000);

afterAll(async () => {
  await env?.stop();
});

describe('TEST-CONIDENT-INT connector portal identity on the HTTP stack', () => {
  it('TEST-CONCONTAIN-INT-01 the residual role row is really open, and the portal login still resolves without any grant', async () => {
    const open = await env.admin.query(
      `select count(*)::int as n from app.user_role_assignment where id = 'ura_id_portal' and upper_inf(effective_range)`,
    );
    expect(open.rows[0].n).toBe(1);

    const principal = await resolver.resolve(tokens.get(PORTAL_TOKEN)!, {
      correlationId: 'corr-id-1',
      now: new Date(),
    });
    expect(principal).toMatchObject({ kind: 'USER', id: PORTAL_USER, userType: 'CONNECTOR', grants: [] });
  });

  it('TEST-CONCONTAIN-INT-02 GET /v1/me for the portal login shows no role and no grant', async () => {
    const res = await request(app).get('/v1/me').set('Authorization', `Bearer ${PORTAL_TOKEN}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      userType: 'CONNECTOR',
      connectorId: CONNECTOR,
      roles: [],
      grants: [],
    });
    expect(JSON.stringify(res.body)).not.toContain('ROLE-RM-CONTAINMENT-TEST');
  });

  it('TEST-CONCONTAIN-INT-03 the portal login is refused an internal route, even with the open role row', async () => {
    const res = await request(app).get('/v1/connectors').set('Authorization', `Bearer ${PORTAL_TOKEN}`);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('CONNECTOR_IDENTITY_NOT_ALLOWED');
  });

  it('TEST-CONIDENT-INT-04 the portal login still reaches its own portal, scoped to its connector', async () => {
    const res = await request(app).get('/portal/v1/referrals').set('Authorization', `Bearer ${PORTAL_TOKEN}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('TEST-CONIDENT-INT-05 a staff account keeps its role and its grants, so the containment does not reach staff', async () => {
    const res = await request(app).get('/v1/me').set('Authorization', `Bearer ${STAFF_TOKEN}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ userType: 'STAFF' });
    expect(res.body.data.roles).toContain('ROLE-RM-CONTAINMENT-TEST');
    expect(res.body.data.grants).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'lead.read' })]),
    );
  });

  it('TEST-CONIDENT-INT-06 the portal login is refused every internal staff route, including the platform realm', async () => {
    for (const path of ['/v1/leads', '/v1/applications', '/v1/commission-plans', '/platform/v1/users']) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${PORTAL_TOKEN}`);
      expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(JSON.stringify(res.body)).toContain('CONNECTOR_IDENTITY_NOT_ALLOWED');
    }
  });

  it('TEST-CONIDENT-INT-07 an internal employee with the permission reaches the internal route that permission allows', async () => {
    const res = await request(app).get('/v1/leads').set('Authorization', `Bearer ${STAFF_TOKEN}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('TEST-CONIDENT-INT-08 a token issued for another tenant does not authenticate the tenant A portal login', async () => {
    const otherTenantToken = 'aaa.bbb.portalb';
    tokens.set(otherTenantToken, { ...tokens.get(PORTAL_TOKEN)!, tenantId: env.B.tenantId });
    const res = await request(app)
      .get('/portal/v1/referrals')
      .set('Authorization', `Bearer ${otherTenantToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(401);
    const principal = await resolver
      .resolve(tokens.get(otherTenantToken)!, { correlationId: 'corr-id-tenant', now: new Date() })
      .catch((e: unknown) => e);
    expect(principal).toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
