// apps/api/src/modules/integrations/integration-service.ts
// Module 28: Integration Management (MOD-INT) — SUB-INT.01: Adapter Framework Service

// Connections are stored in app.integration_connection (ENT-103, M-043) and every change is audited in the same transaction.
// The in-memory map, with its seeded demo connections, is only the unit-test seam: it is used when the test TxRunner
// reports that no database is configured.
import {
  AppError,
  type CapabilityDescriptor,
  type ConfigureIntegrationRequest,
  type HealthCheckResult,
  type IntegrationConnection,
  type ListIntegrationsQuery,
  type RequestContext,
  type Tx,
} from '@dsa/contracts';
import { sql } from 'kysely';
import type { ApiDeps } from '../types';
import { monotonicFactory } from 'ulid';
import { IntegrationRegistry } from './integration-registry';

const nextUlid = monotonicFactory();
const NO_DB = Symbol('no-database');

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v instanceof Date ? v : new Date(String(v))).toISOString();
const toConnection = (r: Row): IntegrationConnection => ({
  id: String(r.id),
  tenantId: String(r.tenant_id),
  provider: String(r.provider),
  capability: String(r.capability),
  environment: r.environment as IntegrationConnection['environment'],
  credentialRef: String(r.credential_ref),
  config: (r.config as Record<string, unknown>) ?? {},
  status: r.status as IntegrationConnection['status'],
  health: (r.health as IntegrationConnection['health']) ?? null,
  lockVersion: Number(r.lock_version),
  createdAt: iso(r.created_at),
  createdBy: String(r.created_by),
  updatedAt: iso(r.updated_at),
  updatedBy: String(r.updated_by),
});

export class IntegrationService {
  private registry: IntegrationRegistry;
  private connections = new Map<string, IntegrationConnection>();

  constructor(
    private readonly deps?: ApiDeps,
    registry?: IntegrationRegistry,
  ) {
    this.registry = registry ?? new IntegrationRegistry();
    this.seedDefaultConnections();
  }

  /** Runs fn in the caller's tenant transaction; NO_DB only when the test TxRunner reports no database. */
  private async inTx<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T | typeof NO_DB> {
    if (!this.deps?.txRunner) return NO_DB;
    try {
      return await this.deps.txRunner.withTenantTx(ctx, fn);
    } catch (err) {
      if (err instanceof Error && !(err instanceof AppError) && /^No TxRunner/.test(err.message))
        return NO_DB;
      throw err;
    }
  }

  private seedDefaultConnections(): void {
    const demoTenant = 'ten_demo_01';
    const initialConnections: IntegrationConnection[] = [
      {
        id: 'itc_01JADAPTER00000000000001',
        tenantId: demoTenant,
        provider: 'TWILIO',
        capability: 'MESSAGING.SMS',
        environment: 'SANDBOX',
        credentialRef: 'vault://tenants/ten_demo_01/sandbox/twilio/credentials',
        config: { senderId: 'DSACRM', timeoutMs: 5000 },
        status: 'ACTIVE',
        health: {
          healthy: true,
          latencyMs: 12,
          message: 'Twilio API endpoint operational',
          checkedAt: new Date().toISOString(),
          statusCode: 200,
        },
        lockVersion: 1,
        createdAt: '2026-10-01T00:00:00.000Z',
        createdBy: 'usr_system',
        updatedAt: '2026-10-01T00:00:00.000Z',
        updatedBy: 'usr_system',
      },
      {
        id: 'itc_01JADAPTER00000000000002',
        tenantId: demoTenant,
        provider: 'KARZA',
        capability: 'VERIFICATION.PAN',
        environment: 'SANDBOX',
        credentialRef: 'vault://tenants/ten_demo_01/sandbox/karza/credentials',
        config: { apiEndpoint: 'https://sandbox.karza.in/v2/pan-verification', minMatchScore: 85 },
        status: 'ACTIVE',
        health: {
          healthy: true,
          latencyMs: 24,
          message: 'Karza Verification Gateway operational',
          checkedAt: new Date().toISOString(),
          statusCode: 200,
        },
        lockVersion: 1,
        createdAt: '2026-10-01T00:00:00.000Z',
        createdBy: 'usr_system',
        updatedAt: '2026-10-01T00:00:00.000Z',
        updatedBy: 'usr_system',
      },
      {
        id: 'itc_01JADAPTER00000000000003',
        tenantId: demoTenant,
        provider: 'MOCK',
        capability: 'STORAGE.DOC_SCAN',
        environment: 'SANDBOX',
        credentialRef: 'vault://tenants/ten_demo_01/sandbox/mock/credentials',
        config: { maxSizeBytes: 10485760 },
        status: 'ACTIVE',
        health: {
          healthy: true,
          latencyMs: 4,
          message: 'Mock malware scan engine operational',
          checkedAt: new Date().toISOString(),
          statusCode: 200,
        },
        lockVersion: 1,
        createdAt: '2026-10-01T00:00:00.000Z',
        createdBy: 'usr_system',
        updatedAt: '2026-10-01T00:00:00.000Z',
        updatedBy: 'usr_system',
      },
    ];

    for (const c of initialConnections) {
      this.connections.set(`${c.tenantId}:${c.provider.toUpperCase()}:${c.capability.toUpperCase()}`, c);
    }
  }

