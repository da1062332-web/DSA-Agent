// apps/api/src/modules/integrations/providers/vendor-http.ts
// Module 28: Integration Management (MOD-INT) — the HTTPS call and error classes shared by the vendor adapters that make real calls (Karza KYC
// P1-06, the credit-bureau soft pull P1-05). One place decides what an HTTP answer or a thrown fetch means, so two adapters cannot classify
// the same failure differently. Nothing here logs, and no message built here contains what was being sent.
import { ERROR_HTTP_STATUS, RETRYABLE_ERROR_CODES, type ErrorCode } from '@dsa/contracts';
import { normalizeExternalError } from '../adapter';

/** The part of fetch these adapters use; a test passes its own. The default is the global fetch. */
export type FetchLike = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    redirect: 'error';
  },
) => Promise<{ status: number; text(): Promise<string> }>;

export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_TIMEOUT_MS = 60_000;
export const DEFAULT_RETRY_DELAY_MS = 300;
/** HTTP statuses of a gateway that is momentarily down: a lookup that only reads may be repeated once. Rate limits (429) are not repeated at once. */
export const RETRYABLE_HTTP_STATUSES = new Set([502, 503, 504]);

export interface Failure {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  httpStatus?: number;
}

/** Retryability always comes from the Contracts §6 catalogue, so it cannot drift from the error code. */
export function failure(code: ErrorCode, message: string, httpStatus?: number): Failure {
  return { code, message, retryable: RETRYABLE_ERROR_CODES.has(code), httpStatus };
}

/** HTTP answers that are not 2xx, mapped explicitly. A 4xx other than the rate limit is never worth repeating. */
export function httpFailure(status: number, vendor: string): Failure {
  if (status === 429) return failure('RATE_LIMITED', `${vendor} rate limit reached; retry later.`, status);
  if (status === 408 || status >= 500) {
    return failure(
      'DEPENDENCY_UNAVAILABLE',
      `${vendor} is unavailable (HTTP ${status}); retry later.`,
      status,
    );
  }
  if (status === 400 || status === 422) {
    return failure('VALIDATION_ERROR', `${vendor} rejected the request as invalid (HTTP ${status}).`, status);
  }
  if (status === 401 || status === 403) {
    return failure(
      'INTERNAL_ERROR',
      `${vendor} rejected the connection credentials; check the vault secret.`,
      status,
    );
  }
  if (status === 404) {
    return failure(
      'NOT_FOUND',
      `The configured ${vendor} endpoint was not found; check apiEndpoint.`,
      status,
    );
  }
  return failure('INTERNAL_ERROR', `${vendor} answered with an unexpected HTTP ${status}.`, status);
}

/**
 * A fetch that threw: a timeout, a refused connection, a redirect, a broken body. Only a fixed word describing the cause is handed to
 * normalizeExternalError, never the error's own message, because that text could contain what was being sent.
 */
export function networkFailure(err: unknown): Failure {
  const name = err instanceof Error ? err.name : '';
  const cause = (err as { cause?: { code?: unknown } } | null | undefined)?.cause?.code;
  const label =
    name === 'TimeoutError' || name === 'AbortError'
      ? 'timeout'
      : typeof cause === 'string' && /^[A-Z_]{4,24}$/.test(cause)
        ? cause.toLowerCase()
        : 'network error';
  const normalized = normalizeExternalError(new Error(label));
  const code: ErrorCode =
    normalized.code in ERROR_HTTP_STATUS ? (normalized.code as ErrorCode) : 'DEPENDENCY_UNAVAILABLE';
  return { code, message: normalized.message, retryable: normalized.retryable };
}

/** Null when `endpoint` is a usable https URL without embedded credentials; otherwise what is wrong with it. */
export function endpointProblem(endpoint: unknown): string | null {
  if (typeof endpoint !== 'string' || endpoint.trim() === '') return 'apiEndpoint is not set';
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return 'apiEndpoint must be an absolute URL';
  }
  if (url.protocol !== 'https:') return 'apiEndpoint must use https';
  if (url.username !== '' || url.password !== '') return 'apiEndpoint must not contain credentials';
  return null;
}

export interface PostOptions {
  fetchImpl: FetchLike;
  sleep: (ms: number) => Promise<void>;
  retryDelayMs: number;
  /** The vendor's name for messages, for example "Karza". */
  vendor: string;
}

/** One POST, repeated up to `maxAttempts` times only for a thrown error or a gateway that is down. A call that moves money or costs money passes 1. */
export async function postJson(
  options: PostOptions,
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  timeoutMs: number,
  maxAttempts: number,
): Promise<{ ok: true; status: number; text: string } | { ok: false; failure: Failure }> {
  const payload = JSON.stringify(body);
  let last: Failure = failure('DEPENDENCY_UNAVAILABLE', `${options.vendor} did not answer.`);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await options.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
        body: payload,
        signal: AbortSignal.timeout(timeoutMs),
        // The key and the identifier must never follow a redirect to another host.
        redirect: 'error',
      });
      const text = await res.text();
      if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, text };
      last = httpFailure(res.status, options.vendor);
      if (!RETRYABLE_HTTP_STATUSES.has(res.status)) return { ok: false, failure: last };
    } catch (err) {
      last = networkFailure(err);
    }
    if (attempt < maxAttempts) await options.sleep(options.retryDelayMs);
  }
  return { ok: false, failure: last };
}
