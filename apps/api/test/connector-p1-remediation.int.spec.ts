// Regression tests for three P1 defects of the connector audit (docs/CONNECTOR_COMPREHENSIVE_AUDIT.md): a referral can only be given to an
// ACTIVE connector (AUD-P1-04), a dispute cannot be resolved by the person who raised it (AUD-P1-05), and a verification needs the consent of
// its own subject (AUD-P1-03). Each suite has a refused case and a legitimate case. Synthetic data only.
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
const CON_ACTIVE = 'con_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const CON_SUSPENDED = 'con_01BRZ3NDEKTSV4RRFFQ69G5FAV';
const LEAD_DISPUTED = 'lead_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const DISPUTE = 'adp_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const CUST_A = 'cust_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const CUST_B = 'cust_01BRZ3NDEKTSV4RRFFQ69G5FAV';
const CONSENT_A = 'cnst_01ARZ3NDEKTSV4RRFFQ69G5FAV';
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

const insertConnector = (id: string, status: string, mobile: string, email: string) =>
  env.admin.query(
    `insert into app.connector (id, tenant_id, connector_type, legal_name, contact_person, mobile_e164, mobile_hash, email, email_hash,
                                encrypted_pan, pan_hash, pan_masked, primary_branch_id, relationship_owner_user_id, status,
                                created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Synthetic P1 Connector', 'Synthetic Contact', $3, $4, $5, $6, $7, $8,
             'XXXXX1234X', $9, $10, $11, 'iso', 'iso')`,
    [
      id,
      env.A.tenantId,
      mobile,
      h(`m-${id}`),
      email,
      h(`e-${id}`),
      Buffer.from('synthetic'),
      h(`p-${id}`),
      env.A.branchId,
      env.A.userIds[0],
      status,
    ],
  );

beforeAll(async () => {
  env = await startIsolationEnv();
  const a = env.A;
  await insertConnector(CON_ACTIVE, 'ACTIVE', '+919876501001', 'p1-active@audit.example.com');
  await insertConnector(CON_SUSPENDED, 'SUSPENDED', '+919876501002', 'p1-suspended@audit.example.com');

  // A lead the dispute is about, attributed to the active connector.
  await env.admin.query(
    `insert into app.lead (id, tenant_id, branch_id, full_name, mobile_e164, mobile_hash, product_category, source, state,
                           owner_user_id, connector_id, created_by, updated_by)
     values ($1, $2, $3, 'Referred Person P1', '+919876501003', $4, 'PL', 'REFERRAL', 'NEW', $5, $6, 'iso', 'iso')`,
    [LEAD_DISPUTED, a.tenantId, a.branchId, h('lead-p1'), a.userIds[1], CON_ACTIVE],
  );
  // The dispute was raised by user 0. User 0 must not be able to resolve it; user 1 may.
  await env.admin.query(
    `insert into app.attribution_dispute (id, tenant_id, lead_id, claimant_connector_ids, status, lock_version, created_by, updated_by)
     values ($1, $2, $3, $4, 'OPEN', 0, $5, $5)`,
    [DISPUTE, a.tenantId, LEAD_DISPUTED, [CON_ACTIVE], a.userIds[0]],
  );

  // Customers and a consent given by customer A for a verification check.
  for (const [id, name] of [
    [CUST_A, 'Customer A'],
    [CUST_B, 'Customer B'],
  ] as const) {
    await env.admin.query(
      `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
       values ($1, $2, 'INDIVIDUAL', $3, $4, 'iso', 'iso')`,
      [id, a.tenantId, name, a.branchId],
    );
  }
  await env.admin.query(
    `insert into app.consent_record (id, tenant_id, subject_type, subject_id, purpose, purpose_target, notice_version, channel,
                                     captured_by, captured_at, status)
     values ($1, $2, 'CUSTOMER', $3, 'VERIFICATION_CHECK', 'pan-check', 'NOTICE-V1', 'OTP', 'iso', now(), 'ACTIVE')`,
    [CONSENT_A, a.tenantId, CUST_A],
  );
});

afterAll(async () => {
  await env?.stop();
});

