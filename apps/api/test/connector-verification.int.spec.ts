// Connector verification (migration 0101) against a real database: activation and bank accounts take only a VERIFIED verification of the
// connector itself, and the database refuses an invalid subject combination (TEST-CVER). Synthetic data only. The verification rows are
// written directly, because the API cannot record a connector verification until connector consent is decided (see the decision note).
import crypto from 'node:crypto';
import type { PermissionCode, Principal } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { createProductionDeps } from '../src/wiring';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import { fakeAuth, testPrincipal } from './support/fake-auth';

let env: IsolationEnv;
const MANAGER = 'usr_cv_mgr';
const CV_A = 'con_cv_a'; // activated with its own verification
const CV_B = 'con_cv_b'; // must not be activated with CV_A's or a customer's verification
const CV_C = 'con_cv_c'; // its only verification is REJECTED
const CUST = 'cust_cv_1';
const CONSENT = 'cns_cv_1';
// A ULID is 26 characters: four for the time, then twenty-two more. The API checks the shape of the id before anything else.
const ulid = (n: string) => `01JZ${'0'.repeat(21)}${n}`;
const V_A = `ver_${ulid('1')}`;
const V_B = `ver_${ulid('2')}`;
const V_CUST = `ver_${ulid('3')}`;
const V_REJ_C = `ver_${ulid('4')}`;
const V_MISSING = `ver_${ulid('9')}`;
const h = (s: string) => crypto.createHash('sha256').update(s).digest();

const as = (id: string, grants: PermissionCode[], overrides: Partial<Principal> = {}) =>
  createApp({
    deps: createProductionDeps(createTxRunner(env.db)),
    corsAllowedOrigins: [],
    auth: fakeAuth(
      testPrincipal({
        id,
        tenantId: env.A.tenantId,
        primaryBranchId: env.A.branchId,
        authTime: new Date().toISOString(),
        grants: grants.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] })),
        ...overrides,
      }),
    ),
  });
const manager = () => as(MANAGER, ['connector.manage', 'connector.read']);

beforeAll(async () => {
  env = await startIsolationEnv();
  const a = env.A;
  const q = (text: string, values: unknown[]) => env.admin.query(text, values);

  await q(
    `insert into app.app_user (id, tenant_id, idp_subject, email, display_name, primary_branch_id, created_by, updated_by)
     values ($1, $2, 'sub-cv-mgr', 'cvmgr@cv.example.com', 'Verification Manager', $3, 'iso', 'iso')`,
    [MANAGER, a.tenantId, a.branchId],
  );
  const connector = (id: string, n: number) =>
    q(
      `insert into app.connector (id, tenant_id, connector_type, legal_name, contact_person, mobile_e164, mobile_hash, email, email_hash,
                                  encrypted_pan, pan_hash, pan_masked, primary_branch_id, relationship_owner_user_id, status,
                                  created_by, updated_by)
       values ($1, $2, 'INDIVIDUAL', $3, 'Synthetic Contact', $4, $5, $6, $7, $8, $9, 'XXXXX1234X', $10, $11, 'PENDING_VERIFICATION', 'iso', 'iso')`,
      [
        id,
        a.tenantId,
        `Synthetic Verification Partner ${n}`,
        `+91987650500${n}`,
        h(`m-${id}`),
        `${id}@cv.example.com`,
        h(`e-${id}`),
        Buffer.from('synthetic'),
        h(`p-${id}`),
        a.branchId,
        MANAGER,
      ],
    );
  await connector(CV_A, 1);
  await connector(CV_B, 2);
  await connector(CV_C, 3);

  await q(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Verification Customer', $3, $4, $4)`,
    [CUST, a.tenantId, a.branchId, a.userIds[0]],
  );
  await q(
    `insert into app.consent_record (id, tenant_id, subject_type, subject_id, purpose, purpose_target, notice_version, channel,
                                     captured_by, captured_at, status)
     values ($1, $2, 'CUSTOMER', $3, 'VERIFICATION_CHECK', 'pt_cv', 'PORTAL-V1', 'OTP', $4, now(), 'ACTIVE')`,
    [CONSENT, a.tenantId, CUST, MANAGER],
  );
  // The verification records. Each is append-only once written, so they are inserted once, here.
  const verification = (
    id: string,
    subjectType: string,
    subjectId: string,
    connectorId: string | null,
    result: string,
  ) =>
    q(
      `insert into app.verification (id, tenant_id, subject_type, subject_id, check_type, method, purpose, consent_record_id, result,
                                     minimal_result, evidence_ref, performed_by, performed_at, connector_id)
       values ($1, $2, $3, $4, 'PAN', 'MANUAL', 'KYC', $5, $6, '{}', 'evidence-ref', $7, now(), $8)`,
      [id, a.tenantId, subjectType, subjectId, CONSENT, result, MANAGER, connectorId],
    );
  await verification(V_A, 'CONNECTOR', CV_A, CV_A, 'VERIFIED');
  await verification(V_B, 'CONNECTOR', CV_B, CV_B, 'VERIFIED');
  await verification(V_CUST, 'CUSTOMER', CUST, null, 'VERIFIED');
  await verification(V_REJ_C, 'CONNECTOR', CV_C, CV_C, 'REJECTED');
}, 240_000);

