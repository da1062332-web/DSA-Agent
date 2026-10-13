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
