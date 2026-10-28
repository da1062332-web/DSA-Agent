// Pure helpers for the document checklist screens (owner: Dev 3, MOD-DOC checklist slice). Kept apart so the rules can be tested.
export type ChecklistStatus =
  'PENDING' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | 'WAIVED' | 'NOT_APPLICABLE' | 'EXPIRED';

export interface ChecklistItem {
  id: string;
  applicationId: string;
  partyId: string;
  documentTypeCode: string;
  ordinal: number;
  mandatory: boolean;
  requiredCount: number;
  periodMonths: number | null;
  status: ChecklistStatus;
  rejectReason: string | null;
  attestationNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  documentId: string | null;
  sourceDecisionId: string;
  version: number;
}

export interface ChecklistSummary {
  total: number;
  mandatory: number;
  outstandingMandatory: number;
  accepted: number;
  rejected: number;
  expired: number;
  complete: boolean;
}

export interface ChecklistResponse {
  data: ChecklistItem[];
  summary: ChecklistSummary;
}

export const STATUS_LABELS: Record<ChecklistStatus, string> = {
  PENDING: 'Waiting for the customer',
  SUBMITTED: 'Received, waiting for review',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  WAIVED: 'Waived',
  NOT_APPLICABLE: 'Not applicable',
  EXPIRED: 'Expired',
};

export type Tone = 'default' | 'success' | 'warning' | 'error' | 'info';
export const statusTone = (s: ChecklistStatus): Tone =>
  s === 'ACCEPTED'
    ? 'success'
    : s === 'REJECTED' || s === 'EXPIRED'
      ? 'error'
      : s === 'SUBMITTED'
        ? 'info'
        : s === 'PENDING'
          ? 'warning'
          : 'default';

/** What the next person should do about an item, shown beside it. */
export function nextAction(item: Pick<ChecklistItem, 'status'>): string | null {
  switch (item.status) {
    case 'PENDING':
      return 'Upload it here, or ask the customer through Document sharing.';
    case 'SUBMITTED':
      return 'A verifier reviews it (Review).';
    case 'REJECTED':
      return 'Upload a new version, or ask the customer to send it again.';
    case 'EXPIRED':
      return 'Upload a current copy, or ask the customer for one.';
    default:
      return null;
  }
}

const DOCUMENT_LABELS: Record<string, string> = {
  AADHAAR_MASKED: 'Aadhaar card',
  PAN_CARD: 'PAN card',
  SALARY_SLIP: 'Salary slip',
  BANK_STATEMENT: 'Bank statement',
};

export const readable = (code: string) =>
  DOCUMENT_LABELS[code] ??
  code
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());

/** Items grouped by applicant, in a stable order, so each applicant reads as one block. */
export function groupByParty(items: ChecklistItem[]): { partyId: string; items: ChecklistItem[] }[] {
  const map = new Map<string, ChecklistItem[]>();
  for (const i of items) map.set(i.partyId, [...(map.get(i.partyId) ?? []), i]);
  return [...map].map(([partyId, list]) => ({
    partyId,
    items: [...list].sort(
      (a, b) => a.documentTypeCode.localeCompare(b.documentTypeCode) || a.ordinal - b.ordinal,
    ),
  }));
}

/**
 * Which document actions a checklist row offers (SUB-DOC.03, .05, .07 and API-APP-009). The item's status decides which actions make
 * sense, and the permission each endpoint checks decides whether this user is offered it; the API refuses the request either way.
 */
export interface ItemActions {
  upload: boolean; // API-DOC-001/002, document.upload; a new upload becomes the next version
  view: boolean; // API-DOC-003/004, document.view
  download: boolean; // API-DOC-003/005, document.download; the file is saved, and the access is logged
  review: boolean; // API-DOC-006, document.review; only a received file waits for review
  waive: boolean; // API-APP-009, document.waive
}

const CLOSED: ChecklistStatus[] = ['ACCEPTED', 'WAIVED', 'NOT_APPLICABLE'];

export function itemActions(
  item: Pick<ChecklistItem, 'status' | 'documentId'>,
  can: (code: string) => boolean,
): ItemActions {
  return {
    upload: !CLOSED.includes(item.status) && can('document.upload'),
    view: !!item.documentId && can('document.view'),
    download: !!item.documentId && can('document.download'),
    review: item.status === 'SUBMITTED' && !!item.documentId && can('document.review'),
    waive: !CLOSED.includes(item.status) && can('document.waive'),
  };
}

export function progressText(s: ChecklistSummary): string {
  if (s.total === 0) return 'No documents have been requested for this application yet.';
  if (s.complete) return 'Every required document is accepted, waived or not applicable.';
  return `${s.outstandingMandatory} of ${s.mandatory} required document${s.mandatory === 1 ? '' : 's'} still outstanding.`;
}

// ---- Document types (API-DOC-007 / API-DOC-008) ----
export interface DocumentTypeDraft {
  code: string;
  name: string;
  allowedMime: string[];
  maxSizeMb: string;
  validityMonths: string;
  instructions: string;
}

/** The first problem with a document type form, matching UpsertDocumentTypeSchema, or null when it can be saved. */
export function documentTypeProblem(d: DocumentTypeDraft): string | null {
  if (!/^[A-Z_]{2,40}$/.test(d.code))
    return 'The code is 2 to 40 upper-case letters or underscores, for example GST_RETURN.';
  const name = d.name.trim();
  if (name.length < 2 || name.length > 120) return 'The name is 2 to 120 characters.';
  if (d.allowedMime.length === 0) return 'Allow at least one file type.';
  const mb = Number(d.maxSizeMb);
  if (!d.maxSizeMb.trim() || !Number.isFinite(mb) || mb * 1_048_576 < 1024 || mb > 50)
    return 'The largest file is between 0.001 and 50 MB.';
  if (d.validityMonths.trim() !== '' && !/^(?:[1-9]\d?|1[01]\d|120)$/.test(d.validityMonths.trim()))
    return 'Validity is a whole number of months from 1 to 120, or blank when the document does not expire.';
  if (d.instructions.length > 1000) return 'Instructions are at most 1000 characters.';
  return null;
}
