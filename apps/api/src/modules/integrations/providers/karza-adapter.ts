// apps/api/src/modules/integrations/providers/karza-adapter.ts
// Module 28: Integration Management (MOD-INT) — Karza KYC adapter (P1-06): PAN, GST and bank-account penny drop.
//
// Every call is a real HTTPS POST to the endpoint set on the connection (config.apiEndpoint), authenticated with the key resolved
// from the vault. Nothing here is simulated: the simulated provider is MockTestAdapter, which the registry refuses in production.
//
// Data handling (plan 12.6). A full PAN, GSTIN or account number exists only in the outgoing request body. Results, errors and
// metadata carry masked identifiers only: PAN ABCDE****F, GSTIN with its embedded PAN masked (27ABCDE****F1Z5), account
// ********1234. The name the vendor returns is compared here and never copied out: only the score is returned. Nothing is logged.
// The caller must hold a live VERIFICATION_CHECK consent before calling: this adapter sends the vendor's consent flag for it.
//
// Fail closed. A check is VERIFIED only when the vendor positively says so and, if a name was asked for, the name matched. A
// timeout, a vendor error or any response this file does not recognise is an ERROR and never VERIFIED. A score is never invented.
//
// ── ASSUMED VENDOR CONTRACT (NOT VERIFIED) ────────────────────────────────────────────────────────────────────────────────────
// There are no sandbox credentials or vendor documents yet (plan section 11: first KYC vendor and sandbox credentials are an open
// decision). Everything in the "wire format" section below is an assumption kept in one place, so the sandbox contract tests can
// confirm or correct it without touching the rest of the adapter:
//   request    POST {config.apiEndpoint}, JSON body, header "x-karza-key: <apiKey from the vault>"; every body carries
//              consent "Y" and clientData.caseId (our correlation id)
//   PAN        body { pan };                       answer result.name (name on the PAN), result.status ("Valid")
//   GST        body { gstin };                     answer result.sts (status, "Active"), result.tradeNam and result.lgnm (trade and
//                                                  legal name), result.rgdt (registration date, DD/MM/YYYY)
//   BANK       body { accountNumber, ifsc };       answer result.bankTxnStatus (true when the Rs 1 credit went through) and
//                                                  result.accountName (name held by the bank)
//   answer     HTTP 200 with { request_id, "status-code", result }; "status-code" 101 = positive, 102 = invalid input,
//              103 = no record, 104 = source busy (retryable), 107 = not supported, 108 = source unavailable (retryable)
// The name matcher is local (name-match.ts) because the vendor's own name-match answer is not known; replace it if the sandbox
// documents one.

import {
  ERROR_HTTP_STATUS,
  RETRYABLE_ERROR_CODES,
  maskAccountNumber,
  maskPan,
  type AdapterExecutionMetadata,
  type AdapterResult,
  type ErrorCode,
  type ErrorDetail,
  type HealthCheckResult,
  type IntegrationEnvironment,
  type MinimalResult,
  type VerificationResult,
} from '@dsa/contracts';
import { z } from 'zod';
import { normalizeExternalError, type AdapterCallContext, type BaseAdapter } from '../adapter';
import { GSTIN_PATTERN, maskGstin } from '../masking';
import { nameMatchScore } from '../name-match';
import type { ResolvedCredentials } from '../vault-port';

export const KARZA_CAPABILITIES = ['VERIFICATION.PAN', 'VERIFICATION.GST', 'VERIFICATION.BANK'] as const;
export type KarzaCapability = (typeof KARZA_CAPABILITIES)[number];

/** What a check came to, in the P1-06 vocabulary (the plan's VERIFIED, MISMATCH, FAILED, ERROR). */
export type KycOutcome = 'VERIFIED' | 'MISMATCH' | 'FAILED' | 'ERROR';

/** Why a check was not verified. A fixed list, so a reason can be stored and shown without carrying personal data. */
export type KycReason =
  | 'ID_INVALID'
  | 'NOT_FOUND'
  | 'PAN_NOT_VALID'
  | 'GST_NOT_ACTIVE'
  | 'NAME_MISMATCH'
  | 'NAME_NOT_RETURNED'
  | 'BANK_TXN_FAILED'
  | 'NOT_SUPPORTED'
  | 'SOURCE_BUSY'
  | 'SOURCE_UNAVAILABLE'
  | 'UNRECOGNIZED_RESPONSE'
  | 'PROVIDER_ERROR';

