// apps/web/src/features/reconciliation/types.ts
export type MatchType = 'EXACT' | 'PARTIAL' | 'VARIANCE' | 'UNMATCHED' | 'DUPLICATE';
export type MatchStatus = 'ACTIVE' | 'SUPERSEDED' | 'REVOKED';

export type ExceptionClassification =
  | 'SHORT_REMITTANCE'
  | 'OVER_REMITTANCE'
  | 'MISSING_REMITTANCE'
  | 'UNMATCHED_STATEMENT_LINE'
  | 'DUPLICATE_REMITTANCE'
  | 'TIMING_DIFFERENCE';

export type ExceptionStatus = 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'WRITTEN_OFF';

export type AdjustmentType = 'WRITE_OFF' | 'CLAWBACK' | 'CORRECTION' | 'TAX' | 'MANUAL';
export type AdjustmentStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type DisputePartyType = 'LENDER' | 'CONNECTOR';
export type DisputeSubjectType = 'STATEMENT_LINE' | 'PAYOUT' | 'CALCULATION';
export type DisputeStatus = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'REJECTED' | 'WITHDRAWN';

export interface LenderStatementLine {
  id: string;
  statementId: string;
  loanAccountHash: string;
  customerNameMasked: string;
  disbursedAmount: number;
  commissionAmount: number;
  taxDeducted: number;
  paidOn: string;
  rawRowRef: string | null;
  status: 'UNMATCHED' | 'MATCHED' | 'EXCEPTION' | 'DISPUTED';
  createdAt: string;
}

export interface LenderStatement {
  id: string;
  lenderId: string;
  period: string;
  sourceFileKey: string;
  importBatchId: string;
  fileSha256: string;
  totals: {
    totalDisbursed: number;
    totalCommission: number;
    totalTaxDeducted: number;
    netCommission: number;
    lineCount: number;
  };
  status: 'IMPORTED' | 'MATCHED' | 'PARTIALLY_MATCHED' | 'RECONCILED' | 'FAILED';
  createdAt: string;
  createdBy: string;
  lines?: LenderStatementLine[];
}

export interface ReconciliationMatch {
  id: string;
  statementLineId: string;
  calculationId: string;
  matchType: MatchType;
  matchedAmount: number;
  decisionRecordId: string | null;
  status: MatchStatus;
  createdAt: string;
  createdBy: string;
}

export interface ReconciliationException {
  id: string;
  statementLineId: string | null;
  calculationId: string | null;
  varianceAmount: number;
  classification: ExceptionClassification;
  status: ExceptionStatus;
  ownerUserId: string | null;
  evidenceRef: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  createdBy: string;
}

export interface Adjustment {
  id: string;
  adjustmentType: AdjustmentType;
  type?: string;
  amount: string | number;
  reason: string;
  status: AdjustmentStatus;
  calculationId: string | null;
  payableId: string | null;
  exceptionId?: string | null;
  evidenceRef: string | null;
  journalId?: string | null;
  createdAt: string;
  createdBy: string;
  approvedAt: string | null;
  approvedBy: string | null;
}

export interface Dispute {
  id: string;
  partyType: DisputePartyType;
  partyId: string;
  subjectType: DisputeSubjectType;
  subjectId: string;
  reason: string;
  status: DisputeStatus;
  resolution: string | null;
  outcomeAdjustmentId: string | null;
  lockVersion: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}
