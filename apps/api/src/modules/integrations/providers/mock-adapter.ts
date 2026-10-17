// apps/api/src/modules/integrations/providers/mock-adapter.ts
// Module 28: Integration Management (MOD-INT) — Deterministic Mock Test Adapter

import type { AdapterResult, HealthCheckResult, IntegrationEnvironment } from '@dsa/contracts';
import type { BaseAdapter } from '../adapter';
import type { ResolvedCredentials } from '../vault-port';

export interface MockConfig {
  simulateError?: 'TIMEOUT' | 'RATE_LIMIT' | 'AUTH_FAILURE' | 'NONE';
  simulatedLatencyMs?: number;
}

export class MockTestAdapter implements BaseAdapter<MockConfig> {
  readonly providerId = 'MOCK';
  readonly supportedCapabilities = [
    'MESSAGING.SMS',
    'MESSAGING.WHATSAPP',
    'VERIFICATION.PAN',
    'VERIFICATION.GST',
    'VERIFICATION.BANK',
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
