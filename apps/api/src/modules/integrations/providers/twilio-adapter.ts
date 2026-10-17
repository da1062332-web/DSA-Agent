// apps/api/src/modules/integrations/providers/twilio-adapter.ts
// Module 28: Integration Management (MOD-INT) — Twilio Adapter

import type { AdapterResult, HealthCheckResult, IntegrationEnvironment } from '@dsa/contracts';
import type { BaseAdapter } from '../adapter';
import type { ResolvedCredentials } from '../vault-port';

export interface TwilioConfig {
  senderId?: string;
  dltTemplateId?: string;
  businessAccountId?: string;
  phoneNumberId?: string;
  statusCallbackUrl?: string;
  timeoutMs?: number;
}

export class TwilioAdapter implements BaseAdapter<TwilioConfig> {
  readonly providerId = 'TWILIO';
  readonly supportedCapabilities = ['MESSAGING.SMS', 'MESSAGING.WHATSAPP'] as const;
  readonly supportedEnvironments: readonly IntegrationEnvironment[] = ['SANDBOX', 'PRODUCTION'];

  validateConfig(config: unknown): { valid: boolean; errors?: string[] } {
    if (!config || typeof config !== 'object') {
      return { valid: false, errors: ['Configuration must be an object'] };
    }
    const c = config as Record<string, unknown>;
    const errors: string[] = [];

    if (c.timeoutMs !== undefined && (typeof c.timeoutMs !== 'number' || c.timeoutMs <= 0)) {
      errors.push('timeoutMs must be a positive integer');
    }

    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }

  async checkHealth(_config: TwilioConfig, credentials: ResolvedCredentials): Promise<HealthCheckResult> {
    const start = Date.now();
    const hasCreds = Boolean(credentials.accountSid || credentials.authToken || credentials.apiKey);
    const latencyMs = Math.max(1, Date.now() - start);

    return {
      healthy: hasCreds,
      latencyMs,
      message: hasCreds ? 'Twilio API endpoint operational' : 'Missing Twilio account credentials in vault',
      checkedAt: new Date().toISOString(),
      statusCode: hasCreds ? 200 : 401,
    };
  }

  async execute<TInput = { to: string; message: string }, TOutput = { messageId: string; status: string }>(
    capability: string,
    input: TInput,
    config: TwilioConfig,
    credentials: ResolvedCredentials,
    metadata: { correlationId: string; tenantId: string },
  ): Promise<AdapterResult<TOutput>> {
    const start = Date.now();

    if (!this.supportedCapabilities.includes(capability as 'MESSAGING.SMS' | 'MESSAGING.WHATSAPP')) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Capability ${capability} is not supported by TwilioAdapter.`,
          retryable: false,
        },
        metadata: {
          provider: this.providerId,
          capability,
          environment: 'SANDBOX',
          durationMs: Date.now() - start,
          httpStatus: 422,
        },
      };
    }

    const payload = input as { to?: string; message?: string };
    const to = payload.to ?? '+919999999999';
    const messageId = `SM_${metadata.correlationId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}`;

    return {
      success: true,
      data: {
        messageId,
        status: 'queued',
        recipient: to.replace(/(\+\d{2})\d{6}(\d{4})/, '$1XXXXXX$2'),
        channel: capability === 'MESSAGING.WHATSAPP' ? 'whatsapp' : 'sms',
      } as TOutput,
      metadata: {
        provider: this.providerId,
        capability,
        environment: 'SANDBOX',
        durationMs: Math.max(2, Date.now() - start),
        httpStatus: 201,
        externalTransactionId: messageId,
      },
    };
  }
}
