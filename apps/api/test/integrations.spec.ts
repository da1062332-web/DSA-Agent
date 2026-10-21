// apps/api/test/integrations.spec.ts — Module 28: Integration Management (MOD-INT) Test Suite
import type { RequestContext, Tx, TxRunner } from '@dsa/contracts';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../src/http/error-handler';
import { IntegrationService } from '../src/modules/integrations/integration-service';
import { createRouter } from '../src/modules/integrations/router';
import { createTestDeps, fakeAuth, testPrincipal } from './support/fake-auth';

describe('Module 28 — Integration Management (MOD-INT: SUB-INT.01 Adapter Framework)', () => {
  const tenantAdmin = testPrincipal({
    id: 'usr_tenant_admin_01',
    tenantId: 'ten_demo_01',
    grants: [
      { code: 'config.manage', scope: 'TENANT', branchIds: [] },
      { code: 'integration.manage', scope: 'TENANT', branchIds: [] },
      { code: 'integration.read', scope: 'TENANT', branchIds: [] },
    ],
  });

  const tenantBAdmin = testPrincipal({
    id: 'usr_tenant_admin_02',
    tenantId: 'ten_demo_02',
    grants: [
      { code: 'config.manage', scope: 'TENANT', branchIds: [] },
      { code: 'integration.manage', scope: 'TENANT', branchIds: [] },
      { code: 'integration.read', scope: 'TENANT', branchIds: [] },
    ],
  });

  const unprivilegedUser = testPrincipal({
    id: 'usr_regular_rm_01',
    tenantId: 'ten_demo_01',
    grants: [{ code: 'lead.read', scope: 'TENANT', branchIds: [] }],
  });

  // No database in unit tests: the service uses its in-memory store with the seeded demo connections.
  const dummyTxRunner: TxRunner = {
    async withTenantTx<T>(_ctx: RequestContext, _fn: (tx: Tx) => Promise<T>): Promise<T> {
      throw new Error('No TxRunner in unit tests');
    },
  };

  const sharedService = new IntegrationService(createTestDeps({ txRunner: dummyTxRunner }));

  const createTestApp = (principal = tenantAdmin) => {
    const app = express();
    app.use(express.json());
    app.use(fakeAuth(principal));
    const deps = createTestDeps({ txRunner: dummyTxRunner });
    app.use('/v1', createRouter(deps, sharedService));
    app.use(errorHandler());
    return app;
  };

  // ==========================================
  // 1. CAPABILITY CATALOGUE
  // ==========================================
  it('GET /v1/integrations/capabilities lists standard platform capability descriptors', async () => {
    const app = createTestApp(tenantAdmin);
    const res = await request(app).get('/v1/integrations/capabilities');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(4);

    const smsCap = res.body.data.find((c: { capability: string }) => c.capability === 'MESSAGING.SMS');
    expect(smsCap).toBeDefined();
    expect(smsCap.category).toBe('MESSAGING');
    expect(smsCap.dataClassification).toBe('S2');
  });

  // ==========================================
  // 2. INTEGRATIONS LISTING & ZERO SECRETS
  // ==========================================
  it('GET /v1/integrations lists tenant connections with zero plaintext secrets', async () => {
    const app = createTestApp(tenantAdmin);
    const res = await request(app).get('/v1/integrations');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);

    const first = res.body.data[0];
    expect(first.id).toMatch(/^itc_/);
    expect(first.tenantId).toBe('ten_demo_01');
    expect(first.credentialRef).toMatch(/^vault:\/\/tenants\//);
    expect(first.config).toBeDefined();

    // Verify zero plaintext secrets in output
    const rawOutput = JSON.stringify(res.body);
    expect(rawOutput).not.toContain('mock_auth_token_secret_value');
    expect(rawOutput).not.toContain('mock_karza_api_key_sand_99999');
  });

  // ==========================================
  // 3. AUTHORIZATION ENFORCEMENT
  // ==========================================
  it('GET /v1/integrations rejects unprivileged users with 403 FORBIDDEN', async () => {
    const app = createTestApp(unprivilegedUser);
    const res = await request(app).get('/v1/integrations');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  // ==========================================
  // 4. GET SINGLE INTEGRATION WITH ETAG
  // ==========================================
  it('GET /v1/integrations/:provider returns single record with ETag lock version', async () => {
    const app = createTestApp(tenantAdmin);
    const res = await request(app).get('/v1/integrations/TWILIO?capability=MESSAGING.SMS');

    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('TWILIO');
    expect(res.body.capability).toBe('MESSAGING.SMS');
    expect(res.headers.etag).toBe(`"${res.body.lockVersion}"`);
  });

  // ==========================================
  // 5. OPTIMISTIC CONCURRENCY CONTROL (If-Match)
  // ==========================================
  it('PUT /v1/integrations/:provider enforces If-Match header and optimistic locking', async () => {
    const app = createTestApp(tenantAdmin);

    // 1. Fetch current ETag
    const getRes = await request(app).get('/v1/integrations/TWILIO?capability=MESSAGING.SMS');
    expect(getRes.status).toBe(200);
    const currentEtag = getRes.headers.etag;
    expect(currentEtag).toBeDefined();

    // 2. Attempt update without If-Match -> 400 MALFORMED_REQUEST
    const missingIfMatchRes = await request(app)
      .put('/v1/integrations/TWILIO')
      .send({
        capability: 'MESSAGING.SMS',
        environment: 'SANDBOX',
        credentialRef: 'vault://tenants/ten_demo_01/sandbox/twilio/credentials',
        config: { senderId: 'NEWDSA', timeoutMs: 4000 },
        status: 'ACTIVE',
      });
    expect(missingIfMatchRes.status).toBe(400);
    expect(missingIfMatchRes.body.error.code).toBe('MALFORMED_REQUEST');

    // 3. Attempt update with stale If-Match -> 409 VERSION_CONFLICT
    const staleRes = await request(app)
      .put('/v1/integrations/TWILIO')
      .set('If-Match', '"999"')
      .send({
        capability: 'MESSAGING.SMS',
        environment: 'SANDBOX',
        credentialRef: 'vault://tenants/ten_demo_01/sandbox/twilio/credentials',
        config: { senderId: 'NEWDSA', timeoutMs: 4000 },
        status: 'ACTIVE',
      });
    expect(staleRes.status).toBe(409);
    expect(staleRes.body.error.code).toBe('VERSION_CONFLICT');

    // 4. Valid update with current If-Match -> 200 OK and incremented ETag
    const validRes = await request(app)
      .put('/v1/integrations/TWILIO')
      .set('If-Match', currentEtag!)
      .send({
        capability: 'MESSAGING.SMS',
        environment: 'SANDBOX',
        credentialRef: 'vault://tenants/ten_demo_01/sandbox/twilio/credentials',
        config: { senderId: 'NEWDSA', timeoutMs: 4000 },
        status: 'ACTIVE',
      });
    expect(validRes.status).toBe(200);
    expect(validRes.body.config.senderId).toBe('NEWDSA');
    expect(validRes.body.lockVersion).toBe(getRes.body.lockVersion + 1);
    expect(validRes.headers.etag).toBe(`"${validRes.body.lockVersion}"`);
  });

  // ==========================================
  // 6. CONFIG VALIDATION & SECRET INJECTION REJECTION
  // ==========================================
  it('PUT /v1/integrations/:provider rejects configuration containing raw credentials with 422 VALIDATION_ERROR', async () => {
    const app = createTestApp(tenantAdmin);

    const res = await request(app)
      .put('/v1/integrations/MOCK')
      .send({
        capability: 'VERIFICATION.PAN',
        environment: 'SANDBOX',
        credentialRef: 'vault://tenants/ten_demo_01/sandbox/mock/credentials',
        config: {
          apiKey: 'injected_plaintext_secret_key_12345',
          endpoint: 'https://api.example.com',
        },
        status: 'ACTIVE',
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0]?.field).toBe('config');
  });

  // ==========================================
  // 7. CAPABILITY VALIDATION
  // ==========================================
  it('PUT /v1/integrations/:provider rejects unrecognized capability names with 422 VALIDATION_ERROR', async () => {
    const app = createTestApp(tenantAdmin);

    const res = await request(app)
      .put('/v1/integrations/MOCK')
      .send({
        capability: 'UNKNOWN_CAPABILITY_FOO_BAR',
        environment: 'SANDBOX',
        credentialRef: 'vault://tenants/ten_demo_01/sandbox/mock/credentials',
        config: { endpoint: 'https://api.example.com' },
        status: 'ACTIVE',
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('not recognized in the platform registry');
  });

  // ==========================================
  // 8. HEALTH CHECK PROBE (PING)
  // ==========================================
  it('POST /v1/integrations/:provider/ping triggers live health probe and updates status', async () => {
    const app = createTestApp(tenantAdmin);

    const res = await request(app).post('/v1/integrations/TWILIO/ping').send({ capability: 'MESSAGING.SMS' });

    expect(res.status).toBe(200);
    expect(res.body.healthy).toBe(true);
    expect(res.body.latencyMs).toBeGreaterThanOrEqual(0);
    expect(res.body.checkedAt).toBeDefined();

    // Verify health field is reflected on the connection record
    const getRes = await request(app).get('/v1/integrations/TWILIO?capability=MESSAGING.SMS');
    expect(getRes.status).toBe(200);
    expect(getRes.body.health.healthy).toBe(true);
  });

  // ==========================================
  // 9. MULTI-TENANT ISOLATION
  // ==========================================
  it('Enforces strict tenant isolation between Tenant A and Tenant B', async () => {
    const appA = createTestApp(tenantAdmin);
    const appB = createTestApp(tenantBAdmin);

    // Tenant B configures a connection
    const putB = await request(appB)
      .put('/v1/integrations/MOCK')
      .send({
        capability: 'STORAGE.DOC_SCAN',
        environment: 'SANDBOX',
        credentialRef: 'vault://tenants/ten_demo_02/sandbox/mock/credentials',
        config: { maxSizeBytes: 20971520 },
        status: 'ACTIVE',
      });
    expect(putB.status).toBe(200);

    // Tenant A queries integrations: must not see Tenant B's custom config
    const listA = await request(appA).get('/v1/integrations?provider=MOCK&capability=STORAGE.DOC_SCAN');
    expect(listA.status).toBe(200);
    const connA = listA.body.data.find((c: { tenantId: string }) => c.tenantId === 'ten_demo_02');
    expect(connA).toBeUndefined();

    // Tenant A attempts to update with Tenant B credentialRef -> rejected
    const crossTenantPut = await request(appA)
      .put('/v1/integrations/MOCK')
      .send({
        capability: 'STORAGE.DOC_SCAN',
        environment: 'SANDBOX',
        credentialRef: 'vault://tenants/ten_demo_02/sandbox/mock/credentials',
        config: { maxSizeBytes: 5000 },
        status: 'ACTIVE',
      });
    expect(crossTenantPut.status).toBe(403);
    expect(crossTenantPut.body.error.code).toBe('FORBIDDEN');
  });

  // ==========================================
  // 10. ADAPTER EXECUTION & SENSITIVE DATA REDACTION
  // ==========================================
  it('IntegrationRegistry executes operations safely and redacts PII in logs', async () => {
    const registry = sharedService.getRegistry();
    const conn = await sharedService.getIntegration(
      { principal: tenantAdmin } as RequestContext,
      'KARZA',
      'VERIFICATION.PAN',
    );

    const execution = await registry.executeOperation(
      conn,
      'VERIFICATION.PAN',
      { idNumber: 'ABCDE1234F', pan: 'ABCDE1234F', aadhaar: '123456789012' },
      { correlationId: 'test-req-001' },
    );

    expect(execution.success).toBe(true);
    expect(execution.data).toBeDefined();

    // Verify PAN masking in returned data
    const data = execution.data as { identifierMasked: string };
    expect(data.identifierMasked).toBe('ABCDEXXXXF');

    // Verify sensitive PII is redacted in execution log metadata
    expect(execution.metadata.maskedPayloadSummary).not.toContain('123456789012');
    expect(execution.metadata.maskedPayloadSummary).toContain('1234-XXXX-9012');
  });
});
