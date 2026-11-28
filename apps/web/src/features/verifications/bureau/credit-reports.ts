// apps/web/src/features/verifications/bureau/credit-reports.ts — owner: Prathamesh (MOD-VER web, P1-05). The calls, the request, the messages and
// the consent status of the Bureau card on the customer page (POST and GET /v1/customers/{id}/credit-reports, API-CRP-001 to 003). No React in
// this file, so the rules can be tested without a browser.
//
// Data handling. The PAN, date of birth and name typed for a pull are for ONE pull: they go to the API and nowhere else. This file never logs,
// stores or caches them, and no message built here contains a typed value (only fixed words). A report holds no identifier at all.
import {
  CREDIT_BUREAUS,
  PullCreditReportSchema,
  isPullableDateOfBirth,
  type CreditBureau,
  type CreditReport,
  type ListCreditReportsResponse,
  type Money,
  type PullCreditReport,
} from '@dsa/contracts';
import { ApiError, apiFetch } from '../../../api/client';
import type { ConsentResource } from '../../customers/types';

export const BUREAUS: readonly CreditBureau[] = CREDIT_BUREAUS;
export const BUREAU_LABELS: Record<CreditBureau, string> = {
  CIBIL: 'CIBIL',
  CRIF: 'CRIF',
  EXPERIAN: 'Experian',
  EQUIFAX: 'Equifax',
};

/** The 24-hour window of the server's cache, in words. */
export const CACHE_NOTE = 'This report is from the last 24 hours, so the bureau was not charged again.';

/** A request this much earlier than "now" is allowed for the difference between the two clocks. */
export const CLOCK_DIFFERENCE_MS = 60_000;

// ── the form ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Everything the person types for one pull. All three are sensitive. */
export interface BureauPullForm {
  name: string;
  pan: string;
  /** YYYY-MM-DD */
  dateOfBirth: string;
}
export type BureauPullField = keyof BureauPullForm | 'bureau';

export function emptyBureauPullForm(name = ''): BureauPullForm {
  return { name, pan: '', dateOfBirth: '' };
}

const FIELD_MESSAGES: Record<BureauPullField, string> = {
  bureau: 'Choose the bureau.',
  name: 'Enter the name as the bureau should match it, as plain text with no PAN, Aadhaar or account number in it.',
  pan: 'Enter a valid PAN, for example ABCDE1234F.',
  dateOfBirth: 'Enter the date of birth as YYYY-MM-DD, for example 1987-06-23.',
};
export const AGE_MESSAGE = 'A report can be pulled only for a person aged 18 to 100.';

export type BureauFieldErrors = Partial<Record<BureauPullField, string>>;
export type ParsedBureauPull =
  { ok: true; body: PullCreditReport } | { ok: false; fieldErrors: BureauFieldErrors };

/**
 * Checks the form with the SAME schema the server uses, and the same age rule with the clock passed in, so the rules cannot drift. A bad
 * field gets a fixed message; the typed value is never part of it. On success `body` is the normalised request (PAN upper-cased).
 */
export function parseBureauPullForm(form: BureauPullForm, bureau: CreditBureau, now: Date): ParsedBureauPull {
  const parsed = PullCreditReportSchema.safeParse({
    bureau,
    name: form.name.trim(),
    pan: form.pan,
    dateOfBirth: form.dateOfBirth.trim(),
  });
  if (!parsed.success) {
    const fieldErrors: BureauFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === 'string' && field in FIELD_MESSAGES && !(field in fieldErrors)) {
        fieldErrors[field as BureauPullField] = FIELD_MESSAGES[field as BureauPullField];
      }
    }
    // A date that is a real date but not one a pull may be made for is reported together with the other problems, not after them.
    const dob = form.dateOfBirth.trim();
    if (!fieldErrors.dateOfBirth && dob !== '' && !isPullableDateOfBirth(dob, now))
      fieldErrors.dateOfBirth = AGE_MESSAGE;
    // An issue that names no field (it cannot happen with the body built above) must still stop the request.
    if (Object.keys(fieldErrors).length === 0) fieldErrors.name = FIELD_MESSAGES.name;
    return { ok: false, fieldErrors };
  }
  if (!isPullableDateOfBirth(parsed.data.dateOfBirth, now)) {
    return { ok: false, fieldErrors: { dateOfBirth: AGE_MESSAGE } };
  }
  return { ok: true, body: parsed.data };
}

