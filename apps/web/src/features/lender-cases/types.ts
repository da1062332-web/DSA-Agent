// apps/web/src/features/lender-cases/types.ts — owner: Dev 4 (MOD-LCS Frontend Types)
export type LenderCaseStatus =
  | 'DRAFT'
  | 'PACKAGE_READY'
  | 'SUBMITTED'
  | 'UNDER_PROCESSING'
  | 'QUERY_RAISED'
  | 'QUERY_RESPONDED'
  | 'SANCTIONED'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'SANCTION_EXPIRED'
  | 'SANCTION_CANCELLED'
  | 'PARTIALLY_DISBURSED'
  | 'DISBURSED'
  | 'CLOSED';

export type SubmissionChannel = 'PORTAL' | 'EMAIL' | 'API' | 'PHYSICAL';

export type StatusSource = 'MANUAL' | 'LENDER_API' | 'LENDER_FILE' | 'EMAIL_PARSED' | 'SYSTEM';

export type DeclineReasonCode =
  'POLICY' | 'INCOME' | 'CREDIT_HISTORY' | 'DOCUMENTATION' | 'LOCATION' | 'CUSTOMER_DECLINED' | 'OTHER';

export type PackageKind = 'SUBMISSION' | 'QUERY_RESPONSE';

export interface LenderCaseResource {
  id: string;
  tenantId: string;
  applicationId: string;
  lenderId: string;
  productVersionId: string;
  empanelmentId: string;
  attemptNo: number;
  status: LenderCaseStatus;
  lenderReference?: string | null;
  submissionChannel?: SubmissionChannel | null;
  submittedAt?: string | null;
  packageId?: string | null;
  statusSource?: StatusSource | null;
  lastStatusAt?: string | null;
  declineReasonCode?: DeclineReasonCode | null;
  stalenessFlag: boolean;
  tags: string[];
  lockVersion: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface SubmissionPackageResource {
  id: string;
  tenantId: string;
  lenderCaseId: string;
  kind: PackageKind;
  manifest: Record<string, unknown>;
  manifestSha256: string;
  consentIds: string[];
  builtBy: string;
  builtAt: string;
  frozenAt?: string | null;
}

export interface LenderQueryResource {
  id: string;
  tenantId: string;
  lenderCaseId: string;
  text: string;
  requestedItems: string[];
  lenderDueDate?: string | null;
  taskId?: string | null;
  responseManifestId?: string | null;
  respondedAt?: string | null;
  createdAt: string;
  createdBy: string;
}

export interface CreateLenderCasePayload {
  lenderId: string;
  productVersionId: string;
  empanelmentId: string;
  tags?: string[];
}

export interface BuildPackagePayload {
  kind?: PackageKind;
  waivers?: string[];
  freeze?: boolean;
}

export interface SubmitLenderCasePayload {
  channel: SubmissionChannel;
  lenderReference?: string;
  submittedAt?: string;
}

export interface UpdateLenderCaseStatusPayload {
  toStatus: LenderCaseStatus;
  statusSource?: StatusSource;
  declineReasonCode?: DeclineReasonCode;
  reasonText?: string;
  lenderReference?: string;
}

export interface RecordLenderQueryPayload {
  text: string;
  requestedItems?: string[];
  lenderDueDate?: string;
}

export interface RecordQueryResponsePayload {
  text: string;
  documentReferences?: string[];
}
