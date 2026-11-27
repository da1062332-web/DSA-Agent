// TEST-SEC-001 cases for origination/verifications (owner: Prathamesh, MOD-VER, API-VER-003 POST /v1/verifications/checks). Tenant B
// holds every verification permission and still must not run a check on tenant A's consent or subject, nor use tenant A's provider
// connection. No provider is ever called: tenant A's connection points at a host that cannot resolve (.invalid), and tenant B has none.
import type { PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_ADMIN, startIsolationEnv, type IsolationEnv, type TenantFixture } from '../harness';

const VER: PermissionCode[] = [...ALL_ADMIN, 'verification.perform', 'verification.read'];

let env: IsolationEnv;
beforeAll(async () => {
  env = await startIsolationEnv();
});
afterAll(async () => {
  await env?.stop();
});

/** A valid consent id: cnst_ and 26 characters of the Crockford alphabet (the request schema enforces it). */
const consentId = (tag: string) => `cnst_${tag.padEnd(26, '0')}`;

async function seedSubject(t: TenantFixture, customerId: string, consent: string) {
  const user = t.userIds[0];
  await env.admin.query(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Isolation Customer', $3, $4, $4)`,
    [customerId, t.tenantId, t.branchId, user],
  );
  await env.admin.query(
    `insert into app.consent_record (id, tenant_id, subject_type, subject_id, purpose, purpose_target, notice_version, channel,
                                     captured_by, captured_at)
     values ($1, $2, 'CUSTOMER', $3, 'VERIFICATION_CHECK', 'KARZA', 'V1', 'IN_PERSON', $4, now())`,
    [consent, t.tenantId, customerId, user],
  );
}

const verificationCount = async (subjectId: string) =>
  (
    await env.admin.query('select count(*)::int as n from app.verification where subject_id = $1', [
      subjectId,
    ])
  ).rows[0].n;

const checkBody = (customerId: string, consent: string) => ({
  check: 'PAN',
  subjectType: 'CUSTOMER',
  subjectId: customerId,
  consentRecordId: consent,
  idNumber: 'QXZKW7391L',
});

describe('TEST-SEC-001 origination/verifications: tenants never cross', () => {
  it('API-VER-003: tenant B cannot run a check on a tenant A customer with tenant A consent (404, not 403) and nothing is stored', async () => {
    const consent = consentId('01JVERA1');
    await seedSubject(env.A, 'cus_iso_ver_a1', consent);
    const b = env.appAs(env.B, VER);

    const res = await request(b)
      .post('/v1/verifications/checks')
      .set('Idempotency-Key', 'iso-ver-check-01')
      .send(checkBody('cus_iso_ver_a1', consent));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(res.body)).not.toContain(env.A.tenantId);
    expect(await verificationCount('cus_iso_ver_a1')).toBe(0);
  });

  it("API-VER-003: tenant B cannot use tenant A's provider connection: B has none, so the answer is 422 NO_ACTIVE_CONNECTION", async () => {
    // Tenant A has an active Karza PAN connection; tenant B has a valid subject and consent of its own, and no connection.
    await env.admin.query(
      `insert into app.integration_connection (id, tenant_id, provider, capability, environment, credential_ref, config, status,
                                               created_by, updated_by)
       values ('itc_iso_ver_a1', $1, 'KARZA', 'VERIFICATION.PAN', 'SANDBOX', $2, $3::jsonb, 'ACTIVE', $4, $4)`,
      [
        env.A.tenantId,
        `vault://tenants/${env.A.tenantId}/sandbox/karza/credentials`,
        JSON.stringify({ apiEndpoint: 'https://kyc.example.invalid/v3/pan' }),
        env.A.userIds[0],
      ],
    );
    const consent = consentId('01JVERB1');
    await seedSubject(env.B, 'cus_iso_ver_b1', consent);
    const b = env.appAs(env.B, VER);

    const res = await request(b)
      .post('/v1/verifications/checks')
      .set('Idempotency-Key', 'iso-ver-check-02')
      .send(checkBody('cus_iso_ver_b1', consent));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([{ field: 'check', issue: 'NO_ACTIVE_CONNECTION' }]);
    expect(JSON.stringify(res.body)).not.toContain(env.A.tenantId);
    expect(await verificationCount('cus_iso_ver_b1')).toBe(0);
  });

  it('API-VER-003: a user without verification.perform is refused (403) before anything is read, in either tenant', async () => {
    const consent = consentId('01JVERB2');
    await seedSubject(env.B, 'cus_iso_ver_b2', consent);
    const readOnly = env.appAs(env.B, [...ALL_ADMIN, 'verification.read']);

    const res = await request(readOnly)
      .post('/v1/verifications/checks')
      .set('Idempotency-Key', 'iso-ver-check-03')
      .send(checkBody('cus_iso_ver_b2', consent));

    expect(res.status).toBe(403);
    expect(await verificationCount('cus_iso_ver_b2')).toBe(0);
  });
});
