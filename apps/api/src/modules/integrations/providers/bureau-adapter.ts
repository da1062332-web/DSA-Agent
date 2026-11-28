// apps/api/src/modules/integrations/providers/bureau-adapter.ts
// Module 28: Integration Management (MOD-INT) — credit-bureau soft-pull adapter (P1-05): BUREAU.SOFT_PULL.
//
// Every call is a real HTTPS POST to the endpoint set on the connection (config.apiEndpoint), authenticated with the key resolved from the
// vault. Nothing here is simulated: the simulated provider is MockTestAdapter, which the registry refuses in production.
//
// Data handling. The PAN, date of birth and name exist only in the outgoing request body. The result is the SUMMARY only (score, accounts,
// monthly EMI, days past due, enquiries): the raw report, and anything that identifies the person, is never copied out, returned or logged.
//
// Fail closed. A score is returned only when the bureau positively says so and it is a whole number from 300 to 900 with every other
// figure present. A timeout, a vendor error or any answer this file does not recognise is an ERROR and never a score: there is no default
// score, and "no history" is its own result, never 0. A pull costs money, so it is attempted ONCE: a retry is the caller's decision.
//
// ── ASSUMED VENDOR CONTRACT (NOT VERIFIED) ────────────────────────────────────────────────────────────────────────────────────
// No bureau vendor, agreement or sandbox exists yet (Notion plan section 11: the first bureau vendor, and the route to access it through a
// lender's membership or a bureau-approved reseller, are open decisions), so BUREAU_PROVIDER_ID is a placeholder. Everything in the "wire
// format" section below is an assumption kept in one place, so the sandbox contract tests can confirm or correct it without touching the
// rest of the adapter:
//   request    POST {config.apiEndpoint}, JSON body { bureau, name, pan, dob (YYYY-MM-DD), consent "Y", clientData.caseId }, header
//              "x-api-key: <apiKey from the vault>"
//   answer     HTTP 200 with { request_id, "status-code", result }
//              "status-code" 101 = a report, result { score, activeAccounts, totalEmi, maxDpd12m, enquiries6m, reportDate? }
//                            103 = the bureau holds no history for this person (a result, not an error)
//                            102 = the bureau did not accept the request details (not retryable)
//                            107 = this bureau is not available through the connection (not retryable)
//                            104 = source busy, 108 = source unavailable (retryable)
//   money      totalEmi is the sum of the monthly EMIs, in rupees, a number or a decimal string with at most two decimals
// The vendor's treatment of a repeated clientData.caseId (does it recognise the repeat and not charge again?) is also an assumption.

import {
  ERROR_HTTP_STATUS,
  isRealDate,
  type AdapterExecutionMetadata,
  type AdapterResult,
  type BureauSummary,
  type CreditBureau,
  type CreditReportOutcome,
  type ErrorDetail,
  type HealthCheckResult,
  type IntegrationEnvironment,
  type Money,
} from '@dsa/contracts';
import { z } from 'zod';
import type { AdapterCallContext, BaseAdapter } from '../adapter';
import type { ResolvedCredentials } from '../vault-port';
import {
  DEFAULT_RETRY_DELAY_MS,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  endpointProblem,
  failure,
  postJson,
  type Failure,
  type FetchLike,
} from './vendor-http';

/** Placeholder until a bureau vendor is chosen: renaming it here, in the descriptor and in the connection is all a change of vendor needs. */
export const BUREAU_PROVIDER_ID = 'CRIF';
export const BUREAU_CAPABILITIES = ['BUREAU.SOFT_PULL'] as const;

/** What the adapter is asked for. */
export interface BureauInput {
  bureau: CreditBureau;
  name: string;
  pan: string;
  /** YYYY-MM-DD */
  dateOfBirth: string;
}