/** Input of VERIFICATION.PAN (idNumber is the PAN) and VERIFICATION.GST (idNumber is the GSTIN), or of VERIFICATION.BANK. */
export type KycInput =
  { idNumber: string; name?: string } | { accountNumber: string; ifsc: string; name?: string };

/**
 * What a check returns. `verificationResult` is the value the verification record stores (its CHECK allows VERIFIED, REJECTED,
 * FLAGGED, INCONCLUSIVE): MISMATCH becomes REJECTED, FAILED becomes INCONCLUSIVE, and an ERROR is null because it is retryable
 * and nothing is recorded. `minimalResult` already has the shape of MinimalResultSchema, so it can be stored as it is.
 */
export interface KycCheckOutput {
  outcome: KycOutcome;
  verificationResult: VerificationResult | null;
  verified: boolean;
  /** Name-match score 0 to 100, or null when no name was asked for or none could be compared. Never a default. */
  matchScore: number | null;
  identifierMasked: string;
  /** The vendor's request id, or null when it sent none. */
  referenceId: string | null;
  reason: KycReason | null;
  /** Non-personal facts of the answer, for example { gstStatus: 'ACTIVE', registrationDate: '2019-07-01' }. */
  details: Record<string, string>;
  minimalResult: MinimalResult;
}

export interface KarzaConfig {
  /** Full https URL of the Karza endpoint for this capability. */
  apiEndpoint?: string;
  /** Lowest name-match score, 0 to 100, that counts as a match when a name is asked for. Default 80. */
  minMatchScore?: number;
  /** Time allowed for one attempt, in milliseconds. Default 10000, at most 60000. */
  timeoutMs?: number;
}

/** The part of fetch this adapter uses; a test passes its own. The default is the global fetch. */
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

export interface KarzaAdapterOptions {
  fetchImpl?: FetchLike;
  /** Pause between two attempts of a lookup. A test passes a no-op. */
  sleep?: (ms: number) => Promise<void>;
  retryDelayMs?: number;
  /** Attempts for PAN and GST lookups (they only read). The penny drop is never repeated automatically. Default 2. */
  lookupMaxAttempts?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_MIN_MATCH_SCORE = 80;
const DEFAULT_LOOKUP_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 300;
/** HTTP statuses of a gateway that is momentarily down: a lookup is repeated once. Rate limits (429) are not repeated at once. */
const RETRYABLE_HTTP_STATUSES = new Set([502, 503, 504]);

// ── input ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const upper = (v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase() : v);
const requestedName = z.string().trim().min(1).max(120).optional();

const PanInput = z.object({
  idNumber: z.preprocess(upper, z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'INVALID_PAN_FORMAT')),
  name: requestedName,
});
const GstInput = z.object({
  idNumber: z.preprocess(upper, z.string().regex(GSTIN_PATTERN, 'INVALID_GSTIN_FORMAT')),
  name: requestedName,
});
const BankInput = z.object({
  accountNumber: z.preprocess(
    (v) => (typeof v === 'string' ? v.replace(/[\s-]/g, '') : v),
    z.string().regex(/^[0-9]{9,18}$/, 'INVALID_ACCOUNT_NUMBER'),
  ),
  ifsc: z.preprocess(upper, z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'INVALID_IFSC')),
  name: requestedName,
});

/** A checked and normalised request. `identifier` is the full PAN, GSTIN or account number: it goes to the vendor and nowhere else. */
interface ParsedCheck {
  identifier: string;
  ifsc: string | null;
  name: string | undefined;
  masked: string;
}

function parseInput(
  capability: KarzaCapability,
  input: unknown,
): { ok: true; check: ParsedCheck } | { ok: false; details: ErrorDetail[] } {
  const schema =
    capability === 'VERIFICATION.BANK' ? BankInput : capability === 'VERIFICATION.GST' ? GstInput : PanInput;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    // Only the field and a fixed issue code are reported: never the value that was rejected.
    return {
      ok: false,
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'input',
        issue: /^[A-Z_]+$/.test(issue.message) ? issue.message : 'INVALID_VALUE',
      })),
    };
  }
  const data = parsed.data as { idNumber?: string; accountNumber?: string; ifsc?: string; name?: string };
  if (capability === 'VERIFICATION.BANK') {
    const account = data.accountNumber ?? '';
    return {
      ok: true,
      check: {
        identifier: account,
        ifsc: data.ifsc ?? null,
        name: data.name,
        masked: maskAccountNumber(account),
      },
    };
  }
  const id = data.idNumber ?? '';
  return {
    ok: true,
    check: {
      identifier: id,
      ifsc: null,
      name: data.name,
      masked: capability === 'VERIFICATION.PAN' ? maskPan(id) : maskGstin(id),
    },
  };
}

