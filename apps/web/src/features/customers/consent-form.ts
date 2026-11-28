// apps/web/src/features/customers/consent-form.ts — owner: Dev 5 (MOD-CUST web). The rules of the "Record consent" form of the consents page,
// kept out of the React file so they can be tested without a browser. P1-05 added the purpose BUREAU_PULL (guest work in the customers lane,
// review: Bhushan): a consent for ONE credit bureau, named by the purpose target.
//
// No React and no network here. Nothing typed in the form is logged; the messages built here contain fixed words only (a bureau is named
// from the fixed table of the Bureau card, never from what the person typed).
import { CREDIT_BUREAUS, type CreditBureau } from '@dsa/contracts';
import { BUREAU_LABELS } from '../verifications/bureau/credit-reports';
import type { RecordConsentPayload } from './types';

export type ConsentPurposeValue = RecordConsentPayload['purpose'];

/** The purposes the Purpose select offers, in the order shown. */
export const CONSENT_PURPOSE_OPTIONS: readonly ConsentPurposeValue[] = [
  'CONTACT',
  'LOAN_PROCESSING',
  'SHARE_WITH_LENDER',
  'VERIFICATION_CHECK',
  'MARKETING',
  'BUREAU_PULL',
];

/** What the purpose target of a purpose is: a lender, a verification agency, a credit bureau, or nothing (CONTACT, LOAN_PROCESSING, MARKETING). */
export type TargetKind = 'LENDER' | 'AGENCY' | 'BUREAU' | 'NONE';

export function targetKind(purpose: ConsentPurposeValue): TargetKind {
  switch (purpose) {
    case 'SHARE_WITH_LENDER':
      return 'LENDER';
    case 'VERIFICATION_CHECK':
      return 'AGENCY';
    case 'BUREAU_PULL':
      return 'BUREAU';
    default:
      return 'NONE';
  }
}

/** The lender the form has always pre-filled for a lender or agency target. A bureau has NO default: the person must choose. */
export const DEFAULT_LENDER_TARGET = 'LENDER_HDFC_01';

export const isBureau = (value: string): value is CreditBureau =>
  (CREDIT_BUREAUS as readonly string[]).includes(value);

export const isConsentPurpose = (value: string): value is ConsentPurposeValue =>
  (CONSENT_PURPOSE_OPTIONS as readonly string[]).includes(value);

/**
 * The target to hold after the person changes the purpose. A target belongs to ONE purpose and is never carried to another: a bureau chosen
 * for BUREAU_PULL is dropped when the purpose changes, and a lender typed for SHARE_WITH_LENDER does not stay behind for CONTACT. The one
 * carry-over that existed before is kept: a lender or agency target stays when the person moves between those two, and an empty one gets the
 * pre-filled lender.
 */
export function targetAfterPurposeChange(
  from: ConsentPurposeValue,
  to: ConsentPurposeValue,
  current: string,
): string {
  if (from === to) return current;
  const toKind = targetKind(to);
  if (toKind === 'NONE' || toKind === 'BUREAU') return '';
  const fromKind = targetKind(from);
  const carried = fromKind === 'LENDER' || fromKind === 'AGENCY' ? current : '';
  return carried || DEFAULT_LENDER_TARGET;
}

export interface ConsentFormValues {
  purpose: ConsentPurposeValue;
  purposeTarget: string;
  noticeVersion: string;
  channel: RecordConsentPayload['channel'];
  evidenceRef: string;
}

export const LENDER_OR_AGENCY_REQUIRED =
  'Target lender or agency identifier is required for this consent purpose.';
export const BUREAU_REQUIRED = 'Choose the credit bureau this consent is for.';

export type ConsentFormResult = { ok: true; payload: RecordConsentPayload } | { ok: false; error: string };

/**
 * The request for what the person filled in, or the reason it is refused before anything is sent. The purpose target is sent ONLY for a
 * purpose that takes one, and for a bureau only when it is one of the four bureaus; for any other purpose it is left out, whatever the field
 * held before.
 */