// ── the calls ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const base = (customerId: string) => `/v1/customers/${encodeURIComponent(customerId)}/credit-reports`;

/** The key is chosen by the caller (BureauPullSession) and is the SAME for every retry of one attempt. */
export function pullCreditReport(
  customerId: string,
  body: PullCreditReport,
  idempotencyKey: string,
): Promise<CreditReport> {
  return apiFetch<CreditReport>(base(customerId), { method: 'POST', body, idempotencyKey });
}

/** The newest report of a bureau, or null when none has been pulled (the API answers 404). Any other error is thrown. */
export async function fetchLatestCreditReport(
  customerId: string,
  bureau: CreditBureau,
): Promise<CreditReport | null> {
  try {
    return await apiFetch<CreditReport>(`${base(customerId)}/latest`, { query: { bureau } });
  } catch (err) {
    if (err instanceof ApiError && err.httpStatus === 404) return null;
    throw err;
  }
}

export const HISTORY_PAGE_SIZE = 20;

export function fetchCreditReportHistory(
  customerId: string,
  bureau: CreditBureau,
  cursor?: string,
): Promise<ListCreditReportsResponse> {
  return apiFetch<ListCreditReportsResponse>(base(customerId), {
    query: { bureau, limit: HISTORY_PAGE_SIZE, ...(cursor ? { cursor } : {}) },
  });
}

/**
 * True when the answer to a pull is a report from before the pull was asked for: the API answered from its 24-hour cache and the bureau was
 * not charged. The client does not see the API's cache header, so this compares the time the report was pulled with the moment the attempt
 * began (allowing for the difference between the two clocks).
 */
export function isFromCache(report: Pick<CreditReport, 'pulledAt'>, attemptStartedAt: number): boolean {
  return Date.parse(report.pulledAt) < attemptStartedAt - CLOCK_DIFFERENCE_MS;
}

// ── the consent of a bureau ────────────────────────────────────────────────────────────────────────────────────────────────────
export type BureauConsentStatus =
  | { kind: 'ACTIVE'; capturedAt: string; channel: string }
  | { kind: 'WITHDRAWN' }
  | { kind: 'EXPIRED' }
  | { kind: 'NONE' }
  /** The consents could not be read (no permission, an error, or still loading). Never shown as "no consent". */
  | { kind: 'UNKNOWN' };

/**
 * The consent of the customer for one bureau, from the consents the customers API lists. Only consents with the purpose BUREAU_PULL whose
 * target is that bureau count. An ACTIVE consent that is past its expiry is EXPIRED. The server decides in the end; this only tells the person.
 */
export function consentStatusFor(
  consents: readonly ConsentResource[] | null | undefined,
  bureau: CreditBureau,
  now: Date,
): BureauConsentStatus {
  if (!consents) return { kind: 'UNKNOWN' };
  const mine = consents
    .filter((c) => (c.purpose as string) === 'BUREAU_PULL' && c.purposeTarget === bureau)
    .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
  const live = (c: ConsentResource) =>
    c.status === 'ACTIVE' && (c.expiresAt === null || Date.parse(c.expiresAt) > now.getTime());
  const active = mine.find(live);
  if (active) return { kind: 'ACTIVE', capturedAt: active.capturedAt, channel: active.channel };
  const latest = mine[0];
  if (!latest) return { kind: 'NONE' };
  return latest.status === 'WITHDRAWN' ? { kind: 'WITHDRAWN' } : { kind: 'EXPIRED' };
}

export const CONSENT_TEXT: Record<Exclude<BureauConsentStatus['kind'], 'ACTIVE'>, string> = {
  WITHDRAWN: 'The customer withdrew the consent for this bureau.',
  EXPIRED: 'The consent for this bureau has expired.',
  NONE: 'No consent has been recorded for this bureau.',
  UNKNOWN: 'The consent status could not be read here. The server checks it when you pull.',
};

// ── money and words ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Indian digit grouping (12,34,567) of a string of digits. */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

/** { amount: "18400.00", currency: "INR" } as ₹18,400.00. Null stays null; another currency keeps its code. */
export function formatRupees(money: Money | null | undefined): string | null {
  if (!money) return null;
  const [whole = '0', frac = '00'] = money.amount.split('.');
  const text = `${groupIndian(whole)}.${frac.padEnd(2, '0').slice(0, 2)}`;
  return money.currency === 'INR' ? `₹${text}` : `${money.currency} ${text}`;
}

