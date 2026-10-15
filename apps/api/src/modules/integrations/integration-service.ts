// apps/api/src/modules/integrations/integration-service.ts
// Module 28: Integration Management (MOD-INT) — SUB-INT.01: Adapter Framework Service

import {
  AppError,
  type CapabilityDescriptor,
  type ConfigureIntegrationRequest,
  type HealthCheckResult,
  type IntegrationConnection,
  type ListIntegrationsQuery,
  type RequestContext,
} from '@dsa/contracts';
import type { ApiDeps } from '../types';
import { monotonicFactory } from 'ulid';
import { IntegrationRegistry } from './integration-registry';

const nextUlid = monotonicFactory();

export class IntegrationService {
  private registry: IntegrationRegistry;
  private connections = new Map<string, IntegrationConnection>();

  constructor(_deps?: ApiDeps, registry?: IntegrationRegistry) {
    this.registry = registry ?? new IntegrationRegistry();
    this.seedDefaultConnections();
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
    const limit = query?.limit ?? 50;
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
    const key = `${ctx.principal.tenantId}:${provider.toUpperCase()}:${capability.toUpperCase()}`;
    const conn = this.connections.get(key);
    if (!conn) {
      throw AppError.of('NOT_FOUND', `Integration not found for provider '${provider}' and capability '${capability}'.`);
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
      throw AppError.of('VALIDATION_ERROR', `Capability '${input.capability}' is not recognized in the platform registry.`);
    }

    // 2. Validate credentialRef belongs to context tenant
    const credMatch = input.credentialRef.match(/^vault:\/\/tenants\/([a-zA-Z0-9_-]+)\//);
    if (credMatch && credMatch[1] !== tenantId) {
      throw AppError.of('FORBIDDEN', `Tenant mismatch: credentialRef belongs to ${credMatch[1]}, but context tenant is ${tenantId}`);
    }

    // 3. Validate provider against adapter implementation if present
    const adapter = this.registry.getAdapter(providerUpper);
    if (adapter) {
      const validation = adapter.validateConfig(input.config);
      if (!validation.valid) {
        throw AppError.of('VALIDATION_ERROR', `Invalid configuration for provider '${provider}': ${(validation.errors ?? []).join(', ')}`);
      }
    }

    const existing = this.connections.get(key);

    // 3. Optimistic Concurrency Control (If-Match required on update)
    if (existing) {
      if (!ifMatch) {
        throw AppError.of('MALFORMED_REQUEST', 'If-Match header is mandatory when updating an existing integration.');
      }
      const matchVersion = parseInt(ifMatch.replace(/["']/g, ''), 10);
      if (isNaN(matchVersion) || matchVersion !== existing.lockVersion) {
        throw AppError.of('VERSION_CONFLICT', `Version conflict: provided ETag ${ifMatch} does not match current version ${existing.lockVersion}.`);
      }
    }

    const now = new Date().toISOString();
    const newLockVersion = existing ? existing.lockVersion + 1 : 1;
    const connId = existing ? existing.id : `itc_${nextUlid()}`;

    const updated: IntegrationConnection = {
      id: connId,
      tenantId,
      provider: providerUpper,
      capability: capabilityUpper,
      environment: input.environment,
      credentialRef: input.credentialRef,
      config: input.config,
      status: input.status,
      health: existing?.health ?? null,
      lockVersion: newLockVersion,
      createdAt: existing?.createdAt ?? now,
      createdBy: existing?.createdBy ?? ctx.principal.id,
      updatedAt: now,
      updatedBy: ctx.principal.id,
    };

    this.connections.set(key, updated);
    return updated;
  }

  async pingIntegration(
    ctx: RequestContext,
    provider: string,
    capability: string,
  ): Promise<HealthCheckResult> {
    const conn = await this.getIntegration(ctx, provider, capability);
    const health = await this.registry.checkHealth(conn);

    // Update connection with latest health
    conn.health = health;
    conn.updatedAt = new Date().toISOString();
    return health;
  }
}
