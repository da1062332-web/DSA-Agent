import { apiFetch } from '../../api/client';
import { readConfig } from '../../config';
import { getSupabase } from '../../auth/supabase';
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

export async function createPayoutRequest(
  input: CreatePayoutRequestInput,
): Promise<PayoutRequest> {
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

export async function createPayoutBatch(
  input: CreatePayoutBatchInput,
): Promise<PayoutBatch> {
  return apiFetch<PayoutBatch>('/v1/payout-batches', {
    method: 'POST',
    body: input,
  });
}

export async function downloadBankFile(batchId: string): Promise<void> {
  const config = readConfig();
  if (!config.success) throw new Error('Web configuration invalid.');
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;

  const url = `${config.data.VITE_API_BASE_URL}/v1/payout-batches/${batchId}/bank-file`;
  const res = await fetch(url, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to download bank file (${res.status})`);
  }
  const blob = await res.blob();
  const blobUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = `payout_batch_${batchId}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(blobUrl);
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

