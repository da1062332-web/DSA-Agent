// apps/web/src/features/verifications/run-check.ts — owner: Prathamesh (MOD-VER web, P1-06). The request, the messages and the API call of
// "Run a provider check" (POST /v1/verifications/checks, API-VER-003). No React in this file, so the rules can be tested without a browser.
//
// Data handling. The PAN, GSTIN, account number and name typed here are for ONE check: they go to the API and nowhere else. This file never
// logs, stores or caches them, and no message built here contains a typed value (only fixed words and the masked values the API returns).
import {
  KYC_RUNNABLE_CHECKS,
  RunVerificationCheckSchema,
  type KycRunnableCheck,
  type RunVerificationCheck,
  type VerificationRecord,
  type VerificationSubjectType,
} from '@dsa/contracts';
import { ApiError, apiFetch } from '../../api/client';

/** The checks the screen can run. They come from the contracts, so a check added there is not forgotten here. */
export type RunCheckKind = KycRunnableCheck;
export const RUN_CHECK_KINDS: readonly RunCheckKind[] = KYC_RUNNABLE_CHECKS;

export const RUN_CHECK_LABELS: Record<RunCheckKind, string> = {
  PAN: 'PAN check',
  GST: 'GST check',
  BANK_ACCOUNT: 'Bank account (₹1 penny drop)',
};

export const SUBJECT_TYPE_LABELS: Record<VerificationSubjectType, string> = {
  CUSTOMER: 'Customer',
  LOAN_APPLICATION: 'Loan application',
  LEAD: 'Lead',
};

/** Everything the person types. Strings only; the sensitive ones are idNumber, accountNumber and name. */
export interface RunCheckForm {
  check: RunCheckKind;
  subjectType: VerificationSubjectType;
  subjectId: string;
  consentRecordId: string;
  /** The full PAN or GSTIN. */
  idNumber: string;
  /** The full bank account number. */
  accountNumber: string;
  /** A public branch code, not personal data. */
  ifsc: string;
  /** The name to compare with the one the provider holds. */
  name: string;
}
export type RunCheckField = keyof RunCheckForm;

export function emptyRunCheckForm(): RunCheckForm {
  return {
    check: 'PAN',
    subjectType: 'CUSTOMER',
    subjectId: '',
    consentRecordId: '',
    idNumber: '',
    accountNumber: '',
    ifsc: '',
    name: '',
  };
}

/** The same form with everything that identifies a person or an account cleared. Who and which consent stay, to ease the next check. */
export function withoutSensitiveValues(form: RunCheckForm): RunCheckForm {
  return { ...form, idNumber: '', accountNumber: '', name: '' };
}

/** The fields each check asks for, in the order of the screen. */
export const RUN_CHECK_FIELDS: Record<RunCheckKind, readonly RunCheckField[]> = {
  PAN: ['idNumber', 'name'],
  GST: ['idNumber', 'name'],
  BANK_ACCOUNT: ['accountNumber', 'ifsc', 'name'],
};

// ── the request ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The body of the check chosen: only that check's own fields, because the API refuses any other key (422). */
function buildBody(form: RunCheckForm): Record<string, unknown> {
  const name = form.name.trim();
  const common = {
    check: form.check,
    subjectType: form.subjectType,
    subjectId: form.subjectId.trim(),
    consentRecordId: form.consentRecordId.trim(),
    ...(name !== '' ? { name } : {}),
  };
  if (form.check === 'BANK_ACCOUNT') {
    return { ...common, accountNumber: form.accountNumber, ifsc: form.ifsc };
  }
  return { ...common, idNumber: form.idNumber };
}

const FIELD_MESSAGES: Record<RunCheckField, (check: RunCheckKind) => string> = {
  check: () => 'Choose the check to run.',
  subjectType: () => 'Choose who the check is about.',
  subjectId: () => 'Enter the id of the customer, loan application or lead.',
  consentRecordId: () => 'Enter the consent record id. It starts with cnst_.',
  idNumber: (check) =>
    check === 'GST'
      ? 'Enter a valid GSTIN, for example 27ABCDE1234F1Z5.'
      : 'Enter a valid PAN, for example ABCDE1234F.',
  accountNumber: () => 'Enter the account number: 9 to 18 digits.',
  ifsc: () => 'Enter a valid IFSC code, for example HDFC0001234.',
  name: () => 'The name must be plain text, with no PAN, Aadhaar or account number in it.',
};