  getRegistry(): IntegrationRegistry {
    return this.registry;
  }

  listCapabilities(): CapabilityDescriptor[] {
    return this.registry.listCapabilities();
  }

  async listIntegrations(
    ctx: RequestContext,
    query?: ListIntegrationsQuery,
  ): Promise<{ data: IntegrationConnection[]; meta: { total: number; nextCursor?: string } }> {
    const tenantId = ctx.principal.tenantId;
    const limit = query?.limit ?? 50;
    const fromDb = await this.inTx(ctx, async (tx) => {
      const r = await sql<Row>`
        SELECT * FROM app.integration_connection
         WHERE true
           ${query?.environment ? sql`AND environment = ${query.environment}` : sql``}
           ${query?.capability ? sql`AND upper(capability) = ${query.capability.toUpperCase()}` : sql``}
           ${query?.provider ? sql`AND upper(provider) = ${query.provider.toUpperCase()}` : sql``}
           ${query?.status ? sql`AND status = ${query.status}` : sql``}
         ORDER BY updated_at DESC, id DESC`.execute(tx);
      const all = r.rows.map(toConnection);
      return { data: all.slice(0, limit), meta: { total: all.length } };
    });
    if (fromDb !== NO_DB) return fromDb;

    let list = Array.from(this.connections.values()).filter((c) => c.tenantId === tenantId);

    if (query?.environment) {
      list = list.filter((c) => c.environment === query.environment);
    }
    if (query?.capability) {
      list = list.filter((c) => c.capability.toUpperCase() === query.capability!.toUpperCase());
    }
    if (query?.provider) {
      list = list.filter((c) => c.provider.toUpperCase() === query.provider!.toUpperCase());
    }
    if (query?.status) {
      list = list.filter((c) => c.status === query.status);
    }

    list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    const total = list.length;
    const sliced = list.slice(0, limit);

    return {
      data: sliced,
      meta: {
        total,
      },
    };
  }

  async getIntegration(
    ctx: RequestContext,
    provider: string,
    capability: string,
  ): Promise<IntegrationConnection> {
    const fromDb = await this.inTx(ctx, (tx) => this.findConnection(tx, provider, capability));
    const conn =
      fromDb !== NO_DB
        ? fromDb
        : this.connections.get(
            `${ctx.principal.tenantId}:${provider.toUpperCase()}:${capability.toUpperCase()}`,
          );
    if (!conn) {
      throw AppError.of(
        'NOT_FOUND',
        `Integration not found for provider '${provider}' and capability '${capability}'.`,
      );
    }
    return conn;
  }

