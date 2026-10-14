// apps/web/src/features/sanctions/types.ts
export type RateType = 'FIXED' | 'FLOATING';
export type SanctionStatus = 'ACTIVE' | 'REVISED' | 'EXPIRED' | 'CANCELLED';
export type SanctionSource = 'MANUAL' | 'LENDER_API' | 'EMAIL_PARSED';
export type TrancheStatus = 'RECORDED' | 'VERIFIED' | 'RETURNED' | 'VOIDED';
export type TrancheDecision = 'VERIFY' | 'RETURN';

export interface Sanction {
  id: string;
  tenantId: string;
  lenderCaseId: string;
  version: number;
  amount: number;
  tenureMonths: number;
  rateValue: number;
  rateType: RateType;
  benchmarkText: string | null;
  feesText: string | null;
  conditions: string[];
  sanctionDate: string;
  validUntil: string;
  letterDocumentId: string | null;
  status: SanctionStatus;
  source: SanctionSource;
  cancelReason: string | null;
  lockVersion: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface DisbursementTranche {
  id: string;
  tenantId: string;
  sanctionId: string;
  trancheNo: number;
  amount: number;
  currency: string;
  disbursedOn: string;
  utrMasked: string | null;
  loanAccountMasked: string | null;
  evidenceDocumentId: string | null;
  status: TrancheStatus;
  recordedBy: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  verificationComment: string | null;
  exceptionApprovalId: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  replacedByTrancheId: string | null;
  lockVersion: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface RecordSanctionInput {
  amount: number;
  tenureMonths: number;
  rateValue: number;
  rateType: RateType;
  benchmarkText?: string | null;
  feesText?: string | null;
  conditions?: string[];
  sanctionDate: string;
  validUntil: string;
  letterDocumentId?: string | null;
  source?: SanctionSource;
}

export interface RecordTrancheInput {
  amount: number;
  currency?: string;
  disbursedOn: string;
  utr?: string | null;
  loanAccountNumber?: string | null;
  evidenceDocumentId?: string | null;
}

export interface VerifyTrancheInput {
  decision: TrancheDecision;
  comment?: string | null;
}

export interface ExceptionApprovalInput {
  reason: string;
}

export interface VoidTrancheInput {
  reason: string;
  createReplacement?: boolean;
  replacement?: RecordTrancheInput;
}