// ── failures ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Failure {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  httpStatus?: number;
}

/** Retryability always comes from the Contracts §6 catalogue, so it cannot drift from the error code. */
function failure(code: ErrorCode, message: string, httpStatus?: number): Failure {
  return { code, message, retryable: RETRYABLE_ERROR_CODES.has(code), httpStatus };
}

/** HTTP answers that are not 2xx, mapped explicitly. A 4xx other than the rate limit is never worth repeating. */
function httpFailure(status: number): Failure {
  if (status === 429) return failure('RATE_LIMITED', 'Karza rate limit reached; retry later.', status);
  if (status === 408 || status >= 500) {
    return failure('DEPENDENCY_UNAVAILABLE', `Karza is unavailable (HTTP ${status}); retry later.`, status);
  }
  if (status === 400 || status === 422) {
    return failure('VALIDATION_ERROR', `Karza rejected the request as invalid (HTTP ${status}).`, status);
  }
  if (status === 401 || status === 403) {
    return failure(
      'INTERNAL_ERROR',
      'Karza rejected the connection credentials; check the vault secret.',
      status,
    );
  }
  if (status === 404) {
    return failure('NOT_FOUND', 'The configured Karza endpoint was not found; check apiEndpoint.', status);
  }
  return failure('INTERNAL_ERROR', `Karza answered with an unexpected HTTP ${status}.`, status);
}

/**
 * A fetch that threw: a timeout, a refused connection, a redirect, a broken body. Only a fixed word describing the cause is handed
 * to normalizeExternalError, never the error's own message, because that text could contain what was being sent.
 */
