// The partner portal's data shapes and rules, kept free of rendering so they are tested directly. The shapes are what /portal/v1 returns.
// Keep the dispute rules in step with apps/api/src/modules/finance/connector-portal.ts: the API has the final say.

export interface PortalMoney {
  amount: string;
  currency: string;
}

export interface PortalReferral {
  id: string;
  name: string;
  mobileMasked: string;
  productCategory: string;
  status: string;
  submittedAt: string;
}

export interface PortalStatementLine {
  id: string;
  amount: PortalMoney;
  state: string;
  disputed: boolean;
  createdAt: string;
}

export interface PortalStatements {
  totals: {
    expected: PortalMoney;
    approved: PortalMoney;
    paid: PortalMoney;
    held: PortalMoney;
    disputed: PortalMoney;
  };
  lines: PortalStatementLine[];
}

export interface PortalDispute {
  id: string;
  subjectType: 'STATEMENT_LINE' | 'PAYOUT';
  subjectId: string;
  category: string | null;
  status: string;
  reason: string;
  raisedAt: string;
}

/** One step of a referral's progress, as the API derives it. A step is done only when the referral has reached it; no date is invented. */
export interface PortalTimelineStep {
  key: string;
  label: string;
  done: boolean;
  current: boolean;
}

export interface PortalReferralDetail {
  id: string;
  name: string;
  mobileMasked: string;
  productCategory: string;
  status: string;
  steps: PortalTimelineStep[];
  submittedAt: string;
  lastUpdatedAt: string;
}

export type PortalDocumentStatus =
  'NOT_SUBMITTED' | 'PENDING_REVIEW' | 'ACCEPTED' | 'ACTION_REQUIRED' | 'NOT_REQUIRED';

export interface PortalDocumentItem {
  checklistItemId: string;
  documentName: string;
  allowedMime: string[];
  maxSizeBytes: number;
  status: PortalDocumentStatus;
  actionRequired: boolean;
}

export interface PortalDocumentList {
  uploadAvailable: boolean;
  unavailableReason: 'NO_APPROVED_TYPES' | 'APPLICATION_CLOSED' | 'SCANNER_UNAVAILABLE' | null;
  items: PortalDocumentItem[];
}

export const DOCUMENT_STATUS_LABEL: Record<PortalDocumentStatus, string> = {
  NOT_SUBMITTED: 'Not submitted',
  PENDING_REVIEW: 'Received, under review',
  ACCEPTED: 'Accepted',
  ACTION_REQUIRED: 'Action required: please send it again',
  NOT_REQUIRED: 'Not required',
};

/** Why uploads are not available, in words a partner can act on. Nothing internal is named. */
export const uploadUnavailableMessage = (reason: PortalDocumentList['unavailableReason']): string | null => {
  switch (reason) {
    case 'NO_APPROVED_TYPES':
      return 'Document uploads are not currently available for this referral.';
    case 'APPLICATION_CLOSED':
      return 'Documents can no longer be added to this application.';
    case 'SCANNER_UNAVAILABLE':
      return 'Document uploads are temporarily unavailable. Please try again later.';
    default:
      return null;
  }
};

export const REFERRAL_STATUS_LABEL: Record<string, string> = {
  RECEIVED: 'Received',
  IN_PROGRESS: 'In progress',
  APPLICATION: 'Application stage',
  CLOSED: 'Closed',
};

/** The partner-facing label of a referral status. Anything the API does not name shows as in progress, as the API does. */
export const referralStatusLabel = (status: string): string => REFERRAL_STATUS_LABEL[status] ?? 'In progress';

/** Lines a partner may put into a payout request: eligible or approved, and not under dispute. */
export const payableLines = (lines: PortalStatementLine[]): PortalStatementLine[] =>
  lines.filter((l) => (l.state === 'ELIGIBLE' || l.state === 'APPROVED') && !l.disputed);

/** Adds money amounts in rupees without floating-point drift (paise are whole numbers). */
export const sumMoney = (items: PortalMoney[]): number =>
  items.reduce((total, m) => total + Math.round(Number(m.amount) * 100), 0) / 100;

export const DISPUTE_CATEGORIES: Record<PortalDispute['subjectType'], { value: string; label: string }[]> = {
  STATEMENT_LINE: [
    { value: 'COMMISSION_CALCULATION', label: 'Commission calculation' },
    { value: 'OTHER', label: 'Other' },
  ],
  PAYOUT: [
    { value: 'PAYOUT', label: 'Payout' },
    { value: 'OTHER', label: 'Other' },
  ],
};

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  Object.values(DISPUTE_CATEGORIES)
    .flat()
    .map((c) => [c.value, c.label]),
);

export const disputeCategoryLabel = (category: string | null): string =>
  category ? (CATEGORY_LABEL[category] ?? category) : '—';

// The same patterns the API refuses in a dispute reason: a PAN, a 12-digit number (Aadhaar-shaped) and an account number.
const IDENTITY_OR_ACCOUNT_NUMBER = [/[A-Z]{5}[0-9]{4}[A-Z]/i, /\b\d{4}\s?\d{4}\s?\d{4}\b/, /\b\d{9,18}\b/];

/** Why a dispute reason cannot be sent, or null when it can. */
export function disputeReasonError(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 5) return 'Describe the problem in at least 5 characters.';
  if (trimmed.length > 500) return 'Keep the description to 500 characters.';
  if (IDENTITY_OR_ACCOUNT_NUMBER.some((p) => p.test(trimmed))) {
    return 'Do not include PAN, Aadhaar or account numbers.';
  }
  return null;
}