/** What the adapter returns on success: the summary, the bureau's report date when it gave one, its request id and the configured unit cost. */
export interface BureauPullOutput {
  outcome: CreditReportOutcome;
  /** YYYY-MM-DD as the bureau gives it, or null when it gave none (the caller then uses the day of the request). */
  reportDate: string | null;
  summary: BureauSummary | null;
  vendorRef: string | null;
  unitCost: Money | null;
}

export interface BureauConfig {
  /** Full https URL of the bureau endpoint. */
  apiEndpoint?: string;
  /** Time allowed for the one attempt, in milliseconds. Default 10000, at most 60000. */
  timeoutMs?: number;
  /** What one pull costs, a decimal string with two places such as "45.00" (rupees). Absent means no cost is recorded. */
  unitCostAmount?: string;
}

export interface BureauAdapterOptions {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  retryDelayMs?: number;
}

const COST_PATTERN = /^\d{1,16}\.\d{2}$/;

// ── input ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const upper = (v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase() : v);
const BureauInputSchema = z.object({
  bureau: z.enum(['CIBIL', 'CRIF', 'EXPERIAN', 'EQUIFAX'], {
    errorMap: () => ({ message: 'INVALID_BUREAU' }),
  }),
  name: z.string().trim().min(1, 'INVALID_NAME').max(120, 'INVALID_NAME'),
  pan: z.preprocess(upper, z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'INVALID_PAN_FORMAT')),
  dateOfBirth: z.string().refine((s) => isRealDate(s) && s >= '1900-01-01', 'INVALID_DATE_OF_BIRTH'),
});

// ── wire format (every assumption of the contract above lives here) ───────────────────────────────────────────────────────────────
function buildRequestBody(input: z.infer<typeof BureauInputSchema>, caseId: string): Record<string, unknown> {
  return {
    bureau: input.bureau,
    name: input.name,
    pan: input.pan,
    dob: input.dateOfBirth,
    consent: 'Y',
    clientData: { caseId },
  };
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

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

/** A whole number from a number or a digits-only string; anything else is null. */
function wholeNumber(v: unknown): number | null {
  const n =
    typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,9}$/.test(v.trim()) ? Number(v.trim()) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Rupees as the Money amount string with two places; a number or a decimal string with at most two decimals, never negative. */
function rupees(v: unknown): string | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0 || v >= 1e12) return null;
    // At most two decimals: 18400.1 and 18400.10 are fine, 18400.123 is not an amount of rupees and paise.
    return Math.abs(v * 100 - Math.round(v * 100)) < 1e-6 ? v.toFixed(2) : null;
  }
  if (typeof v === 'string' && /^\d{1,12}(\.\d{1,2})?$/.test(v.trim())) {
    const [whole, frac = ''] = v.trim().split('.');
    return `${whole}.${frac.padEnd(2, '0')}`;
  }
  return null;
}

/** The report date, only when it is a real YYYY-MM-DD date; absent is null, present and not a date is a problem (undefined). */
function reportDateOf(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === '') return null;
  return typeof v === 'string' && isRealDate(v.trim()) ? v.trim() : undefined;
}

