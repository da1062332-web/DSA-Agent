import { apiFetch } from '../../api/client';
import type {
  CalculateCommissionInput,
  CommissionPlanSlab,
  CreateCommissionPlanSlabInput,
  SlabPreviewInput,
  SlabPreviewResponse,
  UpdateCommissionPlanSlabInput,
  CommissionCalculation,
  CommissionPayable,
  CommissionPlan,
  CreateClawbackInput,
  CreateCommissionPlanInput,
  CreateRecalculationProposalInput,
  RecalculationProposal,
} from './types';

export async function fetchCommissionPlans(params?: {
  lenderId?: string;
  status?: string;
  cursor?: string;
  limit?: number;
}): Promise<{ data: CommissionPlan[]; meta: { nextCursor: string | null; limit: number } }> {
  return apiFetch('/v1/commission-plans', {
    query: {
      lenderId: params?.lenderId,
      status: params?.status,
      cursor: params?.cursor,
      limit: params?.limit,
    },
  });
}

export async function createCommissionPlan(input: CreateCommissionPlanInput): Promise<CommissionPlan> {
  return apiFetch<CommissionPlan>('/v1/commission-plans', {
    method: 'POST',
    body: input,
  });
}

export async function approveCommissionPlan(
  id: string,
  version: number,
  comment?: string,
): Promise<CommissionPlan> {
  return apiFetch<CommissionPlan>(`/v1/commission-plans/${id}/approval`, {
    method: 'POST',
    version,
    body: { comment: comment ?? 'Approved by checker' },
  });
}

export async function calculateCommission(
  input: CalculateCommissionInput,
): Promise<{ calculation: CommissionCalculation; payable: CommissionPayable | null }> {
  return apiFetch('/v1/commission/calculate', {
    method: 'POST',
    body: input,
  });
}

export async function fetchCalculations(params?: {
  lenderId?: string;
  status?: string;
  cursor?: string;
  limit?: number;
}): Promise<{ data: CommissionCalculation[]; meta: { nextCursor: string | null; limit: number } }> {
  return apiFetch('/v1/commission-calculations', {
    query: {
      lenderId: params?.lenderId,
      status: params?.status,
      cursor: params?.cursor,
      limit: params?.limit,
    },
  });
}

export async function fetchPayables(params?: {
  connectorId?: string;
  state?: string;
  cursor?: string;
  limit?: number;
}): Promise<{ data: CommissionPayable[]; meta: { nextCursor: string | null; limit: number } }> {
  return apiFetch('/v1/commission-payables', {
    query: {
      connectorId: params?.connectorId,
      state: params?.state,
      cursor: params?.cursor,
      limit: params?.limit,
    },
  });
}

export async function createClawback(
  input: CreateClawbackInput,
): Promise<{ id: string; status: string; payableId: string; amount: string }> {
  return apiFetch('/v1/clawbacks', {
    method: 'POST',
    body: input,
  });
}

export async function approveClawback(id: string): Promise<{ id: string; status: string }> {
  return apiFetch(`/v1/clawbacks/${id}/approval`, {
    method: 'POST',
  });
}

export async function rejectClawback(id: string, reason?: string): Promise<{ id: string; status: string }> {
  return apiFetch(`/v1/clawbacks/${id}/rejection`, {
    method: 'POST',
    body: { reason: reason ?? 'Clawback rejected by approver' },
  });
}

export async function fetchRecalculationProposals(): Promise<{ data: RecalculationProposal[] }> {
  return apiFetch<{ data: RecalculationProposal[] }>('/v1/recalculation-proposals');
}

export async function createRecalculationProposal(
  input: CreateRecalculationProposalInput,
): Promise<RecalculationProposal> {
  return apiFetch<RecalculationProposal>('/v1/recalculation-proposals', {
    method: 'POST',
    body: input,
  });
}

export async function approveRecalculationProposal(
  id: string,
  comment?: string,
): Promise<{ proposal: RecalculationProposal; supersededCalculationsCount: number }> {
  return apiFetch(`/v1/recalculation-proposals/${id}/approval`, {
    method: 'POST',
    body: { comment: comment ?? 'Approved by checker' },
  });
}

// ============================================================
// P2-01: the lender's payout grid (commission plan slabs)
// ============================================================

export async function fetchCommissionPlanSlabs(
  planId: string,
): Promise<{ data: CommissionPlanSlab[]; meta: { nextCursor: string | null; limit: number } }> {
  return apiFetch(`/v1/commission-plans/${encodeURIComponent(planId)}/slabs`);
}

export async function createCommissionPlanSlab(
  planId: string,
  input: CreateCommissionPlanSlabInput,
): Promise<CommissionPlanSlab> {
  return apiFetch<CommissionPlanSlab>(`/v1/commission-plans/${encodeURIComponent(planId)}/slabs`, {
    method: 'POST',
    body: input,
  });
}

/** `version` is the band's lockVersion: the API sends it as an ETag and requires it back as If-Match. */
export async function updateCommissionPlanSlab(
  planId: string,
  slabId: string,
  version: number,
  input: UpdateCommissionPlanSlabInput,
): Promise<CommissionPlanSlab> {
  return apiFetch<CommissionPlanSlab>(
    `/v1/commission-plans/${encodeURIComponent(planId)}/slabs/${encodeURIComponent(slabId)}`,
    { method: 'PATCH', version, body: input },
  );
}

/** Reads nothing and writes nothing: it answers "this volume, this product, this date -> this rate". */
export async function previewCommissionSlab(
  planId: string,
  input: SlabPreviewInput,
): Promise<SlabPreviewResponse> {
  return apiFetch<SlabPreviewResponse>(
    `/v1/commission-plans/${encodeURIComponent(planId)}/slabs/preview`,
    { method: 'POST', body: input },
  );
}