/** The id prefix of each kind of subject (packages/contracts ids.ts), so an id of another kind is caught here, before the server refuses it. */
const SUBJECT_ID_PREFIX: Record<VerificationSubjectType, string> = {
  CUSTOMER: 'cust_',
  LOAN_APPLICATION: 'app_',
  LEAD: 'lead_',
};
const SUBJECT_ID_KIND: Record<VerificationSubjectType, string> = {
  CUSTOMER: 'a customer id',
  LOAN_APPLICATION: 'a loan application id',
  LEAD: 'a lead id',
};

/**
 * A message when the id typed is plainly of another kind than "Check is about" says (a lead_ id under Customer). It is made of fixed
 * words, never the typed id. An id with a prefix nobody knows is left to the server.
 */
function subjectIdMismatch(form: RunCheckForm): string | null {
  const id = form.subjectId.trim();
  for (const type of Object.keys(SUBJECT_ID_PREFIX) as VerificationSubjectType[]) {
    if (type !== form.subjectType && id.startsWith(SUBJECT_ID_PREFIX[type])) {
      return `This looks like ${SUBJECT_ID_KIND[type]}. Choose "${SUBJECT_TYPE_LABELS[type]}" under "Check is about".`;
    }
  }
  return null;
}

export type RunCheckFieldErrors = Partial<Record<RunCheckField, string>>;

export type ParsedRunCheck =
  { ok: true; body: RunVerificationCheck } | { ok: false; fieldErrors: RunCheckFieldErrors };

/**
 * Checks the form with the SAME schema the server uses, so the rules cannot drift. A bad field gets a fixed message; the typed value is
 * never part of it. On success `body` is the normalised request (PAN upper-cased, account number without spaces) that is sent.
 */
export function parseRunCheckForm(form: RunCheckForm): ParsedRunCheck {
  const parsed = RunVerificationCheckSchema.safeParse(buildBody(form));
  const mismatch = subjectIdMismatch(form);
  if (parsed.success && mismatch === null) return { ok: true, body: parsed.data };
  const fieldErrors: RunCheckFieldErrors = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === 'string' && field in FIELD_MESSAGES && !(field in fieldErrors)) {
        fieldErrors[field as RunCheckField] = FIELD_MESSAGES[field as RunCheckField](form.check);
      }
    }
  }
  // The more specific message wins: it says what to change.
  if (mismatch !== null) fieldErrors.subjectId = mismatch;
  // An issue on something that has no field (it cannot happen with the body built above) must still stop the request.
  if (Object.keys(fieldErrors).length === 0) fieldErrors.subjectId = FIELD_MESSAGES.subjectId(form.check);
  return { ok: false, fieldErrors };
}

/** The API call. The key is chosen by the caller (RunCheckSession) and is the SAME for every retry of one attempt. */
export function runVerificationCheck(
  body: RunVerificationCheck,
  idempotencyKey: string,
): Promise<VerificationRecord> {
  return apiFetch<VerificationRecord>('/v1/verifications/checks', { method: 'POST', body, idempotencyKey });
}

// ── what the answer means ──────────────────────────────────────────────────────────────────────────────────────────────────────
const REASON_WORDS: Record<string, string> = {
  ID_INVALID: 'The number is not valid.',
  NOT_FOUND: 'The provider has no record for this number.',
  PAN_NOT_VALID: 'The PAN is not valid or not active.',
  GST_NOT_ACTIVE: 'The GST registration is not active.',
  NAME_MISMATCH: 'The name does not match the name on record.',
  NAME_NOT_RETURNED: 'The provider did not return a name to compare.',
  BANK_TXN_FAILED: 'The ₹1 credit to the account failed.',
  NOT_SUPPORTED: 'The provider cannot check this account or bank.',
  OUTCOME_UNKNOWN: 'The outcome is unknown: the ₹1 may or may not have been sent.',
};

/** A reason code from the API in plain words. An unknown code is shown as lower-case words, never hidden. */
export function describeReason(code: string): string {
  return (
    REASON_WORDS[code] ??
    `Reason: ${code
      .replace(/[^A-Za-z0-9]+/g, ' ')
      .trim()
      .toLowerCase()}.`
  );
}

