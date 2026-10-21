// MOD-CPT connector portal (/portal/v1, API-CPT-001..007) against a real database (M-084), with the production wiring.
// Synthetic data only. The payable fixture is inserted with FK triggers off (superuser seed), so the commission chain behind
// it (calculation, tranche, sanction) does not have to be built for a portal test.
import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { createProductionDeps } from '../src/wiring';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import { fakeAuth, testPrincipal } from './support/fake-auth';

let env: IsolationEnv;
const CONNECTOR = 'con_cpt_1';
const CONNECTOR_USER = 'usr_cpt_1';
const PAYABLE = 'cpay_cpt_1';

beforeAll(async () => {
  env = await startIsolationEnv();
  const a = env.A;
  const q = (text: string, values: unknown[]) => env.admin.query(text, values);
  const h = (s: string) => crypto.createHash('sha256').update(s).digest();
  await q(
    `insert into app.connector (id, tenant_id, connector_type, legal_name, contact_person, mobile_e164, mobile_hash, email, email_hash,
                                encrypted_pan, pan_hash, pan_masked, primary_branch_id, relationship_owner_user_id, status,
                                created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Synthetic Connector', 'Connector Person', '+919876500501', $3, 'con@cpt.example.com', $4,
             $5, $6, 'XXXXX1234X', $7, $8, 'ACTIVE', 'iso', 'iso')`,
    [CONNECTOR, a.tenantId, h('m'), h('e'), Buffer.from('synthetic'), h('p'), a.branchId, a.userIds[0]],
  );
  await q(
    `insert into app.app_user (id, tenant_id, idp_subject, email, display_name, user_type, primary_branch_id, connector_id,
                               created_by, updated_by)
     values ($1, $2, 'sub-cpt-1', 'portal@cpt.example.com', 'Portal User', 'CONNECTOR', $3, $4, 'iso', 'iso')`,
    [CONNECTOR_USER, a.tenantId, a.branchId, CONNECTOR],
  );
  await q(`set session_replication_role = replica`, []);
  await q(
    `insert into app.commission_payable (id, tenant_id, calculation_id, connector_id, share_rate, amount, state, created_by, updated_by)
     values ($1, $2, 'ccal_cpt_1', $3, 0.5, 2500.00, 'ELIGIBLE', 'iso', 'iso')`,
    [PAYABLE, a.tenantId, CONNECTOR],
  );
  await q(`set session_replication_role = origin`, []);
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

const portal = (id = CONNECTOR_USER, recentMfa = true) =>
  createApp({
    deps: createProductionDeps(createTxRunner(env.db)),
    corsAllowedOrigins: [],
    auth: fakeAuth(
      testPrincipal({
        id,
        tenantId: env.A.tenantId,
        primaryBranchId: env.A.branchId,
        authTime: recentMfa ? new Date().toISOString() : null,
        grants: [],
      }),
    ),
  });

describe('TEST-CPT-INT connector portal', () => {
  it('TEST-CPT-INT-01 staff users are refused; the connector sees an empty referral list', async () => {
    expect((await request(portal(env.A.userIds[0])).get('/portal/v1/referrals')).status).toBe(403);
    const mine = await request(portal()).get('/portal/v1/referrals');
    expect(mine.status).toBe(200);
    expect(mine.body.data).toEqual([]);
  });

  it('TEST-CPT-INT-02 API-CPT-003/002 a referral needs a verified consent code for that mobile, then shows masked', async () => {
    const app = portal();
    const sent = await request(app)
      .post('/portal/v1/referrals/consent-otp')
      .send({ action: 'SEND', mobile: '+919876500502' });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(JSON.stringify(sent.body)).not.toMatch(/\b\d{6}\b/);
    const noConsent = await request(app)
      .post('/portal/v1/referrals')
      .set('Idempotency-Key', 'cpt_ref_000001')
      .send({
        fullName: 'Referred Person',
        mobile: '+919876500502',
        productCategory: 'PL',
        consentOtpId: sent.body.otpId,
      });
    expect(noConsent.status).toBe(422);

    // The code reaches the customer by SMS; the test learns it by trying the hash against the stored one.
    const stored = await env.admin.query(`select code_hash from app.referral_consent_otp where id = $1`, [
      sent.body.otpId,
    ]);
    let code = '';
    for (let i = 0; i < 1_000_000 && !code; i++) {
      const c = String(i).padStart(6, '0');
      if (
        crypto.createHash('sha256').update(`${sent.body.otpId}:${c}`).digest('hex') ===
        stored.rows[0].code_hash
      )
        code = c;
    }
    const wrong = await request(app)
      .post('/portal/v1/referrals/consent-otp')
      .send({ action: 'VERIFY', otpId: sent.body.otpId, code: code === '000000' ? '000001' : '000000' });
    expect(wrong.body.status).toBe('INCORRECT');
    const ok = await request(app)
      .post('/portal/v1/referrals/consent-otp')
      .send({ action: 'VERIFY', otpId: sent.body.otpId, code });
    expect(ok.body.status).toBe('VERIFIED');

    const otherMobile = await request(app)
      .post('/portal/v1/referrals')
      .set('Idempotency-Key', 'cpt_ref_000002')
      .send({
        fullName: 'Referred Person',
        mobile: '+919876500599',
        productCategory: 'PL',
        consentOtpId: sent.body.otpId,
      });
    expect(otherMobile.status).toBe(422);
    const created = await request(app)
      .post('/portal/v1/referrals')
      .set('Idempotency-Key', 'cpt_ref_000003')
      .send({
        fullName: 'Referred Person',
        mobile: '+919876500502',
        productCategory: 'PL',
        consentOtpId: sent.body.otpId,
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const lead = await env.admin.query(`select connector_id, source from app.lead where id = $1`, [
      created.body.id,
    ]);
    expect(lead.rows[0]).toEqual({ connector_id: CONNECTOR, source: 'REFERRAL' });
    const list = await request(app).get('/portal/v1/referrals');
    expect(list.body.data[0]).toMatchObject({ id: created.body.id, status: 'RECEIVED' });
    expect(list.body.data[0].name).not.toBe('Referred Person');
  });

  it('TEST-CPT-INT-03 API-CPT-004/005/006 statement totals, a payout request with MFA, and a dispute', async () => {
    const st = await request(portal()).get('/portal/v1/statements');
    expect(st.status).toBe(200);
    expect(st.body.totals.expected).toEqual({ amount: '2500.00', currency: 'INR' });

    const noMfa = await request(portal(CONNECTOR_USER, false))
      .post('/portal/v1/payout-requests')
      .set('Idempotency-Key', 'cpt_pay_000001')
      .send({ payableIds: [PAYABLE] });
    expect(noMfa.status).toBe(401);
    const pay = await request(portal())
      .post('/portal/v1/payout-requests')
      .set('Idempotency-Key', 'cpt_pay_000002')
      .send({ payableIds: [PAYABLE] });
    expect(pay.status, JSON.stringify(pay.body)).toBe(201);
    expect(pay.body.total).toEqual({ amount: '2500.00', currency: 'INR' });
    const twice = await request(portal())
      .post('/portal/v1/payout-requests')
      .set('Idempotency-Key', 'cpt_pay_000003')
      .send({ payableIds: [PAYABLE] });
    expect(twice.status).toBe(422);

    const dispute = await request(portal())
      .post('/portal/v1/disputes')
      .set('Idempotency-Key', 'cpt_dsp_000001')
      .send({
        subjectType: 'STATEMENT_LINE',
        subjectId: PAYABLE,
        reason: 'Rate applied is lower than agreed',
      });
    expect(dispute.status, JSON.stringify(dispute.body)).toBe(201);
    const rate = await request(portal()).get('/portal/v1/rate-card');
    expect(rate.body).toEqual({ connectorId: CONNECTOR, agreement: null });
  });
});
