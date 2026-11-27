// apps/api/test/integration-production-guard.spec.ts — P1-06: mocks and placeholder credentials never serve production,
// and the call log never carries a full PAN, GSTIN, Aadhaar or account number.
import type { IntegrationConnection, RequestContext, Tx, TxRunner } from '@dsa/contracts';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config';
import { errorHandler } from '../src/http/error-handler';
import { sanitizeProviderPayload, type BaseAdapter } from '../src/modules/integrations/adapter';
import { IntegrationRegistry } from '../src/modules/integrations/integration-registry';
import { IntegrationService } from '../src/modules/integrations/integration-service';
import { KarzaAdapter, type FetchLike } from '../src/modules/integrations/providers/karza-adapter';
import { MockTestAdapter } from '../src/modules/integrations/providers/mock-adapter';
import { TwilioAdapter } from '../src/modules/integrations/providers/twilio-adapter';
import { createRouter } from '../src/modules/integrations/router';
import type { IVaultPort } from '../src/modules/integrations/vault-port';
import { createTestDeps, fakeAuth, testPrincipal } from './support/fake-auth';

const PAN = 'ABCDE1234F';

const connection = (over: Partial<IntegrationConnection> = {}): IntegrationConnection => ({
  id: 'itc_01JGUARD0000000000000001',
  tenantId: 'ten_demo_01',
  provider: 'KARZA',
  capability: 'VERIFICATION.PAN',
  environment: 'SANDBOX',
  credentialRef: 'vault://tenants/ten_demo_01/sandbox/karza/credentials',
  config: { apiEndpoint: 'https://kyc.example.test/v3/pan', minMatchScore: 85 },
  status: 'ACTIVE',
  health: null,
  lockVersion: 1,
  createdAt: '2026-11-26T00:00:00.000Z',
  createdBy: 'usr_system',
  updatedAt: '2026-11-26T00:00:00.000Z',
  updatedBy: 'usr_system',
  ...over,
});

const mockConnection = (over: Partial<IntegrationConnection> = {}) =>
  connection({
    provider: 'MOCK',
    credentialRef: 'vault://tenants/ten_demo_01/sandbox/mock/credentials',
    config: {},
    ...over,
  });

const productionConnection = (over: Partial<IntegrationConnection> = {}) =>
  connection({
    environment: 'PRODUCTION',
    credentialRef: 'vault://tenants/ten_demo_01/production/karza/credentials',
    ...over,
  });

/** A vault that is not the development one: it returns a credential for any reference. */
const realVault: IVaultPort = { resolveSecret: async () => ({ apiKey: 'prod-key-0001' }) };

/** A registry whose "NODE_ENV" is chosen by the test, with a Karza adapter that answers from a fake fetch. */
function registryFor(nodeEnv: string | undefined, vault?: IVaultPort) {
  const sent: { headers: Record<string, string> }[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    sent.push({ headers: init.headers });
    return {
      status: 200,
      text: async () =>
        JSON.stringify({ request_id: 'req_guard_1', 'status-code': '101', result: { status: 'Valid' } }),
    };
  };
  const registry = new IntegrationRegistry(vault, { nodeEnv: () => nodeEnv });
  registry.registerAdapter(new KarzaAdapter({ fetchImpl, sleep: async () => {} }));
  return { registry, sent };
}

const corr = { correlationId: 'guard-corr-0001' };

