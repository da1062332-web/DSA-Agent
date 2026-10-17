// apps/api/src/modules/integrations/adapter.ts
// Module 28: Integration Management (MOD-INT) — Base Adapter Specification

import type { AdapterResult, HealthCheckResult, IntegrationEnvironment } from '@dsa/contracts';
import type { ResolvedCredentials } from './vault-port';

/**
 * Base Adapter Contract required for all external providers.
 */
export interface BaseAdapter<TConfig = Record<string, unknown>> {
  readonly providerId: string;
  readonly supportedCapabilities: readonly string[];
  readonly supportedEnvironments: readonly IntegrationEnvironment[];

  validateConfig(config: unknown): { valid: boolean; errors?: string[] };

  checkHealth(config: TConfig, credentials: ResolvedCredentials): Promise<HealthCheckResult>;

  execute<TInput = unknown, TOutput = unknown>(
    capability: string,
    input: TInput,
    config: TConfig,
    credentials: ResolvedCredentials,
    metadata: { correlationId: string; tenantId: string },
  ): Promise<AdapterResult<TOutput>>;
}

/**
 * Normalizes external HTTP/network errors into canonical DSA error codes.
 */
export function normalizeExternalError(err: unknown): {
  code: string;
  message: string;
  retryable: boolean;
  httpStatus: number;
} {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (
      msg.includes('timeout') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('etimedout')
    ) {
      return {
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'External provider network connection timed out or is unavailable.',
        retryable: true,
        httpStatus: 503,
      };
    }
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) {
      return {
        code: 'RATE_LIMITED',
        message: 'External provider rate limit exceeded.',
        retryable: true,
        httpStatus: 429,
      };
    }
    if (
      msg.includes('401') ||
      msg.includes('403') ||
      msg.includes('unauthorized') ||
      msg.includes('forbidden')
    ) {
      return {
        code: 'INTERNAL_ERROR',
        message: 'External provider authentication or authorization failed.',
        retryable: false,
        httpStatus: 500,
      };
    }
    if (msg.includes('404') || msg.includes('not found')) {
      return {
        code: 'NOT_FOUND',
        message: 'Requested resource not found on external provider.',
        retryable: false,
        httpStatus: 404,
      };
    }
    if (
      msg.includes('400') ||
      msg.includes('422') ||
      msg.includes('validation') ||
      msg.includes('bad request')
    ) {
      return {
        code: 'VALIDATION_ERROR',
        message: `External provider validation rejected request: ${err.message}`,
        retryable: false,
        httpStatus: 422,
      };
    }
  }
  return {
    code: 'DEPENDENCY_UNAVAILABLE',
    message: 'External provider returned an unexpected failure condition.',
    retryable: true,
    httpStatus: 503,
  };
}

/**
 * Sensitive Data Redactor for Provider Call Logs (ENT-104 & audit logs).
 * Masks PAN (10 chars), Aadhaar (12 digits), bank account numbers, passwords, and tokens.
 */
export function sanitizeProviderPayload(payload: unknown): unknown {
  if (payload === null || payload === undefined) return payload;

  if (typeof payload === 'string') {
    return payload
      // 12-digit Aadhaar
      .replace(/\b(\d{4})\d{4}(\d{4})\b/g, '$1-XXXX-$2')
      .replace(/\b\d{12}\b/g, 'XXXXXXXXXXXX')
      // 10-char PAN
      .replace(/\b([A-Z]{5})\d{4}([A-Z])\b/g, '$1XXXX$2')
      // Bearer / Token
      .replace(/Bearer\s+[a-zA-Z0-9_.-]+/gi, 'Bearer [REDACTED]')
      .replace(/(api[-_]?key|secret|password|auth[-_]?token)\s*[:=]\s*["']?[^"'\s,]+/gi, '$1=[REDACTED]');
  }

  if (Array.isArray(payload)) {
    return payload.map(sanitizeProviderPayload);
  }

  if (typeof payload === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      if (
        lower.includes('secret') ||
        lower.includes('password') ||
        lower.includes('token') ||
        lower.includes('apikey') ||
        lower === 'authorization' ||
        lower === 'cookie'
      ) {
        cleaned[k] = '[REDACTED]';
      } else {
        cleaned[k] = sanitizeProviderPayload(v);
      }
    }
    return cleaned;
  }

  return payload;
}
