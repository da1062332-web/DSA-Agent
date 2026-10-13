export interface LeadResource {
  id: string;
  fullName: string;
  mobileMasked: string;
  emailMasked: string | null;
  productCategory: string;
  indicativeAmount: { amount: string; currency: string } | null;
  pincode: string | null;
  source: string;
  subSource: string | null;
  campaign: string | null;
  utm: Record<string, unknown> | null;
  connectorId: string | null;
  referredAt: string | null;
  state: 'NEW' | 'CONTACT_ATTEMPTED' | 'IN_PROGRESS' | 'QUALIFIED' | 'CONVERTED' | 'DISQUALIFIED' | 'NOT_CONTACTABLE' | 'MERGED' | 'ARCHIVED';
  subStageId: string | null;
  ownerUserId: string | null;
  ownerQueueId: string | null;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  customerId: string | null;
  mergedIntoId: string | null;
  duplicateFlag: 'NONE' | 'POSSIBLE' | 'EXACT' | 'ATTRIBUTION_CONFLICT';
  tags: string[];
  nextFollowUpAt: string | null;
  contactAttempts: number;
  qualMonthlyIncome: string | null;
  qualApplicantType: string | null;
  qualRequestedAmount: { amount: string; currency: string } | null;
  disqualificationReason: string | null;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface LeadListResponse {
  data: LeadResource[];
  meta: {
    nextCursor: string | null;
    limit: number;
  };
}

export interface CreateLeadPayload {
  fullName: string;
  mobile: string;
  email?: string | null;
  productCategory: string;
  indicativeAmount?: { amount: string; currency: string } | null;
  pincode?: string | null;
  branchId: string;
  source: string;
  subSource?: string | null;
  campaign?: string | null;
  connectorId?: string | null;
  priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  consent: {
    purpose: string;
    noticeVersion: string;
    channel: string;
    evidenceRef?: string | null;
  };
}

export interface ConversionResponse {
  leadId: string;
  customerId: string;
  customerNumber: string;
  applicationId: string;
  applicationNumber: string;
  convertedAt: string;
}
