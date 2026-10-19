// apps/web/src/features/verifications/api.ts — owner: Developer 2. Verification requests: the verifier work queue and the
// checklist attestation (/v1/verification-requests). Verification records (MOD-VER) are read by VerificationPage at /v1/verifications.
import { apiFetch } from '../../api/client';
import type {
  ChecklistAttestationInput,
  CompleteVerificationInput,
  CreateVerificationInput,
  UpdateVerificationInput,
  VerificationRequest,
} from './types';

type Page<T> = { data: T[]; meta: { limit: number; nextCursor: string | null } };
const base = '/v1/verification-requests';

export async function fetchVerifications(params?: {
  status?: string;
  verificationType?: string;
  priority?: string;
  applicationId?: string;
  branchId?: string;
  limit?: number;
  cursor?: string;
}): Promise<Page<VerificationRequest>> {
  return apiFetch<Page<VerificationRequest>>(base, { query: { ...params } });
}

export async function fetchVerification(id: string): Promise<VerificationRequest> {
  return apiFetch<VerificationRequest>(`${base}/${encodeURIComponent(id)}`);
}

export async function createVerification(input: CreateVerificationInput): Promise<VerificationRequest> {
  return apiFetch<VerificationRequest>(base, { method: 'POST', body: input });
}

export async function updateVerification(
  id: string,
  lockVersion: number,
  input: UpdateVerificationInput,
): Promise<VerificationRequest> {
  return apiFetch<VerificationRequest>(`${base}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input,
    version: lockVersion,
  });
}

export async function completeVerification(
  id: string,
  lockVersion: number,
  input: CompleteVerificationInput,
): Promise<VerificationRequest> {
  return apiFetch<VerificationRequest>(`${base}/${encodeURIComponent(id)}/complete`, {
    method: 'POST',
    body: input,
    version: lockVersion,
  });
}

export async function attestChecklistItem(
  verificationId: string,
  input: ChecklistAttestationInput,
): Promise<{ checklistItemId: string; status: string; reviewedBy: string; reviewedAt: string }> {
  return apiFetch<{ checklistItemId: string; status: string; reviewedBy: string; reviewedAt: string }>(
    `${base}/${encodeURIComponent(verificationId)}/checklist-review`,
    { method: 'POST', body: input },
  );
}