describe('P1-06 production guard: the registry refuses mocks and placeholder credentials', () => {
  it('P1-06 refuses the MOCK provider when the API runs in production, even for a sandbox connection', async () => {
    const { registry } = registryFor('production', realVault);

    await expect(
      registry.executeOperation(mockConnection(), 'VERIFICATION.PAN', { idNumber: PAN }, corr),
    ).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: expect.stringContaining('simulated and is not allowed in production'),
    });
  });

  it('P1-06 refuses the MOCK provider for a PRODUCTION connection even when the API does not run in production', async () => {
    const { registry } = registryFor('development', realVault);
    const conn = mockConnection({
      environment: 'PRODUCTION',
      credentialRef: 'vault://tenants/ten_demo_01/production/mock/credentials',
    });

    await expect(
      registry.executeOperation(conn, 'VERIFICATION.PAN', { idNumber: PAN }, corr),
    ).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });

  it('P1-06 refuses the development vault in production before the adapter runs or any credential is read', async () => {
    const { registry, sent } = registryFor('production');

    await expect(
      registry.executeOperation(connection(), 'VERIFICATION.PAN', { idNumber: PAN }, corr),
    ).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: expect.stringContaining('development vault'),
    });
    expect(sent).toHaveLength(0);
  });

  it('P1-06 refuses the development vault for a PRODUCTION connection even when the API does not run in production', async () => {
    const { registry, sent } = registryFor('development');

    await expect(
      registry.executeOperation(productionConnection(), 'VERIFICATION.PAN', { idNumber: PAN }, corr),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(sent).toHaveLength(0);
  });

  it('P1-06 lets a real adapter with a real vault serve a PRODUCTION connection in production', async () => {
    const { registry, sent } = registryFor('production', realVault);
    const res = await registry.executeOperation(
      productionConnection(),
      'VERIFICATION.PAN',
      { idNumber: PAN },
      corr,
    );

    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ outcome: 'VERIFIED', identifierMasked: 'ABCDE****F' });
    expect(res.metadata.environment).toBe('PRODUCTION');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.headers['x-karza-key']).toBe('prod-key-0001');
  });

  it('P1-06 still allows the MOCK provider and the development vault outside production', async () => {
    const { registry } = registryFor('test');

    const mocked = await registry.executeOperation(
      mockConnection(),
      'VERIFICATION.PAN',
      { idNumber: PAN },
      corr,
    );
    expect(mocked.success).toBe(true);
    expect(mocked.data).toMatchObject({ mocked: true });

    const karza = await registry.executeOperation(connection(), 'VERIFICATION.PAN', { idNumber: PAN }, corr);
    expect(karza.success).toBe(true);
    expect(karza.metadata.environment).toBe('SANDBOX');
  });

  it("P1-06 reports the connection's environment in the result, whatever the adapter says", async () => {
    // The Twilio adapter always reports SANDBOX; the registry sets the real environment.
    const { registry } = registryFor('test', realVault);
    const conn = connection({
      provider: 'TWILIO',
      capability: 'MESSAGING.SMS',
      environment: 'PRODUCTION',
      credentialRef: 'vault://tenants/ten_demo_01/production/twilio/credentials',
      config: { senderId: 'DSACRM' },
    });

    const res = await registry.executeOperation(
      conn,
      'MESSAGING.SMS',
      { to: '+919876543210', message: 'hello' },
      corr,
    );

    expect(res.success).toBe(true);
    expect(res.metadata.environment).toBe('PRODUCTION');
  });

  it('P1-06 refuses an adapter that declares itself simulated, and the MOCK id in any case', async () => {
    const simulated: BaseAdapter = {
      providerId: 'FAKEPAY',
      simulated: true,
      supportedCapabilities: ['VERIFICATION.PAN'],
      supportedEnvironments: ['SANDBOX', 'PRODUCTION'],
      validateConfig: () => ({ valid: true }),
      checkHealth: async () => ({ healthy: true, latencyMs: 1, checkedAt: new Date().toISOString() }),
      execute: async () => ({
        success: true,
        metadata: {
          provider: 'FAKEPAY',
          capability: 'VERIFICATION.PAN',
          environment: 'SANDBOX',
          durationMs: 1,
        },
      }),
    };
    const lowerCase: BaseAdapter = { ...simulated, providerId: 'Mock', simulated: undefined };
    const { registry } = registryFor('production', realVault);
    registry.registerAdapter(simulated);
    registry.registerAdapter(lowerCase);

    for (const provider of ['FAKEPAY', 'Mock']) {
      await expect(
        registry.executeOperation(
          connection({
            provider,
            credentialRef: `vault://tenants/ten_demo_01/sandbox/${provider.toLowerCase()}/credentials`,
          }),
          'VERIFICATION.PAN',
          { idNumber: PAN },
          corr,
        ),
      ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    }
  });

  it('P1-06 only the MOCK adapter is marked simulated', () => {
    const simulatedFlag = (adapter: BaseAdapter) => adapter.simulated;

    expect(simulatedFlag(new MockTestAdapter())).toBe(true);
    expect(simulatedFlag(new KarzaAdapter())).toBeUndefined();
    expect(simulatedFlag(new TwilioAdapter())).toBeUndefined();
  });

  it('P1-06 a health probe in production is unhealthy for a mock or a development vault, and healthy for a real setup', async () => {
    const mockInProduction = await registryFor('production', realVault).registry.checkHealth(
      mockConnection(),
    );
    expect(mockInProduction).toMatchObject({ healthy: false, statusCode: 500 });
    expect(mockInProduction.message).toContain('simulated');

    const twilio = connection({
      provider: 'TWILIO',
      capability: 'MESSAGING.SMS',
      credentialRef: 'vault://tenants/ten_demo_01/sandbox/twilio/credentials',
      config: {},
    });
    const devVaultInProduction = await registryFor('production').registry.checkHealth(twilio);
    expect(devVaultInProduction).toMatchObject({ healthy: false, statusCode: 500 });
    expect(devVaultInProduction.message).toContain('development vault');

    expect((await registryFor('production', realVault).registry.checkHealth(twilio)).healthy).toBe(true);
    expect((await registryFor('development').registry.checkHealth(mockConnection())).healthy).toBe(true);
  });

  it('P1-06 reads NODE_ENV when no override is given', () => {
    try {
      vi.stubEnv('NODE_ENV', 'production');
      expect(new IntegrationRegistry().isProductionRuntime()).toBe(true);
      vi.stubEnv('NODE_ENV', 'test');
      expect(new IntegrationRegistry().isProductionRuntime()).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('P1-06 the API itself still refuses to start in production with the simulated provider enabled', () => {
    const env = {
      DATABASE_URL: 'postgresql://dsa_api:secret@127.0.0.1:54322/postgres',
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_JWT_SECRET: 'super-secret-jwt-token-with-at-least-32-characters-long',
      APP_SIGNING_SECRET: 'a'.repeat(40),
    };
    expect(() => loadConfig({ ...env, NODE_ENV: 'production', ENABLE_MOCK_PROVIDERS: 'true' })).toThrow(
      /not allowed in production/,
    );
  });
});

describe('P1-06 production guard: configuring a connection', () => {
  const tenantAdmin = testPrincipal({
    id: 'usr_tenant_admin_01',
    tenantId: 'ten_demo_01',
    grants: [
      { code: 'config.manage', scope: 'TENANT', branchIds: [] },
      { code: 'integration.manage', scope: 'TENANT', branchIds: [] },
      { code: 'integration.read', scope: 'TENANT', branchIds: [] },
    ],
  });
  const dummyTxRunner: TxRunner = {
    async withTenantTx<T>(_ctx: RequestContext, _fn: (tx: Tx) => Promise<T>): Promise<T> {
      throw new Error('No TxRunner in unit tests');
    },
  };
  const appFor = (nodeEnv: string) => {
    const registry = new IntegrationRegistry(undefined, { nodeEnv: () => nodeEnv });
    const service = new IntegrationService(createTestDeps({ txRunner: dummyTxRunner }), registry);
    const app = express();
    app.use(express.json());
    app.use(fakeAuth(tenantAdmin));
    app.use('/v1', createRouter(createTestDeps({ txRunner: dummyTxRunner }), service));
    app.use(errorHandler());
    return app;
  };
  // VERIFICATION.BANK is not among the seeded demo connections, so each PUT creates a connection (no If-Match needed).
  const mockBody = (environment: 'SANDBOX' | 'PRODUCTION') => ({
    capability: 'VERIFICATION.BANK',
    environment,
    credentialRef: `vault://tenants/ten_demo_01/${environment.toLowerCase()}/mock/credentials`,
    config: {},
    status: 'ACTIVE',
  });

  it('P1-06 PUT refuses a MOCK connection for PRODUCTION with 422', async () => {
    const res = await request(appFor('development'))
      .put('/v1/integrations/MOCK')
      .send(mockBody('PRODUCTION'));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('simulated');
    expect(res.body.error.details[0]).toMatchObject({
      field: 'environment',
      issue: 'SIMULATED_PROVIDER_IN_PRODUCTION',
    });
  });

  it('P1-06 PUT refuses any MOCK connection while the API runs in production', async () => {
    const res = await request(appFor('production')).put('/v1/integrations/MOCK').send(mockBody('SANDBOX'));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('P1-06 PUT still accepts a sandbox MOCK connection when the API is not in production', async () => {
    const res = await request(appFor('test')).put('/v1/integrations/MOCK').send(mockBody('SANDBOX'));

    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('MOCK');
  });

  it('P1-06 PUT accepts a real provider for PRODUCTION in production', async () => {
    const res = await request(appFor('production'))
      .put('/v1/integrations/KARZA')
      .send({
        capability: 'VERIFICATION.GST',
        environment: 'PRODUCTION',
        credentialRef: 'vault://tenants/ten_demo_01/production/karza/credentials',
        config: { apiEndpoint: 'https://kyc.example.test/v3/gst', minMatchScore: 85 },
        status: 'ACTIVE',
      });

    expect(res.status).toBe(200);
    expect(res.body.environment).toBe('PRODUCTION');
  });

  it('P1-06 PUT refuses a Karza endpoint that is not https', async () => {
    const res = await request(appFor('test'))
      .put('/v1/integrations/KARZA')
      .send({
        capability: 'VERIFICATION.BANK',
        environment: 'SANDBOX',
        credentialRef: 'vault://tenants/ten_demo_01/sandbox/karza/credentials',
        config: { apiEndpoint: 'http://kyc.example.test/v3/bank' },
        status: 'ACTIVE',
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('https');
  });

  it('P1-06 the capability catalogue lists the BANK penny drop as served by Karza', async () => {
    const res = await request(appFor('test')).get('/v1/integrations/capabilities');

    expect(res.status).toBe(200);
    const bank = res.body.data.find((c: { capability: string }) => c.capability === 'VERIFICATION.BANK');
    expect(bank.supportedProviders).toContain('KARZA');
  });
});

describe('P1-06 call-log redaction', () => {
  it('P1-06 masks a PAN as ABCDE****F and the PAN inside a GSTIN, and keeps the surrounding text', () => {
    expect(sanitizeProviderPayload(`pan ${PAN} and gstin 27ABCDE1234F1Z5 checked`)).toBe(
      'pan ABCDE****F and gstin 27ABCDE****F1Z5 checked',
    );
  });

  it('P1-06 shows only the last four digits of an Aadhaar number, a bank account number or a mobile number', () => {
    expect(sanitizeProviderPayload('aadhaar 123456789012 end')).toBe('aadhaar XXXXXXXX9012 end');
    expect(sanitizeProviderPayload('account 50100123456789 end')).toBe('account **********6789 end');
    expect(sanitizeProviderPayload('account 50100123456789.')).toBe('account **********6789.');
    expect(sanitizeProviderPayload('mobile 9876543210')).toBe('mobile ******3210');
  });

  it('P1-06 leaves short numbers, decimal amounts and reference ids alone', () => {
    expect(sanitizeProviderPayload('code 12345678')).toBe('code 12345678');
    expect(sanitizeProviderPayload('amount 300000000.00 INR')).toBe('amount 300000000.00 INR');
    expect(sanitizeProviderPayload('KZ_TX_1732600000000')).toBe('KZ_TX_1732600000000');
  });

  it('P1-06 masks values by key name: accounts and Aadhaar even when they are numbers or oddly formatted', () => {
    const cleaned = sanitizeProviderPayload({
      accountNumber: 50100123456789,
      account_no: '50100123456789',
      bankAccount: 'ABC-0123456789',
      accountName: 'RAVI KUMAR SHARMA',
      ifsc: 'HDFC0000123',
      aadhaar: 123456789012,
      aadhaarNumber: '1234 5678 9012',
      amount: 300000000,
    });

    expect(cleaned).toEqual({
      accountNumber: '**********6789',
      account_no: '**********6789',
      bankAccount: '**********6789',
      accountName: 'RAVI KUMAR SHARMA',
      ifsc: 'HDFC0000123',
      aadhaar: 'XXXXXXXX9012',
      aadhaarNumber: 'XXXXXXXX9012',
      amount: 300000000,
    });
  });

  it('P1-06 redacts secrets by key and inside text, and walks arrays and nested objects', () => {
    const cleaned = sanitizeProviderPayload({
      apiKey: 'k-1',
      authorization: 'Bearer abc.def',
      password: 'p',
      nested: { clientSecret: 's', list: [PAN, null, 5, true, undefined] },
      note: 'use Bearer abc.def-1 and api_key=xyz now',
    });

    expect(cleaned).toEqual({
      apiKey: '[REDACTED]',
      authorization: '[REDACTED]',
      password: '[REDACTED]',
      nested: { clientSecret: '[REDACTED]', list: ['ABCDE****F', null, 5, true, undefined] },
      note: 'use Bearer [REDACTED] and api_key=[REDACTED] now',
    });
  });

  it('P1-06 never changes the payload it is given', () => {
    const payload = { idNumber: PAN, accountNumber: '50100123456789', nested: { gstin: '27ABCDE1234F1Z5' } };
    const before = JSON.parse(JSON.stringify(payload)) as typeof payload;

    sanitizeProviderPayload(payload);

    expect(payload).toEqual(before);
  });

  it('P1-06 passes null, undefined and plain values through', () => {
    expect(sanitizeProviderPayload(null)).toBeNull();
    expect(sanitizeProviderPayload(undefined)).toBeUndefined();
    expect(sanitizeProviderPayload(42)).toBe(42);
    expect(sanitizeProviderPayload(false)).toBe(false);
  });
});
