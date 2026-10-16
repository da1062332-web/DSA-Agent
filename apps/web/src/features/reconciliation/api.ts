// apps/web/src/features/reconciliation/api.ts
import { apiFetch } from '../../api/client';
import type {
  Adjustment,
  Dispute,
  LenderStatement,
  ReconciliationException,
  ReconciliationMatch,
} from './types';

// SUB-REC.01: Statement Ingestion
export async function importLenderStatement(data: {
  lenderId: string;
  period: string;
  sourceFileKey: string;
  importBatchId: string;
  fileSha256: string;
  lines: Array<{
    loanAccount: string;
    customerName: string;
    disbursedAmount: number;
    commissionAmount: number;
    taxDeducted?: number;
    paidOn: string;
    rawRowRef?: string;
  }>;
}): Promise<LenderStatement> {
  return apiFetch<LenderStatement>('/v1/lender-statements', {
    method: 'POST',
    body: data,
  });
}

export async function fetchLenderStatements(lenderId?: string): Promise<{ items: LenderStatement[] }> {
  return apiFetch<{ items: LenderStatement[] }>('/v1/lender-statements', {
    query: lenderId ? { lenderId } : undefined,
  });
}

export async function fetchLenderStatementById(id: string): Promise<LenderStatement> {
  return apiFetch<LenderStatement>(`/v1/lender-statements/${id}`);
}

// SUB-REC.02: Commission Matching
export async function runCommissionMatching(statementId: string): Promise<{
  matchedCount: number;
  varianceCount: number;
  unmatchedCount: number;
  matches: ReconciliationMatch[];
}> {
  return apiFetch(`/v1/lender-statements/${statementId}/match`, {
    method: 'POST',
  });
}

// SUB-REC.03: Exceptions & Adjustments
export async function fetchReconciliationExceptions(params?: {
  status?: string;
  classification?: string;
  cursor?: string;
  limit?: number;
}): Promise<{ items: ReconciliationException[]; nextCursor: string | null }> {
  return apiFetch('/v1/reconciliation-exceptions', {
    query: {
      status: params?.status,
      classification: params?.classification,
      cursor: params?.cursor,
      limit: params?.limit,
    },
  });
}

export async function resolveException(
  id: string,
  input: {
    status: 'RESOLVED' | 'WRITTEN_OFF' | 'INVESTIGATING';
    classification?: string;
    resolutionNote: string;
    evidenceRef?: string;
  },
): Promise<ReconciliationException> {
  return apiFetch<ReconciliationException>(`/v1/reconciliation-exceptions/${id}/resolution`, {
    method: 'POST',
    body: input,
  });
}

export async function proposeAdjustment(input: {
  type: string;
  amount: number;
  reason: string;
  calculationId?: string;
  payableId?: string;
  exceptionId?: string;
  evidenceRef?: string;
  journalId?: string;
}): Promise<Adjustment> {
  return apiFetch<Adjustment>('/v1/adjustments', {
    method: 'POST',
    body: input,
  });
}

export async function approveAdjustment(
  id: string,
  input: { approved: boolean; rejectionReason?: string },
): Promise<Adjustment> {
  return apiFetch<Adjustment>(`/v1/adjustments/${id}/approval`, {
    method: 'POST',
    body: input,
  });
}

export async function fetchAdjustments(): Promise<{ items: Adjustment[] }> {
  return apiFetch<{ items: Adjustment[] }>('/v1/adjustments');
}

// SUB-REC.04: Disputes
export async function createDispute(input: {
  partyType: 'LENDER' | 'CONNECTOR';
  partyId: string;
  subjectType: 'STATEMENT_LINE' | 'PAYOUT' | 'CALCULATION';
  subjectId: string;
  reason: string;
  payableIds?: string[];
}): Promise<Dispute> {
  return apiFetch<Dispute>('/v1/disputes', {
    method: 'POST',
    body: input,
  });
}

export async function updateDispute(
  id: string,
  lockVersion: number,
  input: {
    status: string;
    resolution?: string;
    outcomeAdjustmentId?: string;
    releaseHolds?: boolean;
    payableIdsToRelease?: string[];
  },
): Promise<Dispute> {
  return apiFetch<Dispute>(`/v1/disputes/${id}`, {
    method: 'PATCH',
    headers: {
      'If-Match': `"${lockVersion}"`,
    },
    body: input,
  });
}

export async function fetchDisputes(params?: {
  status?: string;
  partyType?: string;
}): Promise<{ items: Dispute[] }> {
  return apiFetch<{ items: Dispute[] }>('/v1/disputes', {
    query: {
      status: params?.status,
      partyType: params?.partyType,
    },
  });
}

export async function reconcilePayoutWithBank(
  payoutId: string,
  input: {
    bankReference: string;
    paidAmount: number;
    settlementDate: string;
  },
): Promise<{ payoutId: string; status: string; bankReference: string }> {
  return apiFetch(`/v1/reconciliation/payouts/${payoutId}/bank-reconcile`, {
    method: 'POST',
    body: input,
  });
}

// Automated Bank Statement Ingestion Engine (MT940 / CSV Feeds) (MOD-REC / TASK-418)
export async function autoIngestBankFeed(input: {
  lenderId: string;
  period: string;
  format: 'MT940' | 'CSV';
  rawFeedContent: string;
  filename?: string;
}): Promise<{
  statementId: string;
  lenderId: string;
  period: string;
  format: string;
  parsedLinesCount: number;
  totalDisbursed: number;
  totalCommission: number;
  totalTaxDeducted: number;
  netCommission: number;
  fileSha256: string;
  status: string;
  message: string;
}> {
  return apiFetch('/v1/reconciliation/auto-ingest', {
    method: 'POST',
    body: input,
  });
}

