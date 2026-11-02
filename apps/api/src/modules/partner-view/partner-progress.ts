// What a connector partner may see of a referral's progress and of its documents. Only the labels listed here are shown, and an internal
// state with no approved label shows as the generic label. Application and lender states are recorded below with their proposed labels,
// and none is visible to partners until its mapping is approved (docs/CONNECTOR_PHASE1_CONTRACT.md, section B).
import type { LeadState } from '../crm/leads/types';

/** The partner status of a referral, from its lead state. Approved since the first portal release. */
export type PartnerLeadStatus = 'RECEIVED' | 'IN_PROGRESS' | 'APPLICATION' | 'CLOSED';

export const PARTNER_LEAD_STATUS: Record<LeadState, PartnerLeadStatus> = {
  NEW: 'RECEIVED',
  CONTACT_ATTEMPTED: 'IN_PROGRESS',
  IN_PROGRESS: 'IN_PROGRESS',
  QUALIFIED: 'IN_PROGRESS',
  CONVERTED: 'APPLICATION',
  DISQUALIFIED: 'CLOSED',
  NOT_CONTACTABLE: 'CLOSED',
  MERGED: 'CLOSED',
  ARCHIVED: 'CLOSED',
};

/** A partner status this module does not name is shown as in progress, the same generic label the portal has always used. */
export const partnerLeadStatus = (leadState: string): PartnerLeadStatus =>
  (PARTNER_LEAD_STATUS as Record<string, PartnerLeadStatus | undefined>)[leadState] ?? 'IN_PROGRESS';

export interface PartnerTimelineStep {
  key: 'SUBMITTED' | 'UNDER_REVIEW' | 'APPLICATION' | 'CLOSED';
  label: string;
  done: boolean;
  current: boolean;
}

const STEP_LABEL: Record<PartnerTimelineStep['key'], string> = {
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  APPLICATION: 'Application stage',
  CLOSED: 'Closed',
};

/**
 * The steps a partner sees for a referral. Every step is derived from the partner status, and no date is invented: a step is done only
 * when the referral has reached it. A closed referral shows Submitted and then Closed.
 */
const STEPS_FOR: Record<PartnerLeadStatus, PartnerTimelineStep['key'][]> = {
  RECEIVED: ['SUBMITTED'],
  IN_PROGRESS: ['SUBMITTED', 'UNDER_REVIEW'],
  APPLICATION: ['SUBMITTED', 'UNDER_REVIEW', 'APPLICATION'],
  CLOSED: ['SUBMITTED', 'CLOSED'],
};

export function partnerTimeline(status: PartnerLeadStatus): PartnerTimelineStep[] {
  const shown = STEPS_FOR[status];
  const current = shown[shown.length - 1]!;
  return shown.map((key) => ({
    key,
    label: STEP_LABEL[key],
    done: key !== current,
    current: key === current,
  }));
}

/**
 * The partner label for a document checklist item. Document review states are not application states, so they are mapped here.
 * `PENDING_REVIEW` is the one label beyond the upload states the partner screens name (it is a document already received, awaiting staff).
 */
export type PartnerDocumentStatus =
  'NOT_SUBMITTED' | 'PENDING_REVIEW' | 'ACCEPTED' | 'ACTION_REQUIRED' | 'NOT_REQUIRED';

export const PARTNER_DOCUMENT_STATUS: Record<string, PartnerDocumentStatus> = {
  PENDING: 'NOT_SUBMITTED',
  SUBMITTED: 'PENDING_REVIEW',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'ACTION_REQUIRED',
  EXPIRED: 'ACTION_REQUIRED',
  WAIVED: 'NOT_REQUIRED',
  NOT_APPLICABLE: 'NOT_REQUIRED',
};

export const partnerDocumentStatus = (checklistStatus: string): PartnerDocumentStatus =>
  PARTNER_DOCUMENT_STATUS[checklistStatus] ?? 'NOT_SUBMITTED';

/**
 * Application and lender states, recorded with the label proposed for each. Every entry is `visibleToPartner: false` until its label is
 * approved. The code reads this record only to document and test the rule; it never shows an entry to a partner.
 */
export const APPLICATION_STATE_VIEW: { state: string; proposedLabel: string; visibleToPartner: false }[] = [
  { state: 'DRAFT', proposedLabel: 'Application processing', visibleToPartner: false },
  { state: 'DOCUMENTS_PENDING', proposedLabel: 'Documents required', visibleToPartner: false },
  { state: 'UNDER_REVIEW', proposedLabel: 'Under review', visibleToPartner: false },
  { state: 'READY_FOR_SUBMISSION', proposedLabel: 'Application processing', visibleToPartner: false },
  { state: 'SUBMITTED', proposedLabel: 'Submitted to lender', visibleToPartner: false },
  { state: 'SANCTIONED', proposedLabel: 'Approved', visibleToPartner: false },
  { state: 'PARTIALLY_DISBURSED', proposedLabel: 'Disbursed', visibleToPartner: false },
  { state: 'DISBURSED', proposedLabel: 'Disbursed', visibleToPartner: false },
  { state: 'CLOSED', proposedLabel: 'Closed', visibleToPartner: false },
  { state: 'REJECTED', proposedLabel: 'Closed', visibleToPartner: false },
  { state: 'WITHDRAWN', proposedLabel: 'Closed', visibleToPartner: false },
  { state: 'CANCELLED', proposedLabel: 'Closed', visibleToPartner: false },
];

export const LENDER_STATE_VIEW: { state: string; proposedLabel: string; visibleToPartner: false }[] = [
  { state: 'DRAFT', proposedLabel: 'Submitted to lender', visibleToPartner: false },
  { state: 'PACKAGE_READY', proposedLabel: 'Submitted to lender', visibleToPartner: false },
  { state: 'SUBMITTED', proposedLabel: 'Lender review', visibleToPartner: false },
  { state: 'UNDER_PROCESSING', proposedLabel: 'Lender review', visibleToPartner: false },
  { state: 'QUERY_RAISED', proposedLabel: 'Action required', visibleToPartner: false },
  { state: 'QUERY_RESPONDED', proposedLabel: 'Lender review', visibleToPartner: false },
  { state: 'SANCTIONED', proposedLabel: 'Approved', visibleToPartner: false },
  { state: 'REJECTED', proposedLabel: 'Closed', visibleToPartner: false },
  { state: 'WITHDRAWN', proposedLabel: 'Closed', visibleToPartner: false },
  { state: 'SANCTION_EXPIRED', proposedLabel: 'Closed', visibleToPartner: false },
  { state: 'SANCTION_CANCELLED', proposedLabel: 'Closed', visibleToPartner: false },
  { state: 'PARTIALLY_DISBURSED', proposedLabel: 'Disbursed', visibleToPartner: false },
  { state: 'DISBURSED', proposedLabel: 'Disbursed', visibleToPartner: false },
  { state: 'CLOSED', proposedLabel: 'Closed', visibleToPartner: false },
];