afterAll(async () => {
  await env?.stop();
});

const activate = (connectorId: string, verificationId: string, key: string) =>
  request(manager())
    .post(`/v1/connectors/${connectorId}/activation`)
    .set('Idempotency-Key', key)
    .set('If-Match', '"0"')
    .send({ verificationId });

describe('connector verification (TEST-CVER)', () => {
  it('TEST-CVER-01 a connector is activated by a VERIFIED verification of that connector', async () => {
    const res = await activate(CV_A, V_A, 'cver_act_000001');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('ACTIVE');
    const row = await env.admin.query(`select status from app.connector where id = $1`, [CV_A]);
    expect(row.rows[0].status).toBe('ACTIVE');
  });

  it('TEST-CVER-02 a verification of another connector does not activate this connector', async () => {
    const res = await activate(CV_B, V_A, 'cver_act_000002');
    expect(res.status).toBe(422);
    expect(res.body.error.details?.[0]).toMatchObject({
      field: 'verificationId',
      issue: 'NOT_THIS_CONNECTOR',
    });
    expect(
      (await env.admin.query(`select status from app.connector where id = $1`, [CV_B])).rows[0].status,
    ).toBe('PENDING_VERIFICATION');
  });

  it('TEST-CVER-03 a verification of a customer, which is VERIFIED and in the same tenant, does not activate a connector', async () => {
    const res = await activate(CV_B, V_CUST, 'cver_act_000003');
    expect(res.status).toBe(422);
    expect(res.body.error.details?.[0]).toMatchObject({ issue: 'NOT_THIS_CONNECTOR' });
  });

  it('TEST-CVER-04 a REJECTED verification of the connector does not activate it', async () => {
    const res = await activate(CV_C, V_REJ_C, 'cver_act_000004');
    expect(res.status).toBe(422);
    expect(res.body.error.details?.[0]).toMatchObject({ issue: 'NOT_VERIFIED' });
  });

  it('TEST-CVER-05 a connector with no verification record yet (pending) cannot be activated', async () => {
    const res = await activate(CV_B, V_MISSING, 'cver_act_000005');
    expect(res.status).toBe(422);
    expect(res.body.error.details?.[0]).toMatchObject({ issue: 'NOT_FOUND' });
  });

  it('TEST-CVER-06 a bank account takes no verification of another connector or of a customer; without one it is accepted', async () => {
    const account = (verificationId?: string) =>
      request(manager())
        .post(`/v1/connectors/${CV_B}/bank-accounts`)
        .set('Idempotency-Key', `cver_bank_${verificationId ?? 'none'}`)
        .send({
          accountHolderName: 'Synthetic Holder',
          accountNumber: '123456789012',
          ifscCode: 'HDFC0001234',
          ...(verificationId ? { verificationId } : {}),
        });
    const customer = await account(V_CUST);
    expect(customer.status, JSON.stringify(customer.body)).toBe(422);
    expect(customer.body.error.details?.[0]).toMatchObject({ issue: 'NOT_THIS_CONNECTOR' });
    const other = await account(V_A);
    expect(other.status).toBe(422);
    const none = await account();
    expect(none.status, JSON.stringify(none.body)).toBe(201);
  });

  it('TEST-CVER-07 the database refuses an invalid subject combination, and a connector record from another tenant', async () => {
    const insert = (
      id: string,
      subjectType: string,
      subjectId: string,
      connectorId: string | null,
      tenantId = env.A.tenantId,
    ) =>
      env.admin.query(
        `insert into app.verification (id, tenant_id, subject_type, subject_id, check_type, method, purpose, consent_record_id, result,
                                       minimal_result, evidence_ref, performed_by, performed_at, connector_id)
         values ($1, $2, $3, $4, 'PAN', 'MANUAL', 'KYC', $5, 'VERIFIED', '{}', 'evidence-ref', $6, now(), $7)`,
        [id, tenantId, subjectType, subjectId, CONSENT, MANAGER, connectorId],
      );
    // A CONNECTOR subject without the connector it is about.
    await expect(insert(`ver_${ulid('5')}`, 'CONNECTOR', CV_A, null)).rejects.toThrow(
      /verification_connector_subject_check/,
    );
    // A customer subject that names a connector.
    await expect(insert(`ver_${ulid('6')}`, 'CUSTOMER', CUST, CV_A)).rejects.toThrow(
      /verification_connector_subject_check/,
    );
    // A connector subject whose subject and connector differ.
    await expect(insert(`ver_${ulid('7')}`, 'CONNECTOR', CV_B, CV_A)).rejects.toThrow(
      /verification_connector_subject_check/,
    );
    // A connector record of another tenant.
    const b = env.B;
    await env.admin.query(
      `insert into app.connector (id, tenant_id, connector_type, legal_name, contact_person, mobile_e164, mobile_hash, email, email_hash,
                                  encrypted_pan, pan_hash, pan_masked, primary_branch_id, relationship_owner_user_id, status,
                                  created_by, updated_by)
       values ('con_cv_tenant_b', $1, 'INDIVIDUAL', 'Tenant B Partner', 'Contact', '+919876509999', $2, 'tb@cv.example.com', $3,
               $4, $5, 'XXXXX1234X', $6, $7, 'PENDING_VERIFICATION', 'iso', 'iso')`,
      [b.tenantId, h('mb'), h('eb'), Buffer.from('synthetic'), h('pb'), b.branchId, b.userIds[0]],
    );
    await expect(
      insert(`ver_${ulid('8')}`, 'CONNECTOR', 'con_cv_tenant_b', 'con_cv_tenant_b', env.A.tenantId),
    ).rejects.toThrow(/verification_connector_fk/);
  });

  it('TEST-CVER-08 the existing verification workflow for customers still records and cannot be changed or removed', async () => {
    const id = `ver_${ulid('B')}`;
    await env.admin.query(
      `insert into app.verification (id, tenant_id, subject_type, subject_id, check_type, method, purpose, consent_record_id, result,
                                     minimal_result, evidence_ref, performed_by, performed_at)
       values ($1, $2, 'CUSTOMER', $3, 'PAN', 'MANUAL', 'KYC', $4, 'FLAGGED', '{}', 'evidence-ref', $5, now())`,
      [id, env.A.tenantId, CUST, CONSENT, MANAGER],
    );
    const row = await env.admin.query(
      `select subject_type, connector_id from app.verification where id = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({ subject_type: 'CUSTOMER', connector_id: null });
    await expect(
      env.admin.query(`update app.verification set notes = 'changed' where id = $1`, [id]),
    ).rejects.toThrow(/verification|forbid|immutable|not allowed/i);
  });
});