function networkFailure(err: unknown): Failure {
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

// ── wire format (every assumption of the contract above lives here) ───────────────────────────────────────────────────────────────
function buildRequestBody(
  capability: KarzaCapability,
  check: ParsedCheck,
  caseId: string,
): Record<string, unknown> {
  const common = { consent: 'Y', clientData: { caseId } };
  if (capability === 'VERIFICATION.PAN') return { pan: check.identifier, ...common };
  if (capability === 'VERIFICATION.GST') return { gstin: check.identifier, ...common };
  return { accountNumber: check.identifier, ifsc: check.ifsc, ...common };
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const asText = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** "01/07/2019" becomes "2019-07-01"; anything that is not a real date becomes null. */
function isoDate(ddmmyyyy: string | null): string | null {
  const m = ddmmyyyy === null ? null : /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(ddmmyyyy);
  if (!m) return null;
  const [dd, mm, yyyy] = [m[1] ?? '', m[2] ?? '', m[3] ?? ''];
  const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  const real =
    date.getUTCFullYear() === Number(yyyy) &&
    date.getUTCMonth() === Number(mm) - 1 &&
    date.getUTCDate() === Number(dd);
  return real ? `${yyyy}-${mm}-${dd}` : null;
}

interface Interpretation {
  outcome: KycOutcome;
  reason: KycReason | null;
  nameScore: number | null;
  details: Record<string, string>;
  failure?: Failure;
}

const verdict = (
  outcome: Exclude<KycOutcome, 'ERROR'>,
  reason: KycReason | null,
  details: Record<string, string> = {},
  nameScore: number | null = null,
): Interpretation => ({ outcome, reason, nameScore, details });

const errorOutcome = (reason: KycReason, f: Failure): Interpretation => ({
  outcome: 'ERROR',
  reason,
  nameScore: null,
  details: {},
  failure: f,
});

const unrecognized = (): Interpretation =>
  errorOutcome(
    'UNRECOGNIZED_RESPONSE',
    failure(
      'INTERNAL_ERROR',
      'Karza returned an answer this adapter does not recognise; the check was not verified.',
    ),
  );

/** Compares the requested name with the names the vendor returned; with no name requested the check stands on the vendor's word. */
function decideName(
  requested: string | undefined,
  returned: (string | null)[],
  minScore: number,
  details: Record<string, string>,
): Interpretation {
  if (requested === undefined) return verdict('VERIFIED', null, details);
  const names = returned.filter((n): n is string => n !== null);
  if (names.length === 0) return verdict('FAILED', 'NAME_NOT_RETURNED', details);
  const score = Math.max(...names.map((n) => nameMatchScore(requested, n)));
  return score >= minScore
    ? verdict('VERIFIED', null, details, score)
    : verdict('MISMATCH', 'NAME_MISMATCH', details, score);
}

function interpretPositive(
  capability: KarzaCapability,
  result: Record<string, unknown>,
  requested: string | undefined,
  minScore: number,
): Interpretation {
  if (capability === 'VERIFICATION.PAN') {
    const status = asText(result.status);
    if (status !== null && !/^(valid|active|existing and valid)$/i.test(status)) {
      return verdict('MISMATCH', 'PAN_NOT_VALID');
    }
    return decideName(requested, [asText(result.name)], minScore, {});
  }
  if (capability === 'VERIFICATION.GST') {
    const status = asText(result.sts);
    if (status === null) return unrecognized();
    const gstStatus = status
      .toUpperCase()
      .replace(/[^A-Z]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 32);
    if (gstStatus !== 'ACTIVE') return verdict('MISMATCH', 'GST_NOT_ACTIVE', { gstStatus });
    const registrationDate = isoDate(asText(result.rgdt));
    return decideName(requested, [asText(result.tradeNam), asText(result.lgnm)], minScore, {
      gstStatus: 'ACTIVE',
      ...(registrationDate ? { registrationDate } : {}),
    });
  }
  const txn = result.bankTxnStatus;
  if (txn === false || txn === 'false') return verdict('FAILED', 'BANK_TXN_FAILED');
  if (txn !== true && txn !== 'true') return unrecognized();
  return decideName(requested, [asText(result.accountName)], minScore, {});
}

function interpret(
  capability: KarzaCapability,
  body: Record<string, unknown>,
  requested: string | undefined,
  minScore: number,
): Interpretation {
  switch (String(body['status-code'] ?? '').trim()) {
    case '101':
      return interpretPositive(capability, asRecord(body.result), requested, minScore);
    case '102':
      return verdict('MISMATCH', 'ID_INVALID');
    case '103':
      return verdict('MISMATCH', 'NOT_FOUND');
    case '107':
      return verdict('FAILED', 'NOT_SUPPORTED');
    case '104':
      return errorOutcome(
        'SOURCE_BUSY',
        failure('DEPENDENCY_UNAVAILABLE', 'Karza could not reach the source register just now; retry later.'),
      );
    case '108':
      return errorOutcome(
        'SOURCE_UNAVAILABLE',
        failure('DEPENDENCY_UNAVAILABLE', 'The source register behind Karza is unavailable; retry later.'),
      );
    default:
      return unrecognized();
  }
}

/** The vendor's request id, kept only when it is a short token (it is stored as the provider reference). */
function vendorReference(body: Record<string, unknown>): string | null {
  const id = asText(body.request_id);
  return id !== null && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

// ── output ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const SUBJECT: Record<KarzaCapability, string> = {
  'VERIFICATION.PAN': 'PAN',
  'VERIFICATION.GST': 'GSTIN',
  'VERIFICATION.BANK': 'Bank account',
};
const PHRASE: Record<KycOutcome, string> = {
  VERIFIED: 'verified',
  MISMATCH: 'not verified',
  FAILED: 'check inconclusive',
  ERROR: 'check failed',
};
const VERIFICATION_RESULT: Record<KycOutcome, VerificationResult | null> = {
  VERIFIED: 'VERIFIED',
  MISMATCH: 'REJECTED',
  FAILED: 'INCONCLUSIVE',
  ERROR: null,
};

function buildOutput(
  capability: KarzaCapability,
  masked: string,
  reference: string | null,
  i: Interpretation,
): KycCheckOutput {
  const verified = i.outcome === 'VERIFIED';
  const statusDescription = `${SUBJECT[capability]} ${PHRASE[i.outcome]}${i.reason ? `: ${i.reason}` : ''}`;
  return {
    outcome: i.outcome,
    verificationResult: VERIFICATION_RESULT[i.outcome],
    verified,
    matchScore: i.nameScore,
    identifierMasked: masked,
    referenceId: reference,
    reason: i.reason,
    details: i.details,
    minimalResult: {
      statusDescription,
      ...(i.nameScore !== null ? { nameMatchScore: i.nameScore } : {}),
      maskedIdentifier: masked,
      discrepancies: i.reason ? [i.reason] : [],
      ...(reference ? { providerReference: reference } : {}),
    },
  };
}

const isKarzaCapability = (c: string): c is KarzaCapability =>
  (KARZA_CAPABILITIES as readonly string[]).includes(c);

export class KarzaAdapter implements BaseAdapter<KarzaConfig> {
  readonly providerId = 'KARZA';
  readonly supportedCapabilities = KARZA_CAPABILITIES;
  readonly supportedEnvironments: readonly IntegrationEnvironment[] = ['SANDBOX', 'PRODUCTION'];

  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly retryDelayMs: number;
  private readonly lookupMaxAttempts: number;

  constructor(options: KarzaAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.lookupMaxAttempts = Math.max(1, options.lookupMaxAttempts ?? DEFAULT_LOOKUP_ATTEMPTS);
  }

  validateConfig(config: unknown): { valid: boolean; errors?: string[] } {
    if (!config || typeof config !== 'object') {
      return { valid: false, errors: ['Configuration must be an object'] };
    }
    const c = config as Record<string, unknown>;
    const errors: string[] = [];

    if (
      c.minMatchScore !== undefined &&
      (typeof c.minMatchScore !== 'number' || c.minMatchScore < 0 || c.minMatchScore > 100)
    ) {
      errors.push('minMatchScore must be between 0 and 100');
    }
    if (
      c.timeoutMs !== undefined &&
      (typeof c.timeoutMs !== 'number' ||
        !Number.isInteger(c.timeoutMs) ||
        c.timeoutMs < 100 ||
        c.timeoutMs > MAX_TIMEOUT_MS)
    ) {
      errors.push(`timeoutMs must be a whole number of milliseconds between 100 and ${MAX_TIMEOUT_MS}`);
    }
    // A missing apiEndpoint is accepted here (it can be set later) and refused when a check is run; a malformed one never is.
    const endpointError = c.apiEndpoint === undefined ? null : endpointProblem(c.apiEndpoint);
    if (endpointError !== null) errors.push(endpointError);

    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }

  /**
   * Reports whether a credential was resolved from the vault. It does not call Karza: no ping endpoint is known, and a PAN or
   * penny-drop call must never be made just to find out whether the vendor is up.
   */
  async checkHealth(_config: KarzaConfig, credentials: ResolvedCredentials): Promise<HealthCheckResult> {
    const start = Date.now();
    const hasCreds = Boolean(credentials.apiKey || credentials.authToken);
    const latencyMs = Math.max(1, Date.now() - start);

    return {
      healthy: hasCreds,
      latencyMs,
      message: hasCreds
        ? 'Karza credential resolved from the vault (vendor reachability is not probed)'
        : 'Missing Karza API Key in vault',
      checkedAt: new Date().toISOString(),
      statusCode: hasCreds ? 200 : 401,
    };
  }

  async execute<TInput = KycInput, TOutput = KycCheckOutput>(
    capability: string,
    input: TInput,
    config: KarzaConfig,
    credentials: ResolvedCredentials,
    context: AdapterCallContext,
  ): Promise<AdapterResult<TOutput>> {
    const start = Date.now();
    const environment = context.environment ?? 'SANDBOX';
    const metadata = (extra: Partial<AdapterExecutionMetadata> = {}): AdapterExecutionMetadata => ({
      provider: this.providerId,
      capability,
      environment,
      durationMs: Date.now() - start,
      ...extra,
    });
    /** A call that could not be made or did not finish: an error result, no verification. */
    const refuse = (f: Failure, details?: ErrorDetail[]): AdapterResult<TOutput> => ({
      success: false,
      error: { code: f.code, message: f.message, retryable: f.retryable, ...(details ? { details } : {}) },
      metadata: metadata({ httpStatus: f.httpStatus ?? ERROR_HTTP_STATUS[f.code] }),
    });

    if (!isKarzaCapability(capability)) {
      return refuse(
        failure('VALIDATION_ERROR', `Capability ${capability} is not supported by KarzaAdapter.`, 422),
      );
    }

    const parsed = parseInput(capability, input);
    if (!parsed.ok) {
      return refuse(
        failure('VALIDATION_ERROR', 'The request is not a valid KYC check.', 422),
        parsed.details,
      );
    }
    const { check } = parsed;

    const problem = endpointProblem(config.apiEndpoint);
    if (problem !== null) {
      return refuse(failure('VALIDATION_ERROR', `The Karza connection is not usable: ${problem}.`, 422), [
        { field: 'config.apiEndpoint', issue: 'NOT_CONFIGURED' },
      ]);
    }
    const apiKey = credentials.apiKey ?? credentials.authToken;
    if (!apiKey) {
      return refuse(failure('INTERNAL_ERROR', 'The Karza API key is not available in the vault.'));
    }

    const minScore =
      typeof config.minMatchScore === 'number' ? config.minMatchScore : DEFAULT_MIN_MATCH_SCORE;
    const timeoutMs =
      typeof config.timeoutMs === 'number' && config.timeoutMs >= 100 && config.timeoutMs <= MAX_TIMEOUT_MS
        ? config.timeoutMs
        : DEFAULT_TIMEOUT_MS;
    // The penny drop moves money: a timeout does not say whether the Rs 1 left, so it is never repeated automatically.
    const attempts = capability === 'VERIFICATION.BANK' ? 1 : this.lookupMaxAttempts;

    const answer = await this.post(
      config.apiEndpoint as string,
      apiKey,
      buildRequestBody(capability, check, context.correlationId),
      timeoutMs,
      attempts,
    );
    if (!answer.ok) {
      return this.errorResult(capability, check.masked, answer.failure, 'PROVIDER_ERROR', null, metadata);
    }

    const body = parseJsonObject(answer.text);
    if (body === null) {
      const f = failure('INTERNAL_ERROR', 'Karza did not return a JSON object; the check was not verified.');
      return this.errorResult(
        capability,
        check.masked,
        f,
        'UNRECOGNIZED_RESPONSE',
        null,
        metadata,
        answer.status,
      );
    }
    const reference = vendorReference(body);
    const interpretation = interpret(capability, body, check.name, minScore);

    if (interpretation.outcome === 'ERROR' && interpretation.failure) {
      const vendorCode = String(body['status-code'] ?? '').trim();
      const details: ErrorDetail[] = /^[A-Za-z0-9_-]{1,8}$/.test(vendorCode)
        ? [{ issue: interpretation.reason ?? 'PROVIDER_ERROR', meta: { vendorStatusCode: vendorCode } }]
        : [];
      return this.errorResult(
        capability,
        check.masked,
        interpretation.failure,
        interpretation.reason ?? 'PROVIDER_ERROR',
        reference,
        metadata,
        answer.status,
        details,
      );
    }

    return {
      success: true,
      data: buildOutput(capability, check.masked, reference, interpretation) as TOutput,
      metadata: metadata({
        httpStatus: answer.status,
        ...(reference ? { externalTransactionId: reference } : {}),
      }),
    };
  }

  /** An ERROR outcome: success is false, the error says whether to retry, and the data states plainly that nothing was verified. */
  private errorResult<TOutput>(
    capability: KarzaCapability,
    masked: string,
    f: Failure,
    reason: KycReason,
    reference: string | null,
    metadata: (extra?: Partial<AdapterExecutionMetadata>) => AdapterExecutionMetadata,
    httpStatus?: number,
    details: ErrorDetail[] = [],
  ): AdapterResult<TOutput> {
    const output = buildOutput(capability, masked, reference, {
      outcome: 'ERROR',
      reason,
      nameScore: null,
      details: {},
    });
    return {
      success: false,
      data: output as TOutput,
      error: {
        code: f.code,
        message: f.message,
        retryable: f.retryable,
        ...(details.length > 0 ? { details } : {}),
      },
      metadata: metadata({
        httpStatus: httpStatus ?? f.httpStatus ?? ERROR_HTTP_STATUS[f.code],
        ...(reference ? { externalTransactionId: reference } : {}),
      }),
    };
  }

  /** One POST, repeated up to `maxAttempts` times only for a thrown error or a gateway that is down. */
  private async post(
    url: string,
    apiKey: string,
    body: Record<string, unknown>,
    timeoutMs: number,
    maxAttempts: number,
  ): Promise<{ ok: true; status: number; text: string } | { ok: false; failure: Failure }> {
    const payload = JSON.stringify(body);
    let last: Failure = failure('DEPENDENCY_UNAVAILABLE', 'Karza did not answer.');
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await this.fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json', 'x-karza-key': apiKey },
          body: payload,
          signal: AbortSignal.timeout(timeoutMs),
          // The key and the identifier must never follow a redirect to another host.
          redirect: 'error',
        });
        const text = await res.text();
        if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, text };
        last = httpFailure(res.status);
        if (!RETRYABLE_HTTP_STATUSES.has(res.status)) return { ok: false, failure: last };
      } catch (err) {
        last = networkFailure(err);
      }
      if (attempt < maxAttempts) await this.sleep(this.retryDelayMs);
    }
    return { ok: false, failure: last };
  }
}

/** Null when `endpoint` is a usable https URL without embedded credentials; otherwise what is wrong with it. */
function endpointProblem(endpoint: unknown): string | null {
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
