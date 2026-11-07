// Regression tests for two smaller connector audit findings: a mobile number is unique per tenant as a PAN is (AUD-P2-01), and every consent
// code a partner asks for is audited without the code itself (AUD-P3-02). Synthetic data only.
import crypto from 'node:crypto';
import type { PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { createProductionDeps } from '../src/wiring';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import { fakeAuth, testPrincipal } from './support/fake-auth';

let env: IsolationEnv;
const CON_PORTAL = 'con_01CRZ3NDEKTSV4RRFFQ69G5FAV';
// Branch and owner ids in the format the contract validates (the same form the connector-access tests use).
const BRANCH_P2 = `br_${'0'.repeat(23)}P2A`;
const OWNER_P2 = `usr_${'0'.repeat(23)}AB2`;
const PORTAL_USER = 'usr_p2_portal';
const h = (s: string) => crypto.createHash('sha256').update(s).digest();

const as = (userIndex: 0 | 1, grants: PermissionCode[]) =>
  createApp({
    deps: createProductionDeps(createTxRunner(env.db)),
    corsAllowedOrigins: [],
    auth: fakeAuth(
      testPrincipal({
        id: env.A.userIds[userIndex],
        tenantId: env.A.tenantId,
        primaryBranchId: env.A.branchId,
        authTime: new Date().toISOString(),
        grants: grants.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] })),
      }),
    ),
  });

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

const connectorBody = (mobileE164: string, pan: string, email: string) => ({
  connectorType: 'INDIVIDUAL',
  legalName: 'Synthetic Duplicate Partner',
  contactPerson: 'Asha Rao',
  mobileE164,
  email,
  pan,
  primaryBranchId: BRANCH_P2,
  relationshipOwnerUserId: OWNER_P2,
});

beforeAll(async () => {
  env = await startIsolationEnv();
  const a = env.A;
  // The branch and the owner (an active staff member) that a new connector is created under.
  await env.admin.query(
    `insert into app.branch (id, tenant_id, organisation_id, code, name, created_by, updated_by)
     values ($1, $2, $3, 'P2A01', 'Audit P2 Branch', 'iso', 'iso')`,
    [BRANCH_P2, a.tenantId, a.orgId],
  );
  await env.admin.query(
    `insert into app.app_user (id, tenant_id, idp_subject, email, display_name, primary_branch_id, created_by, updated_by)
     values ($1, $2, 'sub-p2-owner', 'p2-owner@audit.example.com', 'Owner P2', $3, 'iso', 'iso')`,
    [OWNER_P2, a.tenantId, BRANCH_P2],
  );
  // A connector that is active, and a partner login linked to it, for the consent-code test.
  await env.admin.query(
    `insert into app.connector (id, tenant_id, connector_type, legal_name, contact_person, mobile_e164, mobile_hash, email, email_hash,
                                encrypted_pan, pan_hash, pan_masked, primary_branch_id, relationship_owner_user_id, status,
                                created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Synthetic Portal Partner', 'Synthetic Contact', '+919876502010', $3, 'p2-portal@audit.example.com', $4,
             $5, $6, 'XXXXX1234X', $7, $8, 'ACTIVE', 'iso', 'iso')`,
    [
      CON_PORTAL,
      a.tenantId,
      h('m-p2'),
      h('e-p2'),
      Buffer.from('synthetic'),
      h('p-p2'),
      a.branchId,
      a.userIds[0],
    ],
  );
  await env.admin.query(
    `insert into app.app_user (id, tenant_id, idp_subject, email, display_name, user_type, status, primary_branch_id, connector_id,
                               created_by, updated_by)
     values ($1, $2, 'sub-p2-portal', 'p2-login@audit.example.com', 'Partner Login P2', 'CONNECTOR', 'ACTIVE', $3, $4, 'iso', 'iso')`,
    [PORTAL_USER, a.tenantId, a.branchId, CON_PORTAL],
  );
});

afterAll(async () => {
  await env?.stop();
});

describe('AUD-P2-01: a mobile number is unique per tenant, as a PAN is', () => {
  it('creates the first connector with a mobile number', async () => {
    const res = await request(as(0, ['connector.manage']))
      .post('/v1/connectors')
      .set('Idempotency-Key', 'aud-p2-01-first')
      .send(connectorBody('+919876503001', 'ABCDE1234F', 'dup-first@audit.example.com'));
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });

  it('refuses a second connector with the same mobile number, and writes no second connector', async () => {
    const res = await request(as(0, ['connector.manage']))
      .post('/v1/connectors')
      .set('Idempotency-Key', 'aud-p2-01-second')
      .send(connectorBody('+919876503001', 'ABCDE5678G', 'dup-second@audit.example.com'));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.error.details?.[0]).toEqual({ field: 'mobileE164', issue: 'DUPLICATE_MOBILE' });
    const rows = await env.admin.query(
      `select count(*)::int as n from app.connector where email = 'dup-second@audit.example.com'`,
    );
    expect(rows.rows[0].n).toBe(0);
  });
});

describe('AUD-P3-02: every consent code a partner asks for is audited, without the code', () => {
  it('a sent code is audited against the connector and the code id, and the response carries no code', async () => {
    const res = await request(portalAs(PORTAL_USER))
      .post('/portal/v1/referrals/consent-otp')
      .set('Idempotency-Key', 'aud-p3-02-send')
      .send({ action: 'SEND', mobile: '+919876503010' });

    expect(res.status).toBe(200);
    expect(typeof res.body.otpId).toBe('string');
    expect(JSON.stringify(res.body)).not.toMatch(/"code"/);
    const audit = await env.admin.query(
      `select entity_type, entity_id, after from app.audit_event where action = 'consent.otp_sent' and entity_id = $1`,
      [res.body.otpId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].entity_type).toBe('REFERRAL_CONSENT_OTP');
    expect(JSON.stringify(audit.rows[0].after)).toContain(CON_PORTAL);
    expect(JSON.stringify(audit.rows[0].after)).not.toMatch(/"code"/);
  });
});
