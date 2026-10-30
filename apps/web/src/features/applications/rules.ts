// Application screen rules (owner: Dev 3; DSA Notion MODULE 16). These mirror the API so the screen only offers actions the
// API accepts. The API stays the authority: it re-checks every rule and returns 409 when a rule no longer holds.

export type ApplicationStatus =
  | 'DRAFT'
  | 'DOCUMENTS_PENDING'
  | 'UNDER_REVIEW'
  | 'READY_FOR_SUBMISSION'
  | 'SUBMITTED'
  | 'SANCTIONED'
  | 'PARTIALLY_DISBURSED'
  | 'DISBURSED'
  | 'CLOSED'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'CANCELLED';

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  'DRAFT',
  'DOCUMENTS_PENDING',
  'UNDER_REVIEW',
  'READY_FOR_SUBMISSION',
  'SUBMITTED',
  'SANCTIONED',
  'PARTIALLY_DISBURSED',
  'DISBURSED',
  'CLOSED',
  'REJECTED',
  'WITHDRAWN',
  'CANCELLED',
];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  DRAFT: 'Draft',
  DOCUMENTS_PENDING: 'Documents pending',
  UNDER_REVIEW: 'Under review',
  READY_FOR_SUBMISSION: 'Ready for submission',
  SUBMITTED: 'Submitted',
  SANCTIONED: 'Sanctioned',
  PARTIALLY_DISBURSED: 'Partly disbursed',
  DISBURSED: 'Disbursed',
  CLOSED: 'Closed',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
  CANCELLED: 'Cancelled',
};

/** Terminal applications take no edit and no hold (API-APP-004 and API-APP-010). */
export const TERMINAL: ApplicationStatus[] = ['CLOSED', 'REJECTED', 'WITHDRAWN', 'CANCELLED'];
/** Applicant details may be edited only before underwriting starts (assumption, confirm with the spec owner). */
export const EDITABLE: ApplicationStatus[] = ['DRAFT', 'DOCUMENTS_PENDING'];

/** T-APP-07: a disbursed or terminal file can be closed (application.close); a closed file cannot be reopened. */
export const CLOSABLE: ApplicationStatus[] = ['DISBURSED', 'REJECTED', 'WITHDRAWN', 'CANCELLED'];
/** Same rule as the API for a rework (T-APP-03) or send back (T-APP-05) reason: 5 to 200 characters. */
export const isValidTransitionReason = (reason: string) => {
  const t = reason.trim();
  return t.length >= 5 && t.length <= 200;
};

export const canEditDetails = (status: ApplicationStatus) => EDITABLE.includes(status);
export const canHold = (status: ApplicationStatus) => !TERMINAL.includes(status);

/** Same rule as the API: a hold needs a reason of 3 to 200 characters. */
export const isValidHoldReason = (reason: string) => {
  const t = reason.trim();
  return t.length >= 3 && t.length <= 200;
};

/** Money as the API takes it: a decimal string, up to two places, greater than zero. */
export const isValidAmount = (v: string) => /^\d{1,16}(\.\d{1,2})?$/.test(v.trim()) && Number(v) > 0;

export const isValidTenure = (v: string) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 480;
};

// ---- Parties, owners, archive and legal hold (API-APP-006, API-APP-011, API-DOC-009, API-PRV-004) ----

/** Parties change only before the application is with a lender (API: PARTY_EDITABLE_STATUSES). */
export const PARTY_EDITABLE: ApplicationStatus[] = ['DRAFT', 'DOCUMENTS_PENDING', 'UNDER_REVIEW'];
export const canChangeParties = (status: ApplicationStatus) => PARTY_EDITABLE.includes(status);

export interface PartyView {
  role: 'PRIMARY' | 'CO_APPLICANT' | 'GUARANTOR';
  removedAt: string | null;
}
/** The primary applicant stays; a party already removed has nothing left to remove. */
export const canRemoveParty = (p: PartyView) => p.role !== 'PRIMARY' && p.removedAt === null;

/** Owners can be reassigned until the application is closed (API: refused for terminal statuses). */
export const canAssignOwners = (status: ApplicationStatus) => !TERMINAL.includes(status);

/** Same rule as the API: a reassignment needs a reason of 3 to 200 characters. */
export const isValidAssignmentReason = (reason: string) => {
  const t = reason.trim();
  return t.length >= 3 && t.length <= 200;
};

/** Same rule as the API: a legal hold needs a reason of 5 to 1000 characters. */
export const isValidLegalHoldReason = (reason: string) => {
  const t = reason.trim();
  return t.length >= 5 && t.length <= 1000;
};

/** Free text must not carry a PAN, an Aadhaar number or an account number (the API refuses them with 422). */
export const hasRestrictedNumber = (text: string) =>
  /\b[A-Z]{5}[0-9]{4}[A-Z]\b/i.test(text) ||
  /\b\d{4}\s?\d{4}\s?\d{4}\b/.test(text) ||
  /\b\d{9,18}\b/.test(text);

// ---- New application (API-APP-001) ----
export const PRODUCT_CATEGORIES = ['PL', 'BL', 'MSME', 'LAP', 'HL', 'VL', 'GL', 'EL', 'OTHER'] as const;

export interface NewApplicationInput {
  customerId: string | null;
  branchId: string | null;
  amount: string;
  tenure: string;
}
/** What is still missing before a new application can be opened, or null when it is ready. */
export function newApplicationProblem(input: NewApplicationInput): string | null {
  if (!input.customerId) return 'Choose the customer.';
  if (!input.branchId) return 'Choose the branch.';
  if (!isValidAmount(input.amount)) return 'Enter the requested amount, for example 300000.00.';
  if (input.tenure !== '' && !isValidTenure(input.tenure))
    return 'Tenure is a whole number of months from 1 to 480.';
  return null;
}