/** True for a bank check whose outcome is unknown: the ₹1 may or may not have been sent (the API stores it as INCONCLUSIVE). */
export function isUnknownOutcome(record: Pick<VerificationRecord, 'checkType' | 'minimalResult'>): boolean {
  return (
    record.checkType === 'BANK_ACCOUNT' &&
    (record.minimalResult.discrepancies ?? []).includes('OUTCOME_UNKNOWN')
  );
}

/** The warning for a bank check whose outcome is unknown. `evidenceRef` is the provider and case id, so the transfer can be looked up. */
export const unknownOutcomeWarning = (evidenceRef: string): string =>
  `The bank did not confirm. The ₹1 may or may not have been sent. Confirm with the provider before starting another check (case: ${evidenceRef}).`;

export const NEW_BANK_CHECK_WARNING =
  'The earlier bank check may already have sent ₹1. Start a new one only if you have confirmed with the provider that you need to. A new check sends ₹1 again.';

export interface RunCheckErrorView {
  title: string;
  message: string;
  /** True when sending the SAME request again (same key) is the right next step. False when the request has to be changed. */
  canRetry: boolean;
  correlationId?: string;
}

const view = (title: string, message: string, canRetry: boolean, err?: ApiError): RunCheckErrorView => ({
  title,
  message,
  canRetry,
  ...(err?.correlationId ? { correlationId: err.correlationId } : {}),
});

/**
 * What an error means for the person. Every message is made of fixed words: the API's own text is not shown, so nothing typed can come
 * back through it. A retry is only ever offered with the same key, which makes it safe even when the first request did arrive.
 */
export function describeRunCheckError(err: unknown): RunCheckErrorView {
  if (!(err instanceof ApiError)) {
    return view(
      'The check could not be run',
      'Something unexpected went wrong. Try again: the same request is not run twice.',
      true,
    );
  }
  if (err.httpStatus === 0) {
    return view(
      'Connection lost',
      'We cannot tell whether the request reached the server. Try again: it is sent with the same reference, so a bank check does not send the ₹1 a second time.',
      true,
      err,
    );
  }
  const issues = err.details.map((d) => d.issue);
  switch (err.code) {
    case 'VALIDATION_ERROR':
      if (issues.includes('NO_ACTIVE_CONNECTION')) {
        return view(
          'No provider is set up for this check',
          'Ask an administrator to set one up under Integrations, then run the check again.',
          false,
          err,
        );
      }
      if (issues.includes('CONSENT_PURPOSE_MISMATCH')) {
        return view(
          'This consent is for another purpose',
          'A provider check needs a consent given for verification checks. Record one for this person, then use its id.',
          false,
          err,
        );
      }
      if (issues.includes('CONSENT_SUBJECT_MISMATCH')) {
        return view(
          'This consent belongs to someone else',
          'Use the consent record given by the person the check is about.',
          false,
          err,
        );
      }
      return view('The request was not accepted', 'Check the fields and try again.', false, err);
    case 'CONSENT_REQUIRED':
      return view(
        'Consent is missing',
        'The consent record is not active or has expired. Record a new consent for verification checks first.',
        false,
        err,
      );
    case 'NOT_FOUND':
      return view(
        'Not found',
        'The customer, loan application, lead or consent record was not found. Check the ids.',
        false,
        err,
      );
    case 'FORBIDDEN':
      return view('Not allowed', 'You do not have permission to run provider checks.', false, err);
    case 'IDEMPOTENCY_KEY_REUSED':
      return view(
        'This request was already used',
        'It was sent before with different details. Start a new check.',
        false,
        err,
      );
    case 'RATE_LIMITED':
      return view(
        'The provider is busy',
        'Too many requests were sent to the provider. Wait a moment, then try again.',
        true,
        err,
      );
    case 'DEPENDENCY_UNAVAILABLE':
      return view(
        'The provider could not be reached',
        'Try again in a moment. The same request is not run twice.',
        true,
        err,
      );
    case 'INTERNAL_ERROR':
      return view(
        'The server could not complete the check',
        'Try again. If it keeps failing, contact support and quote the code below.',
        true,
        err,
      );
    default:
      return view(
        'The check could not be run',
        'Try again, or contact support and quote the code below.',
        true,
        err,
      );
  }
}
