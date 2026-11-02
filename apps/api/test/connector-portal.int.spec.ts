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
  // A second branch with its own intake queue, and a connector that belongs to it (other-branch duplicates and isolation).
  const [origin] = (await q(`select organisation_id from app.branch where id = $1`, [a.branchId])).rows;
  await q(
    `insert into app.branch (id, tenant_id, organisation_id, code, name, created_by, updated_by)
     values ('br_cpt_2', $1, $2, 'MUM02', 'Second Branch', 'iso', 'iso')`,
    [a.tenantId, origin.organisation_id],
  );
  await q(
    `insert into app.team (id, tenant_id, name, branch_id, manager_user_id, created_by, updated_by)
     values ('team_cpt_2', $1, 'Sales Two', 'br_cpt_2', $2, 'iso', 'iso')`,
    [a.tenantId, a.userIds[0]],
  );
  await q(
    `insert into app.work_queue (id, tenant_id, code, name, kind, branch_id, record_types, created_by, updated_by)
     values ('wq_cpt_2', $1, 'MUM02-INTAKE', 'Intake', 'INTAKE', 'br_cpt_2', '{LEAD}', 'iso', 'iso')`,
    [a.tenantId],
  );
  await q(
    `insert into app.connector (id, tenant_id, connector_type, legal_name, contact_person, mobile_e164, mobile_hash, email, email_hash,
                                encrypted_pan, pan_hash, pan_masked, primary_branch_id, relationship_owner_user_id, status,
                                created_by, updated_by)
     values ('con_cpt_2', $1, 'INDIVIDUAL', 'Synthetic Connector Two', 'Connector Two', '+919876500522', $2, 'con2@cpt.example.com',
             $3, $4, $5, 'XXXXX1234X', 'br_cpt_2', $6, 'ACTIVE', 'iso', 'iso')`,
    [a.tenantId, h('m2'), h('e2'), Buffer.from('synthetic'), h('p2'), a.userIds[0]],
  );
  await q(
    `insert into app.app_user (id, tenant_id, idp_subject, email, display_name, user_type, primary_branch_id, connector_id,
                               created_by, updated_by)
     values ('usr_cpt_2', $1, 'sub-cpt-2', 'portal2@cpt.example.com', 'Portal User Two', 'CONNECTOR', 'br_cpt_2', 'con_cpt_2', 'iso', 'iso')`,
    [a.tenantId],
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
        category: 'COMMISSION_CALCULATION',
        reason: 'Rate applied is lower than agreed',
      });
    expect(dispute.status, JSON.stringify(dispute.body)).toBe(201);
    const rate = await request(portal()).get('/portal/v1/rate-card');
    expect(rate.body).toEqual({ connectorId: CONNECTOR, agreement: null });
  });

  it('TEST-CPT-INT-04 a consent code cannot be replayed, used after expiry, or guessed past its attempt limit', async () => {
    const app = portal();
    // Replay: the code that created the referral in TEST-CPT-INT-02 is spent.
    const used = await env.admin.query(
      `select id from app.referral_consent_otp where used_by_lead is not null limit 1`,
      [],
    );
    const replay = await request(app)
      .post('/portal/v1/referrals')
      .set('Idempotency-Key', 'cpt_ref_000004')
      .send({
        fullName: 'Referred Again',
        mobile: '+919876500502',
        productCategory: 'PL',
        consentOtpId: used.rows[0].id,
      });
    expect(replay.status).toBe(422);
    expect(replay.body.error.code).toBe('CONSENT_REQUIRED');

    // Expiry: a code past its ten minutes cannot be verified.
    const expired = await request(app)
      .post('/portal/v1/referrals/consent-otp')
      .send({ action: 'SEND', mobile: '+919876500503' });
    await env.admin.query(
      `update app.referral_consent_otp set expires_at = now() - interval '1 minute' where id = $1`,
      [expired.body.otpId],
    );
    const late = await request(app)
      .post('/portal/v1/referrals/consent-otp')
      .send({ action: 'VERIFY', otpId: expired.body.otpId, code: '123456' });
    expect(late.status).toBe(409);

    // Attempt limit: after five tries the code is dead, even if the next guess were right.
    const limited = await request(app)
      .post('/portal/v1/referrals/consent-otp')
      .send({ action: 'SEND', mobile: '+919876500504' });
    await env.admin.query(`update app.referral_consent_otp set attempts = 5 where id = $1`, [
      limited.body.otpId,
    ]);
    const capped = await request(app)
      .post('/portal/v1/referrals/consent-otp')
      .send({ action: 'VERIFY', otpId: limited.body.otpId, code: '123456' });
    expect(capped.status).toBe(409);
  });

  describe('duplicate referrals (TEST-CPT-DUP)', () => {
    const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
    // A verified consent code. The code is set directly, so the test does not search the code space.
    const consent = async (app: ReturnType<typeof portal>, mobile: string) => {
      const sent = await request(app)
        .post('/portal/v1/referrals/consent-otp')
        .send({ action: 'SEND', mobile });
      expect(sent.status, JSON.stringify(sent.body)).toBe(200);
      await env.admin.query(`update app.referral_consent_otp set code_hash = $2 where id = $1`, [
        sent.body.otpId,
        sha(`${sent.body.otpId}:246810`),
      ]);
      const ok = await request(app)
        .post('/portal/v1/referrals/consent-otp')
        .send({ action: 'VERIFY', otpId: sent.body.otpId, code: '246810' });
      expect(ok.body.status).toBe('VERIFIED');
      return sent.body.otpId as string;
    };
    const refer = (app: ReturnType<typeof portal>, mobile: string, otpId: string, key: string) =>
      request(app)
        .post('/portal/v1/referrals')
        .set('Idempotency-Key', key)
        .send({ fullName: 'Duplicate Check', mobile, productCategory: 'PL', consentOtpId: otpId });

    it('TEST-CPT-DUP-01 an open enquiry in the same branch refuses the referral: nothing is created, the consent code stays unused and the answer names no record', async () => {
      const app = portal();
      const mobile = '+919876500801';
      const first = await refer(app, mobile, await consent(app, mobile), 'cpt_dup_000001');
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      const otpId = await consent(app, mobile);
      const second = await refer(app, mobile, otpId, 'cpt_dup_000002');
      expect(second.status, JSON.stringify(second.body)).toBe(409);
      expect(second.body.error.code).toBe('INVALID_STATE');
      expect(JSON.stringify(second.body)).not.toContain(first.body.id);
      expect(JSON.stringify(second.body)).not.toContain(CONNECTOR);
      const leads = await env.admin.query(
        `select count(*)::int as n from app.lead where connector_id = $1 and mobile_e164 = $2`,
        [CONNECTOR, mobile],
      );
      expect(leads.rows[0].n).toBe(1);
      const otp = await env.admin.query(`select used_by_lead from app.referral_consent_otp where id = $1`, [
        otpId,
      ]);
      expect(otp.rows[0].used_by_lead).toBeNull();
    });

    it('TEST-CPT-DUP-02 an open enquiry in another branch does not refuse the referral: it is created and flagged for internal review', async () => {
      const mobile = '+919876500802';
      const first = await refer(portal(), mobile, await consent(portal(), mobile), 'cpt_dup_000003');
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      const second = await refer(
        portal('usr_cpt_2'),
        mobile,
        await consent(portal('usr_cpt_2'), mobile),
        'cpt_dup_000004',
      );
      expect(second.status, JSON.stringify(second.body)).toBe(201);
      const lead = await env.admin.query(
        `select branch_id, duplicate_flag, duplicate_candidate_ids from app.lead where id = $1`,
        [second.body.id],
      );
      expect(lead.rows[0]).toMatchObject({ branch_id: 'br_cpt_2', duplicate_flag: 'POSSIBLE' });
      expect(lead.rows[0].duplicate_candidate_ids).toContain(first.body.id);
    });
  });

  describe('partner disputes (TEST-CPT-DSP)', () => {
    const DISPUTE_PAYABLE = 'cpay_cpt_2';
    const raise = (app: ReturnType<typeof portal>, key: string, body: Record<string, unknown>) =>
      request(app).post('/portal/v1/disputes').set('Idempotency-Key', key).send(body);

    it('TEST-CPT-DSP-01 a category outside the approved set is refused, and so is one that does not fit the item', async () => {
      await env.admin.query(`set session_replication_role = replica`, []);
      await env.admin.query(
        `insert into app.commission_payable (id, tenant_id, calculation_id, connector_id, share_rate, amount, state, created_by, updated_by)
         values ($1, $2, 'ccal_cpt_2', $3, 0.5, 900.00, 'ELIGIBLE', 'iso', 'iso')`,
        [DISPUTE_PAYABLE, env.A.tenantId, CONNECTOR],
      );
      await env.admin.query(`set session_replication_role = origin`, []);
      const app = portal();
      const reason = 'The share rate on this line is wrong.';
      const unknown = await raise(app, 'cpt_dsp_000001', {
        subjectType: 'STATEMENT_LINE',
        subjectId: DISPUTE_PAYABLE,
        category: 'REFERRAL_STATUS',
        reason,
      });
      expect(unknown.status).toBe(422);
      const mismatch = await raise(app, 'cpt_dsp_000002', {
        subjectType: 'STATEMENT_LINE',
        subjectId: DISPUTE_PAYABLE,
        category: 'PAYOUT',
        reason,
      });
      expect(mismatch.status, JSON.stringify(mismatch.body)).toBe(422);
      expect(mismatch.body.error.details?.[0]).toMatchObject({
        field: 'category',
        issue: 'NOT_ALLOWED_FOR_SUBJECT',
      });
      const none = await env.admin.query(`select count(*)::int as n from app.dispute where subject_id = $1`, [
        DISPUTE_PAYABLE,
      ]);
      expect(none.rows[0].n).toBe(0);
    });

    it('TEST-CPT-DSP-02 a valid category is stored, echoed, and listed with the connector’s own disputes', async () => {
      const app = portal();
      const created = await raise(app, 'cpt_dsp_000003', {
        subjectType: 'STATEMENT_LINE',
        subjectId: DISPUTE_PAYABLE,
        category: 'COMMISSION_CALCULATION',
        reason: 'The share rate on this line is wrong.',
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body).toMatchObject({ status: 'OPEN', category: 'COMMISSION_CALCULATION' });
      const row = await env.admin.query(`select category, party_id from app.dispute where id = $1`, [
        created.body.id,
      ]);
      expect(row.rows[0]).toEqual({ category: 'COMMISSION_CALCULATION', party_id: CONNECTOR });
      const list = await request(app).get('/portal/v1/disputes');
      expect(list.status).toBe(200);
      const mine = list.body.data.find((d: { id: string }) => d.id === created.body.id);
      expect(mine).toMatchObject({
        subjectType: 'STATEMENT_LINE',
        subjectId: DISPUTE_PAYABLE,
        category: 'COMMISSION_CALCULATION',
        status: 'OPEN',
      });
      expect(mine).not.toHaveProperty('resolution');
    });

    it('TEST-CPT-DSP-03 another connector cannot dispute this connector’s statement line, and sees none of its disputes', async () => {
      const other = portal('usr_cpt_2');
      const attempt = await raise(other, 'cpt_dsp_000004', {
        subjectType: 'STATEMENT_LINE',
        subjectId: DISPUTE_PAYABLE,
        category: 'OTHER',
        reason: 'This line is not mine to dispute.',
      });
      expect(attempt.status).toBe(404);
      const list = await request(other).get('/portal/v1/disputes');
      expect(list.status).toBe(200);
      expect(list.body.data).toEqual([]);
    });
  });

  describe('payout of a disputed line (TEST-CPT-PAYD)', () => {
    const DISPUTED = 'cpay_cpt_disputed';
    it('TEST-CPT-PAYD-01 a payable line under an open dispute cannot be paid, and no payout request is written for it', async () => {
      await env.admin.query(`set session_replication_role = replica`, []);
      await env.admin.query(
        `insert into app.commission_payable (id, tenant_id, calculation_id, connector_id, share_rate, amount, state, created_by, updated_by)
         values ($1, $2, 'ccal_cpt_3', $3, 0.5, 700.00, 'ELIGIBLE', 'iso', 'iso')`,
        [DISPUTED, env.A.tenantId, CONNECTOR],
      );
      await env.admin.query(`set session_replication_role = origin`, []);
      const raised = await request(portal())
        .post('/portal/v1/disputes')
        .set('Idempotency-Key', 'cpt_payd_000001')
        .send({
          subjectType: 'STATEMENT_LINE',
          subjectId: DISPUTED,
          category: 'COMMISSION_CALCULATION',
          reason: 'Share rate is wrong here',
        });
      expect(raised.status, JSON.stringify(raised.body)).toBe(201);

      const before = await env.admin.query(
        `select count(*)::int as n from app.payout_request where connector_id = $1`,
        [CONNECTOR],
      );
      const res = await request(portal())
        .post('/portal/v1/payout-requests')
        .set('Idempotency-Key', 'cpt_payd_000002')
        .send({ payableIds: [DISPUTED] });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.error.details?.[0]).toMatchObject({ field: 'payableIds', issue: 'NOT_PAYABLE' });
      const after = await env.admin.query(
        `select count(*)::int as n from app.payout_request where connector_id = $1`,
        [CONNECTOR],
      );
      expect(after.rows[0].n).toBe(before.rows[0].n);
      const state = await env.admin.query(`select state from app.commission_payable where id = $1`, [
        DISPUTED,
      ]);
      expect(state.rows[0].state).toBe('ELIGIBLE');
    });
  });
});
