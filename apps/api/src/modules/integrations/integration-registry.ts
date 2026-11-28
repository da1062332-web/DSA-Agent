// apps/api/src/modules/integrations/integration-registry.ts
// Module 28: Integration Management (MOD-INT) — Centralized Adapter Registry

import {
  AppError,
  STANDARD_CAPABILITY_DESCRIPTORS,
  type AdapterResult,
  type CapabilityDescriptor,
  type HealthCheckResult,
  type IntegrationConnection,
  type IntegrationEnvironment,
} from '@dsa/contracts';
import type { BaseAdapter } from './adapter';
import { sanitizeProviderPayload } from './adapter';
import { TwilioAdapter } from './providers/twilio-adapter';
import { BureauAdapter } from './providers/bureau-adapter';
import { KarzaAdapter } from './providers/karza-adapter';
import { MockTestAdapter } from './providers/mock-adapter';
import type { IVaultPort } from './vault-port';
import { DevelopmentVaultAdapter } from './vault-port';

export interface IntegrationRegistryOptions {
  /** Where "production" is read from, at call time. Defaults to process.env.NODE_ENV; a test passes its own. */
  nodeEnv?: () => string | undefined;
}

export class IntegrationRegistry {
  private adapters = new Map<string, BaseAdapter>();
  private vault: IVaultPort;
  private readonly nodeEnv: () => string | undefined;

  constructor(vault?: IVaultPort, options: IntegrationRegistryOptions = {}) {
    this.vault = vault ?? new DevelopmentVaultAdapter();
    this.nodeEnv = options.nodeEnv ?? (() => process.env.NODE_ENV);

    // Register built-in adapters
    this.registerAdapter(new TwilioAdapter());
    this.registerAdapter(new KarzaAdapter());
    this.registerAdapter(new BureauAdapter());
    this.registerAdapter(new MockTestAdapter());
  }

  registerAdapter(adapter: BaseAdapter): void {
    this.adapters.set(adapter.providerId.toUpperCase(), adapter);
  }

  getAdapter(provider: string): BaseAdapter | undefined {
    return this.adapters.get(provider.toUpperCase());
  }

  /** True when the API runs with NODE_ENV=production. */
  isProductionRuntime(): boolean {
    return this.nodeEnv() === 'production';
  }

  /** True for an adapter that invents its results: it declares itself `simulated`, or it is the MOCK provider. */
  isSimulated(adapter: BaseAdapter): boolean {
    return adapter.simulated === true || adapter.providerId.toUpperCase() === 'MOCK';
  }

  /**
   * Why this adapter must not serve a connection in `environment`, or null when it may. Mocks and the development vault (which
   * hands out placeholder credentials) never serve production traffic: not when the API runs with NODE_ENV=production, and not for
   * a connection whose environment is PRODUCTION. This refuses at call time, not at boot, because there is no production vault
   * yet (OD-INT-001); the existing ENABLE_MOCK_PROVIDERS check in config.ts already refuses to start the API with the simulated
   * messaging provider in production.
   */
  private productionRefusal(adapter: BaseAdapter, environment: IntegrationEnvironment): string | null {
    if (!this.isProductionRuntime() && environment !== 'PRODUCTION') return null;
    if (this.isSimulated(adapter)) {
      return `The ${adapter.providerId} provider is simulated and is not allowed in production.`;
    }
    if (this.vault.developmentOnly === true) {
      return 'The development vault returns placeholder credentials and is not allowed in production; a production vault is required.';
    }
    return null;
  }

  listCapabilities(): CapabilityDescriptor[] {
    return STANDARD_CAPABILITY_DESCRIPTORS;
  }

  getCapabilityDescriptor(capability: string): CapabilityDescriptor | undefined {
    return STANDARD_CAPABILITY_DESCRIPTORS.find(
      (c) => c.capability.toUpperCase() === capability.toUpperCase(),
    );
  }

  async checkHealth(connection: IntegrationConnection): Promise<HealthCheckResult> {
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

    const refusal = this.productionRefusal(adapter, connection.environment);
    if (refusal) {
      return {
        healthy: false,
        latencyMs: 0,
        message: refusal,
        checkedAt: new Date().toISOString(),
        statusCode: 500,
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
      throw AppError.of(
        'VALIDATION_ERROR',
        `Integration ${connection.provider} (${capability}) is not ACTIVE (current: ${connection.status}).`,
      );
    }

    const adapter = this.getAdapter(connection.provider);
    if (!adapter) {
      throw AppError.of('NOT_FOUND', `Provider adapter not registered for ${connection.provider}.`);
    }

    if (!adapter.supportedCapabilities.includes(capability)) {
      throw AppError.of(
        'VALIDATION_ERROR',
        `Capability ${capability} is not supported by provider ${connection.provider}.`,
      );
    }

    // A mock or placeholder credential never reaches a production call: refused before the vault is read or the adapter runs.
    const refusal = this.productionRefusal(adapter, connection.environment);
    if (refusal) {
      throw AppError.of('INTERNAL_ERROR', refusal);
    }

    // Resolve credentials from vault port
    const credentials = await this.vault.resolveSecret(connection.tenantId, connection.credentialRef);

    // Sanitize input in execution log
    const sanitizedInput = sanitizeProviderPayload(input);
    const result = await adapter.execute<TInput, TOutput>(capability, input, connection.config, credentials, {
      correlationId: metadata.correlationId,
      tenantId: connection.tenantId,
      environment: connection.environment,
    });

    // The connection's environment is the authority, whatever the adapter reports.
    result.metadata.environment = connection.environment;
    result.metadata.maskedPayloadSummary = JSON.stringify(sanitizedInput);
    return result;
  }
}
