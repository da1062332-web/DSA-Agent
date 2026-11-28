// apps/api/src/modules/integrations/providers/mock-adapter.ts
// Module 28: Integration Management (MOD-INT) — Deterministic Mock Test Adapter

import type { AdapterResult, HealthCheckResult, IntegrationEnvironment } from '@dsa/contracts';
import type { BaseAdapter } from '../adapter';
import type { BureauPullOutput } from './bureau-adapter';
import type { ResolvedCredentials } from '../vault-port';

export interface MockConfig {
  simulateError?: 'TIMEOUT' | 'RATE_LIMIT' | 'AUTH_FAILURE' | 'NONE';
  simulatedLatencyMs?: number;
}

export class MockTestAdapter implements BaseAdapter<MockConfig> {
  readonly providerId = 'MOCK';
  /** Invents every result: the registry refuses this adapter in production and for any PRODUCTION connection. */
  readonly simulated = true;
  readonly supportedCapabilities = [
    'MESSAGING.SMS',
    'MESSAGING.WHATSAPP',
    'VERIFICATION.PAN',
    'VERIFICATION.GST',
    'VERIFICATION.BANK',
    'BUREAU.SOFT_PULL',
    'STORAGE.DOC_SCAN',
  ] as const;
  readonly supportedEnvironments: readonly IntegrationEnvironment[] = ['SANDBOX', 'PRODUCTION'];

  validateConfig(config: unknown): { valid: boolean; errors?: string[] } {
    return { valid: true };
  }

  async checkHealth(config: MockConfig, _credentials: ResolvedCredentials): Promise<HealthCheckResult> {
    const latency = config?.simulatedLatencyMs ?? 5;
    if (config?.simulateError === 'AUTH_FAILURE') {
      return {
        healthy: false,
        latencyMs: latency,
        message: 'Mock provider simulated auth failure',
        checkedAt: new Date().toISOString(),
        statusCode: 401,
      };
    }

    return {
      healthy: true,
      latencyMs: latency,
      message: 'Mock test adapter running normally',
      checkedAt: new Date().toISOString(),
      statusCode: 200,
    };
  }

  async execute<TInput = unknown, TOutput = unknown>(
    capability: string,
    input: TInput,
    config: MockConfig,
    _credentials: ResolvedCredentials,
    metadata: { correlationId: string; tenantId: string },
  ): Promise<AdapterResult<TOutput>> {
    const start = Date.now();
    const latency = config?.simulatedLatencyMs ?? 5;

    if (config?.simulateError === 'TIMEOUT') {
      return {
        success: false,
        error: {
          code: 'DEPENDENCY_UNAVAILABLE',
          message: 'Mock provider simulated connection timeout.',
          retryable: true,
        },
        metadata: {
          provider: this.providerId,
          capability,
          environment: 'SANDBOX',
          durationMs: latency,
          httpStatus: 504,
        },
      };
    }

    if (config?.simulateError === 'RATE_LIMIT') {
      return {
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Mock provider simulated rate limit reached (429).',
          retryable: true,
        },
        metadata: {
          provider: this.providerId,
          capability,
          environment: 'SANDBOX',
          durationMs: latency,
          httpStatus: 429,
        },
      };
    }

    // A simulated bureau report. It never echoes the input: the input of this capability is a PAN and a date of birth.
    if (capability === 'BUREAU.SOFT_PULL') {
      const simulated: BureauPullOutput = {
        outcome: 'SCORED',
        reportDate: null,
        summary: {
          score: 742,
          activeAccounts: 3,
          monthlyEmi: { amount: '18400.00', currency: 'INR' },
          maxDpd12m: 0,
          enquiries6m: 1,
        },
        vendorRef: `MOCK_BUREAU_${metadata.correlationId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)}`,
        unitCost: null,
      };
      return {
        success: true,
        data: simulated as TOutput,
        metadata: {
          provider: this.providerId,
          capability,
          environment: 'SANDBOX',
          durationMs: latency,
          httpStatus: 200,
          externalTransactionId: `MOCK_TX_${Date.now()}`,
        },
      };
    }

    return {
      success: true,
      data: {
        mocked: true,
        capability,
        correlationId: metadata.correlationId,
        echo: input,
      } as TOutput,
      metadata: {
        provider: this.providerId,
        capability,
        environment: 'SANDBOX',
        durationMs: latency,
        httpStatus: 200,
        externalTransactionId: `MOCK_TX_${Date.now()}`,
      },
    };
  }
}
