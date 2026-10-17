// apps/web/src/features/sanctions/api.ts
import type {
  DisbursementTranche,
  ExceptionApprovalInput,
  RecordSanctionInput,
  RecordTrancheInput,
  Sanction,
  VerifyTrancheInput,
  VoidTrancheInput,
} from './types';
import { getStoredAuthToken } from '../../auth/token';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string) || '';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');

  const token =
    getStoredAuthToken() || (typeof localStorage !== 'undefined' ? localStorage.getItem('dsa_token') : null);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let errBody: any;
    try {
      errBody = await res.json();
    } catch {
      errBody = { error: { code: 'UNKNOWN_ERROR', message: res.statusText } };
    }
    const err = new Error(errBody?.error?.message ?? `Request failed with status ${res.status}`);
    (err as any).code = errBody?.error?.code ?? 'HTTP_ERROR';
    (err as any).status = res.status;
    (err as any).details = errBody?.error?.details;
    throw err;
  }

  return res.json();
}

export const sanctionsApi = {
  async recordSanction(lenderCaseId: string, input: RecordSanctionInput): Promise<Sanction> {
    return request<Sanction>(`/v1/lender-cases/${lenderCaseId}/sanctions`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async listSanctions(lenderCaseId: string): Promise<{ data: Sanction[] }> {
    return request<{ data: Sanction[] }>(`/v1/lender-cases/${lenderCaseId}/sanctions`);
  },

  async listAllSanctions(params?: { status?: string }): Promise<{ data: Sanction[] }> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    const qStr = query.toString();
    return request<{ data: Sanction[] }>(`/v1/sanctions${qStr ? `?${qStr}` : ''}`);
  },

  async listAllTranches(params?: { status?: string }): Promise<{ data: DisbursementTranche[] }> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    const qStr = query.toString();
    return request<{ data: DisbursementTranche[] }>(`/v1/disbursements${qStr ? `?${qStr}` : ''}`);
  },

  async getSanction(id: string): Promise<Sanction> {
    return request<Sanction>(`/v1/sanctions/${id}`);
  },

  async cancelSanction(id: string, reason: string): Promise<Sanction> {
    return request<Sanction>(`/v1/sanctions/${id}/cancellation`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async recordTranche(
    sanctionId: string,
    input: RecordTrancheInput,
  ): Promise<{ tranche: DisbursementTranche; remainingSanctionAmount: number }> {
    return request<{ tranche: DisbursementTranche; remainingSanctionAmount: number }>(
      `/v1/sanctions/${sanctionId}/tranches`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );
  },

  async listTranches(sanctionId: string): Promise<{ data: DisbursementTranche[] }> {
    return request<{ data: DisbursementTranche[] }>(`/v1/sanctions/${sanctionId}/tranches`);
  },

  async getTranche(id: string): Promise<DisbursementTranche> {
    return request<DisbursementTranche>(`/v1/tranches/${id}`);
  },

  async verifyTranche(trancheId: string, input: VerifyTrancheInput): Promise<DisbursementTranche> {
    return request<DisbursementTranche>(`/v1/tranches/${trancheId}/verification`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async approveException(trancheId: string, input: ExceptionApprovalInput): Promise<DisbursementTranche> {
    return request<DisbursementTranche>(`/v1/tranches/${trancheId}/exception-approval`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async voidTranche(
    trancheId: string,
    input: VoidTrancheInput,
  ): Promise<{ voidedTranche: DisbursementTranche; replacementTranche?: DisbursementTranche }> {
    return request<{ voidedTranche: DisbursementTranche; replacementTranche?: DisbursementTranche }>(
      `/v1/tranches/${trancheId}/void`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );
  },
};