describe('AUD-P1-04: a referral can only be attributed to an active connector', () => {
  const referral = (connectorId: string, mobile: string) => ({
    fullName: 'Referred Person Audit',
    mobile,
    productCategory: 'PL',
    branchId: env.A.branchId,
    source: 'REFERRAL',
    connectorId,
    consent: {
      purpose: 'CONTACT',
      noticeVersion: 'PORTAL-V1',
      channel: 'OTP',
      evidenceRef: 'otp:audit-p1-04',
    },
  });

  it('refuses a referral attributed to a suspended connector, and writes no lead', async () => {
    const res = await request(as(0, ['lead.create']))
      .post('/v1/leads')
      .set('Idempotency-Key', 'aud-p1-04-refused')
      .send(referral(CON_SUSPENDED, '+919876501004'));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.error.details?.[0]).toEqual({ field: 'connectorId', issue: 'CONNECTOR_NOT_ACTIVE' });
    const leads = await env.admin.query(
      `select count(*)::int as n from app.lead where mobile_e164 = '+919876501004'`,
    );
    expect(leads.rows[0].n).toBe(0);
  });

  it('accepts a referral attributed to an active connector', async () => {
    const res = await request(as(0, ['lead.create']))
      .post('/v1/leads')
      .set('Idempotency-Key', 'aud-p1-04-accepted')
      .send(referral(CON_ACTIVE, '+919876501005'));

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    const leads = await env.admin.query(
      `select connector_id from app.lead where mobile_e164 = '+919876501005'`,
    );
    expect(leads.rows[0].connector_id).toBe(CON_ACTIVE);
  });
});

describe('AUD-P1-05: a dispute cannot be resolved by the person who raised it', () => {
  it('refuses resolution by the raiser, and the dispute stays OPEN', async () => {
    const res = await request(as(0, ['connector.dispute_resolve']))
      .post(`/v1/attribution-disputes/${DISPUTE}/resolution`)
      .set('If-Match', '"0"')
      .set('Idempotency-Key', 'aud-p1-05-raiser')
      .send({ resolution: 'ATTRIBUTED_TO_FIRST', resolutionNotes: 'Raiser attempting to resolve' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.error.code).toBe('SOD_VIOLATION');
    const row = await env.admin.query(`select status from app.attribution_dispute where id = $1`, [DISPUTE]);
    expect(row.rows[0].status).toBe('OPEN');
  });

  it('lets a different authorised person resolve it', async () => {
    const res = await request(as(1, ['connector.dispute_resolve']))
      .post(`/v1/attribution-disputes/${DISPUTE}/resolution`)
      .set('If-Match', '"0"')
      .set('Idempotency-Key', 'aud-p1-05-other')
      .send({ resolution: 'ATTRIBUTED_TO_FIRST', resolutionNotes: 'Resolved by a second person' });

    expect(res.status).toBe(200);
    const row = await env.admin.query(`select status from app.attribution_dispute where id = $1`, [DISPUTE]);
    expect(row.rows[0].status).toBe('RESOLVED');
  });
});

describe('AUD-P1-03: a verification needs the consent of its own subject', () => {
  const check = (subjectId: string, consentRecordId: string) => ({
    subjectType: 'CUSTOMER',
    subjectId,
    checkType: 'PAN',
    method: 'MANUAL',
    purpose: 'KYC',
    consentRecordId,
    result: 'VERIFIED',
    minimalResult: { statusDescription: 'Audit regression match' },
    evidenceRef: 'audit-p1-03-evidence',
  });

  it('refuses a check of customer B that cites customer A’s consent, and records no verification', async () => {
    const res = await request(as(0, ['verification.perform']))
      .post('/v1/verifications')
      .set('Idempotency-Key', 'aud-p1-03-refused')
      .send(check(CUST_B, CONSENT_A));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.error.details?.[0]).toEqual({
      field: 'consentRecordId',
      issue: 'CONSENT_SUBJECT_MISMATCH',
    });
    const rows = await env.admin.query(
      `select count(*)::int as n from app.verification where subject_id = $1`,
      [CUST_B],
    );
    expect(rows.rows[0].n).toBe(0);
  });

  it('accepts a check of customer A with customer A’s own consent', async () => {
    const res = await request(as(0, ['verification.perform']))
      .post('/v1/verifications')
      .set('Idempotency-Key', 'aud-p1-03-accepted')
      .send(check(CUST_A, CONSENT_A));

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });
});