  async configureIntegration(
    ctx: RequestContext,
    provider: string,
    input: ConfigureIntegrationRequest,
    ifMatch?: string,
  ): Promise<IntegrationConnection> {
    const tenantId = ctx.principal.tenantId;
    const providerUpper = provider.toUpperCase();
    const capabilityUpper = input.capability.toUpperCase();
    const key = `${tenantId}:${providerUpper}:${capabilityUpper}`;

    // 1. Validate capability against platform descriptors
    const desc = this.registry.getCapabilityDescriptor(capabilityUpper);
    if (!desc) {
      throw AppError.of(
        'VALIDATION_ERROR',
        `Capability '${input.capability}' is not recognized in the platform registry.`,
      );
    }

    // 2. Validate credentialRef belongs to context tenant
    const credMatch = input.credentialRef.match(/^vault:\/\/tenants\/([a-zA-Z0-9_-]+)\//);
    if (credMatch && credMatch[1] !== tenantId) {
      throw AppError.of(
        'FORBIDDEN',
        `Tenant mismatch: credentialRef belongs to ${credMatch[1]}, but context tenant is ${tenantId}`,
      );
    }

    // 3. Validate provider against adapter implementation if present
    const adapter = this.registry.getAdapter(providerUpper);
    if (adapter) {
      const validation = adapter.validateConfig(input.config);
      if (!validation.valid) {
        throw AppError.of(
          'VALIDATION_ERROR',
          `Invalid configuration for provider '${provider}': ${(validation.errors ?? []).join(', ')}`,
        );
      }
    }

    const save = async (
      existing: IntegrationConnection | null | undefined,
      tx?: Tx,
    ): Promise<IntegrationConnection> => {
      // Optimistic concurrency: If-Match is required to change an existing integration.
      if (existing) {
        if (!ifMatch) {
          throw AppError.of(
            'MALFORMED_REQUEST',
            'If-Match header is mandatory when updating an existing integration.',
          );
        }
        const matchVersion = parseInt(ifMatch.replace(/^W\//, '').replace(/["']/g, ''), 10);
        if (isNaN(matchVersion) || matchVersion !== existing.lockVersion) {
          throw AppError.of(
            'VERSION_CONFLICT',
            `Version conflict: provided ETag ${ifMatch} does not match current version ${existing.lockVersion}.`,
          );
        }
      }
      const now = ctx.now.toISOString();
      const updated: IntegrationConnection = {
        id: existing ? existing.id : `itc_${nextUlid()}`,
        tenantId,
        provider: providerUpper,
        capability: capabilityUpper,
        environment: input.environment,
        credentialRef: input.credentialRef,
        config: input.config,
        status: input.status,
        health: existing?.health ?? null,
        lockVersion: existing ? existing.lockVersion + 1 : 1,
        createdAt: existing?.createdAt ?? now,
        createdBy: existing?.createdBy ?? ctx.principal.id,
        updatedAt: now,
        updatedBy: ctx.principal.id,
      };
      if (tx) {
        if (existing) {
          await sql`
            UPDATE app.integration_connection
               SET environment = ${updated.environment}, credential_ref = ${updated.credentialRef},
                   config = ${JSON.stringify(updated.config)}::jsonb, status = ${updated.status},
                   lock_version = ${updated.lockVersion}, updated_at = ${now}, updated_by = ${ctx.principal.id}
             WHERE id = ${updated.id}`.execute(tx);
        } else {
          await sql`
            INSERT INTO app.integration_connection (id, tenant_id, provider, capability, environment, credential_ref, config,
                                                    status, lock_version, created_at, created_by, updated_at, updated_by)
            VALUES (${updated.id}, ${tenantId}, ${providerUpper}, ${capabilityUpper}, ${updated.environment},
                    ${updated.credentialRef}, ${JSON.stringify(updated.config)}::jsonb, ${updated.status},
                    ${updated.lockVersion}, ${now}, ${ctx.principal.id}, ${now}, ${ctx.principal.id})`.execute(
            tx,
          );
        }
        // The credential reference is a vault pointer, never a secret.
        await this.deps!.audit.record(tx, ctx, {
          action: existing ? 'integration.updated' : 'integration.configured',
          entityType: 'INTEGRATION_CONNECTION',
          entityId: updated.id,
          before: existing ? { status: existing.status, environment: existing.environment } : undefined,
          after: {
            provider: providerUpper,
            capability: capabilityUpper,
            status: updated.status,
            environment: updated.environment,
          },
          permissionUsed: 'integration.manage',
        });
      } else {
        this.connections.set(key, updated);
      }
      return updated;
    };

    const fromDb = await this.inTx(ctx, async (tx) =>
      save(await this.findConnection(tx, providerUpper, capabilityUpper, true), tx),
    );
    return fromDb !== NO_DB ? fromDb : save(this.connections.get(key));
  }

  private async findConnection(
    tx: Tx,
    provider: string,
    capability: string,
    forUpdate = false,
  ): Promise<IntegrationConnection | null> {
    const r = await sql<Row>`
      SELECT * FROM app.integration_connection
       WHERE upper(provider) = ${provider.toUpperCase()} AND upper(capability) = ${capability.toUpperCase()}
       ${forUpdate ? sql`FOR UPDATE` : sql``}`.execute(tx);
    return r.rows[0] ? toConnection(r.rows[0]) : null;
  }

  async pingIntegration(
    ctx: RequestContext,
    provider: string,
    capability: string,
  ): Promise<HealthCheckResult> {
    const conn = await this.getIntegration(ctx, provider, capability);
    // The provider is called outside any transaction; only the result is written.
    const health = await this.registry.checkHealth(conn);
    const saved = await this.inTx(ctx, async (tx) => {
      await sql`UPDATE app.integration_connection SET health = ${JSON.stringify(health)}::jsonb WHERE id = ${conn.id}`.execute(
        tx,
      );
      return true;
    });
    if (saved === NO_DB) {
      conn.health = health;
      conn.updatedAt = ctx.now.toISOString();
    }
    return health;
  }
}
