export type ComplainantType = 'CUSTOMER' | 'CO_APPLICANT' | 'CONNECTOR';
export type ComplaintChannel = 'PORTAL' | 'EMAIL' | 'PHONE' | 'IN_PERSON';
export type ComplaintCategory =
  | 'DELAY_IN_DISBURSEMENT'
  | 'INCORRECT_CHARGES'
  | 'LENDER_MISCOMMUNICATION'
  | 'DOCUMENT_MISPLACEMENT'
  | 'STAFF_BEHAVIOUR'
  | 'OTHER';

export type ComplaintStatus =
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'IN_REVIEW'
  | 'REFERRED_TO_LENDER'
  | 'RESOLVED'
  | 'REOPENED'
  | 'CLOSED';

export interface Complaint {
  id: string;
  tenantId: string;
  ackRef: string;
  complainantType: ComplainantType;
  complainantId: string;
  complainantName: string;
  channel: ComplaintChannel;
  category: ComplaintCategory;
  description: string;
  status: ComplaintStatus;
  ownerId: string | null;
  dueAt: string;
  lenderReferral?: {
    lenderId: string;
    referredAt: string;
    lenderTicketRef?: string;
  } | null;
  resolution?: {
    summary: string;
    resolvedAt: string;
    resolvedBy: string;
  } | null;
  createdAt: string;
}

export interface ComplaintFormInput {
  complainantType: ComplainantType;
  complainantId: string;
  complainantName: string;
  channel: ComplaintChannel;
  category: ComplaintCategory;
  description: string;
  applicationId?: string;
}
