import { apiDownload, apiFetch } from '../../api/client';
import type {
  ApprovePayoutRequestInput,
  CreatePayoutBatchInput,
  CreatePayoutRequestInput,
  PayoutBatch,
  PayoutRequest,
  RecordPayoutFailureInput,
  RecordPayoutPaymentInput,
} from './types';

export async function fetchPayoutRequests(params?: {
  connectorId?: string;
  status?: string;
  cursor?: string;
  limit?: number;
}): Promise<{ data: PayoutRequest[]; meta: { nextCursor: string | null; limit: number } }> {
  return apiFetch('/v1/payout-requests', {
    query: {
      connectorId: params?.connectorId,
      status: params?.status,
      cursor: params?.cursor,
      limit: params?.limit,
    },
  });
}

export async function fetchPayoutRequestById(id: string): Promise<PayoutRequest> {
  return apiFetch<PayoutRequest>(`/v1/payout-requests/${id}`);
}

export async function createPayoutRequest(input: CreatePayoutRequestInput): Promise<PayoutRequest> {
  return apiFetch<PayoutRequest>('/v1/payout-requests', {
    method: 'POST',
    body: input,
  });
}

export async function approvePayoutRequest(
  id: string,
  input: ApprovePayoutRequestInput,
): Promise<{ id: string; status: string; total: string; lineCount: number }> {
  return apiFetch(`/v1/payout-requests/${id}/approval`, {
    method: 'POST',
    body: input,
  });
}

export async function cancelPayoutRequest(
  id: string,
  reason?: string,
): Promise<{ id: string; status: string }> {
  return apiFetch(`/v1/payout-requests/${id}/cancel`, {
    method: 'POST',
    body: { reason: reason ?? 'Cancelled by user' },
  });
}

export async function recordPayoutPayment(
  id: string,
  input: RecordPayoutPaymentInput,
): Promise<PayoutRequest> {
  return apiFetch<PayoutRequest>(`/v1/payout-requests/${id}/payment`, {
    method: 'POST',
    body: input,
  });
}

export async function recordPayoutFailure(
  id: string,
  input: RecordPayoutFailureInput,
): Promise<PayoutRequest> {
  return apiFetch<PayoutRequest>(`/v1/payout-requests/${id}/payment-failure`, {
    method: 'POST',
    body: input,
  });
}

export async function createPayoutBatch(input: CreatePayoutBatchInput): Promise<PayoutBatch> {
  return apiFetch<PayoutBatch>('/v1/payout-batches', {
    method: 'POST',
    body: input,
  });
}

export async function downloadBankFile(batchId: string): Promise<void> {
  await apiDownload(`/v1/payout-batches/${encodeURIComponent(batchId)}/bank-file`, `payout_batch_${batchId}.csv`);
}

// Automated Direct Net-Banking / Payment Gateway Integration (MOD-PAY / TASK-418)
export async function disbursePayoutGateway(
  id: string,
  mode: 'IMPS' | 'NEFT' | 'RTGS' = 'IMPS',
): Promise<{ payoutId: string; status: string; transferId: string; utrNumber: string; disbursedAt: string }> {
  return apiFetch(`/v1/payout-requests/${id}/disburse-gateway`, {
    method: 'POST',
    body: { mode },
  });
}

export async function dispatchPayoutBatchGateway(
  batchId: string,
  mode: 'IMPS' | 'NEFT' | 'RTGS' = 'IMPS',
): Promise<{ batchId: string; totalDisbursed: number; results: any[] }> {
  return apiFetch(`/v1/payout-batches/${batchId}/dispatch-gateway`, {
    method: 'POST',
    body: { mode },
  });
}
