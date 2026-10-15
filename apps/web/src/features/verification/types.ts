// apps/web/src/features/verification/types.ts — owner: Developer 2 (Module 19: Verification)

export type VerificationType =
  | 'DOCUMENT_REVIEW'
  | 'IDENTITY_KYC'
  | 'RESIDENCE_FI'
  | 'OFFICE_FI'
  | 'EMPLOYMENT'
  | 'BANK_STATEMENT';

export type VerificationStatus =
  | 'INITIATED'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'VERIFIED'
  | 'REJECTED'
  | 'WAIVED'
  | 'CANCELLED';

export type VerificationOutcome =
  | 'POSITIVE'
  | 'NEGATIVE'
  | 'REFER_TO_CREDIT'
  | 'WAIVED';

export type VerificationPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export type RejectionReason =
  | 'ADDRESS_NOT_FOUND'
  | 'APPLICANT_UNKNOWN'
  | 'DOCUMENT_FORGED'
  | 'SALARY_MISMATCH'
  | 'BUSINESS_CLOSED'
  | 'UNCOOPERATIVE'
  | 'INCOMPLETE_DETAILS'
  | 'OTHER';

export interface VerificationRequest {
  id: string;
  tenantId: string;
  applicationId: string;
  partyId?: string | null;
  customerId?: string | null;
  verificationType: VerificationType;
  status: VerificationStatus;
  outcome?: VerificationOutcome | null;
  assignedToUserId?: string | null;
  assignedToQueueId?: string | null;
  branchId: string;
  priority: VerificationPriority;
  scheduledAt?: string | null;
  completedAt?: string | null;
  verifiedBy?: string | null;
  findingsSummary?: string | null;
  rejectionReason?: RejectionReason | null;
  checklistItmIds: string[];
  lockVersion: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface CreateVerificationInput {
  applicationId: string;
  partyId?: string;
  customerId?: string;
  verificationType: VerificationType;
  branchId: string;
  priority?: VerificationPriority;
  assignedToUserId?: string;
  assignedToQueueId?: string;
  scheduledAt?: string;
  findingsSummary?: string;
  checklistItmIds?: string[];
}

export interface UpdateVerificationInput {
  status?: VerificationStatus;
  priority?: VerificationPriority;
  assignedToUserId?: string | null;
  assignedToQueueId?: string | null;
  scheduledAt?: string | null;
  findingsSummary?: string;
}

export interface CompleteVerificationInput {
  outcome: VerificationOutcome;
  findingsSummary: string;
  markStatus: 'VERIFIED' | 'REJECTED' | 'WAIVED';
  rejectionReason?: RejectionReason;
}

export interface ChecklistAttestationInput {
  checklistItemId: string;
  status: 'ACCEPTED' | 'REJECTED' | 'WAIVED';
  attestationNote?: string;
  rejectReason?: 'ILLEGIBLE' | 'EXPIRED_DOCUMENT' | 'MISMATCH' | 'INCOMPLETE' | 'WRONG_DOCUMENT' | 'OTHER';
}
