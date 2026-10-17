// TEST-SEC-001 cases for module security (owner: Dev 1 / Platform, MOD-SEC, Module 39).
// Tenant B holds every security permission and still must not see or change tenant A incidents or events.
// Named operationIds: API-SEC-001, API-SEC-002, API-SEC-003, API-SEC-004, API-SEC-005, API-SEC-006.
import type { PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../harness';

let env: IsolationEnv;
let incidentAId: string;

beforeAll(async () => {
  env = await startIsolationEnv();
  incidentAId = 'inc_01JTESTINCA0000000000000000';

  // Seed an incident in Tenant A
  await env.admin.query(
    `INSERT INTO app.incident_record (
      id, tenant_id, type, severity, detected_at, personal_data_involved,
      affected_tenants, notifications, status, post_mortem_ref,
      lock_version, created_at, created_by, updated_at, updated_by
    ) VALUES (
      $1, $2, 'DATA_BREACH', 'HIGH', now(), true,
      '[]'::jsonb, '{}'::jsonb, 'OPEN', NULL,
      0, now(), $3, now(), $3
    )`,
    [incidentAId, env.A.tenantId, env.A.userIds[0]],
  );

  // Seed a security event in Tenant A
  await env.admin.query(
    `INSERT INTO app.security_event (
      id, tenant_id, type, principal, ip, severity, details, created_at
    ) VALUES (
      'sec_01JTESTSECA0000000000000000', $1, 'AUTH_FAILURE', $2, '127.0.0.1', 'MEDIUM', '{}'::jsonb, now()
    )`,
    [env.A.tenantId, env.A.userIds[0]],
  );
});

afterAll(async () => {
  await env?.stop();
});

const SEC_CODES: PermissionCode[] = ['security.incident', 'security.vuln'];

describe('TEST-SEC-001 security: tenants never cross', () => {
  it('API-SEC-003 API-SEC-004: tenant B cannot read or list tenant A incidents', async () => {
    const a = env.appAs(env.A, SEC_CODES);
    const b = env.appAs(env.B, SEC_CODES);

    const aRes = await request(a).get(`/v1/incidents/${incidentAId}`);
    expect(aRes.status).toBe(200);

    // Tenant B gets 404 for Tenant A incident
    const bGet = await request(b).get(`/v1/incidents/${incidentAId}`);
    expect(bGet.status).toBe(404);

    // Tenant B list does not contain Tenant A incident
    const bList = await request(b).get('/v1/incidents');
    expect(bList.status).toBe(200);
    const bIds = bList.body.data.map((x: { id: string }) => x.id);
    expect(bIds).not.toContain(incidentAId);
  });

  it('API-SEC-001 API-SEC-002: tenant B cannot update tenant A incident or cross-create', async () => {
    const b = env.appAs(env.B, SEC_CODES);

    // Tenant B cannot PATCH Tenant A incident
    const bPatch = await request(b)
      .patch(`/v1/incidents/${incidentAId}`)
      .set('If-Match', '"0"')
      .send({ status: 'CONTAINED' });
    expect(bPatch.status).toBe(404);

    const bCreate = await request(b)
      .post('/v1/incidents')
      .set('Idempotency-Key', 'idem-iso-inc-b01')
      .send({
        type: 'UNAUTHORIZED_ACCESS',
        severity: 'MEDIUM',
        detectedAt: new Date().toISOString(),
      });
    expect(bCreate.status, JSON.stringify(bCreate.body)).toBe(201);
    expect(bCreate.body.tenantId).toBe(env.B.tenantId);
  });

  it('API-SEC-005 API-SEC-006: security events never cross tenants', async () => {
    const a = env.appAs(env.A, SEC_CODES);
    const b = env.appAs(env.B, SEC_CODES);

    const aEvents = await request(a).get('/v1/security/events');
    expect(aEvents.status).toBe(200);
    expect(aEvents.body.data.length).toBeGreaterThan(0);

    const bEvents = await request(b).get('/v1/security/events');
    expect(bEvents.status).toBe(200);
    const aEventIds = aEvents.body.data.map((x: { id: string }) => x.id);
    const bEventIds = bEvents.body.data.map((x: { id: string }) => x.id);
    for (const id of aEventIds) {
      expect(bEventIds).not.toContain(id);
    }
  });
});