export function buildConsentPayload(form: ConsentFormValues): ConsentFormResult {
  const kind = targetKind(form.purpose);
  const target = form.purposeTarget.trim();
  if ((kind === 'LENDER' || kind === 'AGENCY') && !target)
    return { ok: false, error: LENDER_OR_AGENCY_REQUIRED };
  if (kind === 'BUREAU' && !isBureau(target)) return { ok: false, error: BUREAU_REQUIRED };
  return {
    ok: true,
    payload: {
      purpose: form.purpose,
      purposeTarget: kind === 'NONE' ? undefined : target,
      noticeVersion: form.noticeVersion.trim() || 'NV-2026.1',
      channel: form.channel,
      evidenceRef: form.evidenceRef.trim() || undefined,
    },
  };
}

// ── the deep link ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface InitialConsentForm {
  open: boolean;
  purpose: ConsentPurposeValue;
  purposeTarget: string;
}

/**
 * What the page starts with, from the address: `?record=<purpose>&bureau=<bureau>`, as the Bureau card's "Record consent" link makes it.
 * Read once when the page loads. A `record` that is not a purpose opens nothing; a `bureau` that is not one of the four bureaus (or that
 * comes with another purpose) is ignored, so the dialog opens with the bureau still to be chosen. Nothing else in the address is read.
 */
export function initialConsentForm(params: URLSearchParams): InitialConsentForm {
  const closed: InitialConsentForm = { open: false, purpose: 'CONTACT', purposeTarget: '' };
  const record = params.get('record');
  if (!record || !isConsentPurpose(record)) return closed;
  const bureau = params.get('bureau');
  const purposeTarget =
    record === 'BUREAU_PULL'
      ? bureau && isBureau(bureau)
        ? bureau
        : ''
      : targetAfterPurposeChange('CONTACT', record, '');
  return { open: true, purpose: record, purposeTarget };
}

// ── what the person is told when the server refuses ──────────────────────────────────────────────────────────────────────────────
export const ALREADY_ACTIVE =
  'This customer already has an active consent for this purpose. To record it again, withdraw the existing one first.';
export const NOT_AVAILABLE_YET =
  'This kind of consent cannot be saved on this system yet. Ask your administrator to apply the latest database update.';

interface ErrorLike {
  message?: unknown;
  code?: unknown;
  details?: unknown;
}

const hasIssue = (details: unknown, test: (d: { field?: unknown; issue?: unknown }) => boolean): boolean =>
  Array.isArray(details) &&
  details.some((d) => typeof d === 'object' && d !== null && test(d as { field?: unknown; issue?: unknown }));

/**
 * The words for a refused "Record consent". The server's own text is kept for anything not listed here.
 * - 409 INVALID_STATE with UNIQUE_VIOLATION: the customer already has an ACTIVE consent for this purpose (and target). For a bureau the
 *   message names it.
 * - 422 VALIDATION_ERROR on the purposeTarget of a BUREAU_PULL: the bureau was missing or not one of the four.
 * - 422 VALIDATION_ERROR with a database CONSTRAINT issue for a BUREAU_PULL: the database does not list the purpose yet (migration 0130 is
 *   not applied there).
 */
export function describeConsentError(err: unknown, purpose: ConsentPurposeValue, target: string): string {
  const e = (typeof err === 'object' && err !== null ? err : {}) as ErrorLike;
  const fallback =
    typeof e.message === 'string' && e.message ? e.message : 'The consent could not be recorded.';
  if (e.code === 'INVALID_STATE' && hasIssue(e.details, (d) => d.issue === 'UNIQUE_VIOLATION')) {
    return purpose === 'BUREAU_PULL' && isBureau(target)
      ? `This customer already has an active consent for ${BUREAU_LABELS[target]}. To record it again, withdraw the existing one first.`
      : ALREADY_ACTIVE;
  }
  if (e.code === 'VALIDATION_ERROR' && purpose === 'BUREAU_PULL') {
    if (hasIssue(e.details, (d) => d.field === 'purposeTarget')) return BUREAU_REQUIRED;
    if (hasIssue(e.details, (d) => d.issue === 'CONSTRAINT')) return NOT_AVAILABLE_YET;
  }
  return fallback;
}