function vendorReference(body: Record<string, unknown>): string | null {
  const id = typeof body.request_id === 'string' ? body.request_id.trim() : '';
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

const unrecognized = (): Failure =>
  failure(
    'INTERNAL_ERROR',
    'The bureau returned an answer this adapter does not recognise; no score was recorded.',
  );

type Interpretation =
  | { ok: true; outcome: CreditReportOutcome; reportDate: string | null; summary: BureauSummary | null }
  | { ok: false; failure: Failure; vendorStatusCode?: string };

function interpret(body: Record<string, unknown>): Interpretation {
  const code = String(body['status-code'] ?? '').trim();
  switch (code) {
    case '101': {
      const r = asRecord(body.result);
      const score = r.score;
      const activeAccounts = wholeNumber(r.activeAccounts);
      const monthlyEmi = rupees(r.totalEmi);
      const maxDpd12m = wholeNumber(r.maxDpd12m);
      const enquiries6m = wholeNumber(r.enquiries6m);
      const reportDate = reportDateOf(r.reportDate);
      // Every figure must be there: a missing one is never replaced by a default.
      if (
        typeof score !== 'number' ||
        !Number.isInteger(score) ||
        score < 300 ||
        score > 900 ||
        activeAccounts === null ||
        monthlyEmi === null ||
        maxDpd12m === null ||
        enquiries6m === null ||
        reportDate === undefined
      ) {
        return { ok: false, failure: unrecognized(), vendorStatusCode: code };
      }
      return {
        ok: true,
        outcome: 'SCORED',
        reportDate,
        summary: {
          score,
          activeAccounts,
          monthlyEmi: { amount: monthlyEmi, currency: 'INR' },
          maxDpd12m,
          enquiries6m,
        },
      };
    }
    case '103': {
      const reportDate = reportDateOf(asRecord(body.result).reportDate);
      return { ok: true, outcome: 'NO_HISTORY', reportDate: reportDate ?? null, summary: null };
    }
    case '102':
      return {
        ok: false,
        failure: failure('VALIDATION_ERROR', 'The bureau did not accept the request details.', 422),
        vendorStatusCode: code,
      };
    case '107':
      return {
        ok: false,
        failure: failure(
          'VALIDATION_ERROR',
          'This bureau is not available through the configured provider.',
          422,
        ),
        vendorStatusCode: code,
      };
    case '104':
      return {
        ok: false,
        failure: failure('DEPENDENCY_UNAVAILABLE', 'The bureau could not be reached just now; retry later.'),
        vendorStatusCode: code,
      };
    case '108':
      return {
        ok: false,
        failure: failure('DEPENDENCY_UNAVAILABLE', 'The bureau is unavailable; retry later.'),
        vendorStatusCode: code,
      };
    default:
      return { ok: false, failure: unrecognized() };
  }
}

export class BureauAdapter implements BaseAdapter<BureauConfig> {
  readonly providerId = BUREAU_PROVIDER_ID;
  readonly supportedCapabilities = BUREAU_CAPABILITIES;
  readonly supportedEnvironments: readonly IntegrationEnvironment[] = ['SANDBOX', 'PRODUCTION'];

  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly retryDelayMs: number;

  constructor(options: BureauAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  validateConfig(config: unknown): { valid: boolean; errors?: string[] } {
    if (!config || typeof config !== 'object') {
      return { valid: false, errors: ['Configuration must be an object'] };
    }
    const c = config as Record<string, unknown>;
    const errors: string[] = [];
    if (
      c.timeoutMs !== undefined &&
      (typeof c.timeoutMs !== 'number' ||
        !Number.isInteger(c.timeoutMs) ||
        c.timeoutMs < 100 ||
        c.timeoutMs > MAX_TIMEOUT_MS)
    ) {
      errors.push(`timeoutMs must be a whole number of milliseconds between 100 and ${MAX_TIMEOUT_MS}`);
    }
    if (
      c.unitCostAmount !== undefined &&
      (typeof c.unitCostAmount !== 'string' || !COST_PATTERN.test(c.unitCostAmount))
    ) {
      errors.push('unitCostAmount must be a decimal string with two places, for example "45.00"');
    }
    // A missing apiEndpoint is accepted here (it can be set later) and refused when a pull is made; a malformed one never is.
    const endpointError = c.apiEndpoint === undefined ? null : endpointProblem(c.apiEndpoint);
    if (endpointError !== null) errors.push(endpointError);
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }

  /** Reports whether a credential was resolved from the vault. It does not call the bureau: a pull costs money and must never be made to find out. */
  async checkHealth(_config: BureauConfig, credentials: ResolvedCredentials): Promise<HealthCheckResult> {
    const start = Date.now();
    const hasCreds = Boolean(credentials.apiKey || credentials.authToken);
    return {
      healthy: hasCreds,
      latencyMs: Math.max(1, Date.now() - start),
      message: hasCreds
        ? 'Bureau credential resolved from the vault (vendor reachability is not probed)'
        : 'Missing bureau API key in vault',
      checkedAt: new Date().toISOString(),
      statusCode: hasCreds ? 200 : 401,
    };
  }

  async execute<TInput = BureauInput, TOutput = BureauPullOutput>(
    capability: string,
    input: TInput,
    config: BureauConfig,
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
    /** A call that could not be made or did not finish: an error result, no score. */
    const refuse = (f: Failure, details?: ErrorDetail[], httpStatus?: number): AdapterResult<TOutput> => ({
      success: false,
      error: { code: f.code, message: f.message, retryable: f.retryable, ...(details ? { details } : {}) },
      metadata: metadata({ httpStatus: httpStatus ?? f.httpStatus ?? ERROR_HTTP_STATUS[f.code] }),
    });

    if (capability !== 'BUREAU.SOFT_PULL') {
      return refuse(
        failure('VALIDATION_ERROR', `Capability ${capability} is not supported by BureauAdapter.`, 422),
      );
    }
    const parsed = BureauInputSchema.safeParse(input);
    if (!parsed.success) {
      // Only the field and a fixed issue code are reported: never the value that was rejected.
      return refuse(
        failure('VALIDATION_ERROR', 'The request is not a valid bureau pull.', 422),
        parsed.error.issues.map((issue) => ({
          field: issue.path.join('.') || 'input',
          issue: /^[A-Z_]+$/.test(issue.message) ? issue.message : 'INVALID_VALUE',
        })),
      );
    }
    const problem = endpointProblem(config.apiEndpoint);
    if (problem !== null) {
      return refuse(failure('VALIDATION_ERROR', `The bureau connection is not usable: ${problem}.`, 422), [
        { field: 'config.apiEndpoint', issue: 'NOT_CONFIGURED' },
      ]);
    }
    const apiKey = credentials.apiKey ?? credentials.authToken;
    if (!apiKey) {
      return refuse(failure('INTERNAL_ERROR', 'The bureau API key is not available in the vault.'));
    }
    const timeoutMs =
      typeof config.timeoutMs === 'number' && config.timeoutMs >= 100 && config.timeoutMs <= MAX_TIMEOUT_MS
        ? config.timeoutMs
        : DEFAULT_TIMEOUT_MS;
    const unitCost: Money | null =
      typeof config.unitCostAmount === 'string' && COST_PATTERN.test(config.unitCostAmount)
        ? { amount: config.unitCostAmount, currency: 'INR' }
        : null;

    // A pull costs money: one attempt, never repeated here.
    const answer = await postJson(
      { fetchImpl: this.fetchImpl, sleep: this.sleep, retryDelayMs: this.retryDelayMs, vendor: 'The bureau' },
      config.apiEndpoint as string,
      { 'x-api-key': apiKey },
      buildRequestBody(parsed.data, context.correlationId),
      timeoutMs,
      1,
    );
    if (!answer.ok) return refuse(answer.failure);

    const body = parseJsonObject(answer.text);
    if (body === null) return refuse(unrecognized(), undefined, answer.status);
    const reference = vendorReference(body);
    const interpretation = interpret(body);
    if (!interpretation.ok) {
      const details: ErrorDetail[] =
        interpretation.vendorStatusCode !== undefined
          ? [{ issue: 'VENDOR_STATUS', meta: { vendorStatusCode: interpretation.vendorStatusCode } }]
          : [];
      return refuse(interpretation.failure, details.length > 0 ? details : undefined, answer.status);
    }

    const output: BureauPullOutput = {
      outcome: interpretation.outcome,
      reportDate: interpretation.reportDate,
      summary: interpretation.summary,
      vendorRef: reference,
      unitCost,
    };
    return {
      success: true,
      data: output as TOutput,
      metadata: metadata({
        httpStatus: answer.status,
        ...(reference ? { externalTransactionId: reference } : {}),
      }),
    };
  }
}
