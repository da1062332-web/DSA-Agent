// apps/web/src/features/audit/api.ts — owner: Akash (Module 37: Audit MOD-AUD)
import type {
  AuditEvent,
  AuditChainVerificationResponse,
  EvidencePackResponse,
} from '@dsa/contracts';
import { apiFetch } from '../../api/client';

export interface AuditSearchResult {
  data: AuditEvent[];
  meta: {
    cursor?: string | null;
    hasMore: boolean;
    total?: number;
  };
}

export async function searchAuditEvents(query?: Record<string, string | number | undefined>): Promise<AuditSearchResult> {
  const cleanQuery: Record<string, string | number> = {};
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') cleanQuery[k] = v;
    }
  }
  return apiFetch<AuditSearchResult>('/v1/audit-events', { query: cleanQuery });
}

export async function getAuditEvent(id: string): Promise<AuditEvent> {
  return apiFetch<AuditEvent>(`/v1/audit-events/${id}`);
}

export async function verifyAuditChain(): Promise<AuditChainVerificationResponse> {
  return apiFetch<AuditChainVerificationResponse>('/v1/audit-chain/verification');
}

export async function sealAuditChain(): Promise<{ sealedCount: number; lastHash?: string | null }> {
  return apiFetch<{ sealedCount: number; lastHash?: string | null }>('/v1/audit-chain/seal', {
    method: 'POST',
  });
}

export async function listEvidencePacks(): Promise<EvidencePackResponse[]> {
  const res = await apiFetch<{ data: EvidencePackResponse[] }>('/v1/evidence-packs');
  return res.data;
}

export async function createEvidencePack(body: {
  entityType?: string;
  entityId?: string;
  dateFrom?: string;
  dateTo?: string;
  purpose: string;
}): Promise<EvidencePackResponse> {
  return apiFetch<EvidencePackResponse>('/v1/evidence-packs', {
    method: 'POST',
    body,
  });
}
