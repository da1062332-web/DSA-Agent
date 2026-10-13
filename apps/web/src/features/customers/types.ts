// apps/web/src/features/customers/types.ts — owner: Dev 5 (MOD-CUST)

export interface CustomerResource {
  id: string;
  tenantId: string;
  partyType: 'INDIVIDUAL' | 'ENTITY';
  fullName: string;
  homeBranchId: string;
  status: 'ACTIVE' | 'MERGED';
  lockVersion: number;
  primaryMobileMasked?: string | null;
  primaryEmailMasked?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConsentResource {
  id: string;
  tenantId: string;
  subjectType: 'CUSTOMER' | 'LEAD';
  subjectId: string;
  purpose: 'CONTACT' | 'LOAN_PROCESSING' | 'SHARE_WITH_LENDER' | 'VERIFICATION_CHECK' | 'MARKETING';
  purposeTarget: string | null;
  noticeVersion: string;
  channel: 'IN_PERSON' | 'PHONE' | 'WEB_FORM' | 'EMAIL' | 'OTP' | 'DOCUMENT';
  evidenceRef: string | null;
  capturedBy: string;
  capturedAt: string;
  status: 'ACTIVE' | 'WITHDRAWN' | 'EXPIRED';
  withdrawnAt: string | null;
  withdrawnBy: string | null;
  withdrawalReason: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface RecordConsentPayload {
  purpose: 'CONTACT' | 'LOAN_PROCESSING' | 'SHARE_WITH_LENDER' | 'VERIFICATION_CHECK' | 'MARKETING';
  purposeTarget?: string;
  noticeVersion: string;
  channel: 'IN_PERSON' | 'PHONE' | 'WEB_FORM' | 'EMAIL' | 'OTP' | 'DOCUMENT';
  evidenceRef?: string;
}
