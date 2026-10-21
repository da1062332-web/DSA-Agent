// MOD-INT connections are stored and audited (audit 2026-10-19): app.integration_connection, ENT-103. Synthetic data only.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

let env: IsolationEnv;
beforeAll(async () => {
  env = await startIsolationEnv();
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

const body = (tenantId: string) => ({
  capability: 'STORAGE.DOC_SCAN',
  environment: 'SANDBOX',
  credentialRef: `vault://tenants/${tenantId}/sandbox/mock/credentials`,
  config: { maxSizeBytes: 1048576 },
  status: 'ACTIVE',
});

describe('TEST-INT-PERSIST integration connections live in the database', () => {
  it('TEST-INT-PERSIST-01 a configured connection survives a new app instance, is audited, and is invisible to tenant B', async () => {
    const created = await request(env.appAs(env.A, ['integration.manage', 'integration.read']))
      .put('/v1/integrations/MOCK')
      .send(body(env.A.tenantId));
    expect(created.status, JSON.stringify(created.body)).toBe(200);

    // A fresh app (a new process in production) still sees it.
    const read = await request(env.appAs(env.A, ['integration.read'])).get(
      '/v1/integrations/MOCK?capability=STORAGE.DOC_SCAN',
    );
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body).toMatchObject({ provider: 'MOCK', capability: 'STORAGE.DOC_SCAN', lockVersion: 1 });

    const audit = await env.admin.query(
      `select action from app.audit_event where entity_type = 'INTEGRATION_CONNECTION' and tenant_id = $1`,
      [env.A.tenantId],
    );
    expect(audit.rows.map((r) => r.action)).toContain('integration.configured');

    const other = await request(env.appAs(env.B, ['integration.read'])).get('/v1/integrations');
    expect(other.status).toBe(200);
    expect(other.body.data).toEqual([]);
  });

  it('TEST-INT-PERSIST-02 an update needs the current version', async () => {
    const app = env.appAs(env.A, ['integration.manage', 'integration.read']);
    const stale = await request(app)
      .put('/v1/integrations/MOCK')
      .set('If-Match', '"7"')
      .send(body(env.A.tenantId));
    expect(stale.status).toBe(409);
    const ok = await request(app)
      .put('/v1/integrations/MOCK')
      .set('If-Match', '"1"')
      .send({ ...body(env.A.tenantId), status: 'INACTIVE' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.lockVersion).toBe(2);
  });
});
