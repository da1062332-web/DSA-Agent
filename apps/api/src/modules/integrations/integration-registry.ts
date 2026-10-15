// apps/api/src/modules/integrations/integration-registry.ts
// Module 28: Integration Management (MOD-INT) — Centralized Adapter Registry

import {
  AppError,
  STANDARD_CAPABILITY_DESCRIPTORS,
  type AdapterResult,
  type CapabilityDescriptor,
  type HealthCheckResult,
  type IntegrationConnection,
} from '@dsa/contracts';
import type { BaseAdapter } from './adapter';
import { sanitizeProviderPayload } from './adapter';
import { TwilioAdapter } from './providers/twilio-adapter';
import { KarzaAdapter } from './providers/karza-adapter';
import { MockTestAdapter } from './providers/mock-adapter';
import type { IVaultPort } from './vault-port';
import { DevelopmentVaultAdapter } from './vault-port';

export class IntegrationRegistry {
  private adapters = new Map<string, BaseAdapter>();
  private vault: IVaultPort;

  constructor(vault?: IVaultPort) {
    this.vault = vault ?? new DevelopmentVaultAdapter();

    // Register built-in adapters
    this.registerAdapter(new TwilioAdapter());
    this.registerAdapter(new KarzaAdapter());
    this.registerAdapter(new MockTestAdapter());
  }

  registerAdapter(adapter: BaseAdapter): void {
    this.adapters.set(adapter.providerId.toUpperCase(), adapter);
  }

  getAdapter(provider: string): BaseAdapter | undefined {
    return this.adapters.get(provider.toUpperCase());
  }

  listCapabilities(): CapabilityDescriptor[] {
    return STANDARD_CAPABILITY_DESCRIPTORS;
  }

  getCapabilityDescriptor(capability: string): CapabilityDescriptor | undefined {
    return STANDARD_CAPABILITY_DESCRIPTORS.find((c) => c.capability.toUpperCase() === capability.toUpperCase());
  }

  async checkHealth(
    connection: IntegrationConnection,
  ): Promise<HealthCheckResult> {
    const adapter = this.getAdapter(connection.provider);
    if (!adapter) {
      return {
        healthy: false,
        latencyMs: 0,
        message: `Unknown provider: ${connection.provider}`,
        checkedAt: new Date().toISOString(),
        statusCode: 501,
      };
    }

    try {
      const creds = await this.vault.resolveSecret(connection.tenantId, connection.credentialRef);
      return await adapter.checkHealth(connection.config, creds);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Vault secret resolution failed';
      return {
        healthy: false,
        latencyMs: 0,
        message: msg,
        checkedAt: new Date().toISOString(),
        statusCode: 500,
      };
    }
  }

  async executeOperation<TInput = unknown, TOutput = unknown>(
    connection: IntegrationConnection,
    capability: string,
    input: TInput,
    metadata: { correlationId: string },
  ): Promise<AdapterResult<TOutput>> {
    if (connection.status !== 'ACTIVE') {
      throw AppError.of('VALIDATION_ERROR', `Integration ${connection.provider} (${capability}) is not ACTIVE (current: ${connection.status}).`);
    }

    const adapter = this.getAdapter(connection.provider);
    if (!adapter) {
      throw AppError.of('NOT_FOUND', `Provider adapter not registered for ${connection.provider}.`);
    }

    if (!adapter.supportedCapabilities.includes(capability)) {
      throw AppError.of('VALIDATION_ERROR', `Capability ${capability} is not supported by provider ${connection.provider}.`);
    }

    // Resolve credentials from vault port
    const credentials = await this.vault.resolveSecret(connection.tenantId, connection.credentialRef);

    // Sanitize input in execution log
    const sanitizedInput = sanitizeProviderPayload(input);
    const result = await adapter.execute<TInput, TOutput>(
      capability,
      input,
      connection.config,
      credentials,
      { correlationId: metadata.correlationId, tenantId: connection.tenantId },
    );

    result.metadata.maskedPayloadSummary = JSON.stringify(sanitizedInput);
    return result;
  }
}
