// Grievance screen rules (owner: Dev 3; DSA Notion MODULE 13). These mirror the API so the screen only offers actions the
// API accepts. The API stays the authority: it re-checks every rule and returns 409 when a rule no longer holds.

export type ComplaintStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';

export const COMPLAINT_CHANNELS = ['PHONE', 'EMAIL', 'BRANCH', 'WEB', 'LENDER', 'OTHER'] as const;
export const COMPLAINT_CATEGORIES = [
  'SERVICE',
  'PROCESS',
  'CHARGES',
  'COLLECTION',
  'DATA_PRIVACY',
  'OTHER',
] as const;

export const CHANNEL_LABELS: Record<(typeof COMPLAINT_CHANNELS)[number], string> = {
  PHONE: 'Phone',
  EMAIL: 'Email',
  BRANCH: 'Branch',
  WEB: 'Website',
  LENDER: 'Via lender',
  OTHER: 'Other',
};

export const CATEGORY_LABELS: Record<(typeof COMPLAINT_CATEGORIES)[number], string> = {
  SERVICE: 'Service',
  PROCESS: 'Process',
  CHARGES: 'Charges',
  COLLECTION: 'Collection',
  DATA_PRIVACY: 'Data and privacy',
  OTHER: 'Other',
};

/** A resolved complaint is read-only until it is reopened. */
export const isEditable = (status: ComplaintStatus) => status !== 'RESOLVED';
export const canStartWork = (status: ComplaintStatus) => status === 'OPEN';
export const canResolve = (status: ComplaintStatus) => status !== 'RESOLVED';
export const canReopen = (status: ComplaintStatus) => status === 'RESOLVED';

/** Matches the API: 10 to 2000 characters after trimming. */
export const isValidDescription = (text: string) => {
  const n = text.trim().length;
  return n >= 10 && n <= 2000;
};

/** Matches the API: resolutions carry the same length rule as descriptions. */
export const isValidResolution = (text: string) => isValidDescription(text);

/** Matches the API: a reason for reopening is 5 to 500 characters. */
export const isValidReason = (text: string) => {
  const n = text.trim().length;
  return n >= 5 && n <= 500;
};

/** Matches the API: lender references are at least 2 characters and free of identity or account numbers. */
const S3_PATTERNS = [/[A-Z]{5}[0-9]{4}[A-Z]/i, /\b\d{4}\s?\d{4}\s?\d{4}\b/, /\b\d{9,18}\b/];
export const isValidReference = (text: string) => {
  const t = text.trim();
  return t.length >= 2 && t.length <= 100 && !S3_PATTERNS.some((p) => p.test(t));
};
