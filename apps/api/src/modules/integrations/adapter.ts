// apps/api/src/modules/integrations/adapter.ts
// Module 28: Integration Management (MOD-INT) — Base Adapter Specification

import {
  maskAccountNumber,
  type AdapterResult,
  type HealthCheckResult,
  type IntegrationEnvironment,
} from '@dsa/contracts';
import type { ResolvedCredentials } from './vault-port';

/** What the registry tells an adapter about the call it is making. */
export interface AdapterCallContext {
  correlationId: string;
  tenantId: string;
  /** The environment of the connection being called. Optional so adapters written before it existed keep compiling. */
  environment?: IntegrationEnvironment;
}

/**
 * Base Adapter Contract required for all external providers.
 */
export interface BaseAdapter<TConfig = Record<string, unknown>> {
  readonly providerId: string;
  readonly supportedCapabilities: readonly string[];
  readonly supportedEnvironments: readonly IntegrationEnvironment[];
  /** True for an adapter that invents its results (the MOCK provider). The registry refuses it in production. */
  readonly simulated?: boolean;

  validateConfig(config: unknown): { valid: boolean; errors?: string[] };

  checkHealth(config: TConfig, credentials: ResolvedCredentials): Promise<HealthCheckResult>;

  execute<TInput = unknown, TOutput = unknown>(
    capability: string,
    input: TInput,
    config: TConfig,
    credentials: ResolvedCredentials,
    metadata: AdapterCallContext,
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

/** Keys whose value is a bank account number whatever it looks like: accountNumber, account_no, acctNum, bankAccount. */
const ACCOUNT_KEY = /(?:account|acct)(?:number|no|num)$|^(?:bank)?account$/;
/** Keys whose value is an Aadhaar number. */
const AADHAAR_KEY = /aadhaar|aadhar/;

function redactText(text: string): string {
  return (
    text
      // GSTIN: characters 3 to 12 are the holder's PAN, so the PAN part is masked: 27ABCDE1234F1Z5 -> 27ABCDE****F1Z5
      .replace(/\b(\d{2}[A-Z]{5})\d{4}([A-Z][1-9A-Z]Z[0-9A-Z])\b/g, '$1****$2')
      // 10-character PAN: ABCDE1234F -> ABCDE****F
      .replace(/\b([A-Z]{5})\d{4}([A-Z])\b/g, '$1****$2')
      // 12-digit Aadhaar: only the last four digits are ever shown
      .replace(/(?<![\w.])\d{8}(\d{4})(?!\w|\.\d)/g, 'XXXXXXXX$1')
      // any other run of 9 to 18 digits (a bank account or a mobile number): ********1234. A decimal amount is left alone.
      .replace(/(?<![\w.])\d{9,18}(?!\w|\.\d)/g, (digits) => maskAccountNumber(digits))
      // Bearer / Token
      .replace(/Bearer\s+[a-zA-Z0-9_.-]+/gi, 'Bearer [REDACTED]')
      .replace(/(api[-_]?key|secret|password|auth[-_]?token)\s*[:=]\s*["']?[^"'\s,]+/gi, '$1=[REDACTED]')
  );
}

/**
 * Sensitive Data Redactor for Provider Call Logs (ENT-104 & audit logs).
 * Masks PAN (ABCDE****F), the PAN inside a GSTIN, Aadhaar (last four digits only), bank account numbers (last four digits only),
 * passwords, and tokens. The result is safe to store in a call log; the original payload is never changed.
 */
export function sanitizeProviderPayload(payload: unknown): unknown {
  if (payload === null || payload === undefined) return payload;

  if (typeof payload === 'string') return redactText(payload);

  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizeProviderPayload(item));
  }

  if (typeof payload === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      const plain = lower.replace(/[^a-z0-9]/g, '');
      if (
        lower.includes('secret') ||
        lower.includes('password') ||
        lower.includes('token') ||
        lower.includes('apikey') ||
        lower === 'authorization' ||
        lower === 'cookie'
      ) {
        cleaned[k] = '[REDACTED]';
      } else if ((typeof v === 'string' || typeof v === 'number') && ACCOUNT_KEY.test(plain)) {
        cleaned[k] = maskAccountNumber(String(v));
      } else if ((typeof v === 'string' || typeof v === 'number') && AADHAAR_KEY.test(plain)) {
        const digits = String(v).replace(/\D/g, '');
        cleaned[k] = digits.length >= 4 ? `XXXXXXXX${digits.slice(-4)}` : 'XXXXXXXX';
      } else {
        cleaned[k] = sanitizeProviderPayload(v);
      }
    }
    return cleaned;
  }

  return payload;
}