export function outcomeText(report: Pick<CreditReport, 'outcome' | 'bureau'>): string {
  return report.outcome === 'SCORED'
    ? 'Scored'
    : `No credit history was found at ${BUREAU_LABELS[report.bureau]}`;
}

// ── errors in plain words ──────────────────────────────────────────────────────────────────────────────────────────────────────
export interface PullErrorView {
  title: string;
  message: string;
  /** True when sending the SAME request again (same key) is the right next step. False when the request has to change. */
  canRetry: boolean;
  correlationId?: string;
}

const view = (title: string, message: string, canRetry: boolean, err?: ApiError): PullErrorView => ({
  title,
  message,
  canRetry,
  ...(err?.correlationId ? { correlationId: err.correlationId } : {}),
});

/**
 * What an error means for the person. Every message is made of fixed words: the API's own text is not shown, so nothing typed can come
 * back through it. A retry is only ever offered with the same key, which makes it safe even when the first request did arrive.
 */
export function describePullError(err: unknown): PullErrorView {
  if (!(err instanceof ApiError)) {
    return view(
      'The report could not be pulled',
      'Something unexpected went wrong. Try again: the same request is not run twice.',
      true,
    );
  }
  if (err.httpStatus === 0) {
    return view(
      'Connection lost',
      'We cannot tell whether the request reached the server. Try again: it is sent with the same reference, so the bureau is not charged a second time for it.',
      true,
      err,
    );
  }
  const issues = err.details.map((d) => d.issue);
  switch (err.code) {
    case 'CONSENT_REQUIRED':
      return view(
        'Consent is missing',
        'The customer has no active consent for this bureau. Record the consent first, then pull the report.',
        false,
        err,
      );
    case 'VALIDATION_ERROR':
      if (issues.includes('NO_ACTIVE_CONNECTION')) {
        return view(
          'No bureau provider is set up',
          'Ask an administrator to set one up under Integrations, then pull the report again.',
          false,
          err,
        );
      }
      if (issues.includes('INVALID_AGE')) return view('Date of birth not accepted', AGE_MESSAGE, false, err);
      if (issues.includes('VENDOR_STATUS')) {
        return view(
          'The bureau did not accept this request',
          'The bureau did not accept these details, or does not serve this bureau through the configured provider. Check the details and the bureau.',
          false,
          err,
        );
      }
      return view('The request was not accepted', 'Check the fields and try again.', false, err);
    case 'NOT_FOUND':
      return view(
        'Customer not found',
        'This customer was not found, or is outside the records you can use.',
        false,
        err,
      );
    case 'FORBIDDEN':
      return view('Not allowed', 'You do not have permission to pull credit reports.', false, err);
    case 'IDEMPOTENCY_KEY_REUSED':
      return view(
        'This request was already used',
        'It was sent before with different details. Start a new pull.',
        false,
        err,
      );
    case 'RATE_LIMITED':
      return view(
        'The bureau is busy',
        'Too many requests were sent. Wait a moment, then try again.',
        true,
        err,
      );
    case 'DEPENDENCY_UNAVAILABLE':
      return view(
        'The bureau could not be reached',
        'Try again in a moment. The same request is not run twice.',
        true,
        err,
      );
    case 'INTERNAL_ERROR':
      return view(
        'The server could not complete the pull',
        'Try again. If it keeps failing, contact support and quote the reference below.',
        true,
        err,
      );
    default:
      return view(
        'The report could not be pulled',
        'Try again, or contact support and quote the reference below.',
        true,
        err,
      );
  }
}

/** The text for a failed read (latest or history): fixed words, with the reference when there is one. */
export function describeReadError(err: unknown): { message: string; correlationId?: string } {
  if (err instanceof ApiError) {
    const message =
      err.code === 'FORBIDDEN'
        ? 'You do not have permission to view credit reports.'
        : err.httpStatus === 0 || err.code === 'DEPENDENCY_UNAVAILABLE'
          ? 'The reports could not be loaded. Check the connection and try again.'
          : 'The reports could not be loaded.';
    return { message, ...(err.correlationId ? { correlationId: err.correlationId } : {}) };
  }
  return { message: 'The reports could not be loaded.' };
}
