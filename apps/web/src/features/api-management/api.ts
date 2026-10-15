// apps/web/src/features/api-management/api.ts — owner: Akash (Module 36: API Management MOD-API)
import type {
  ApiClientResponse,
  CreateApiClientInput,
  UpdateApiClientInput,
  RotateClientSecretResponse,
} from '@dsa/contracts';
import { apiFetch } from '../../api/client';

export async function listApiClients(): Promise<ApiClientResponse[]> {
  const res = await apiFetch<{ data: ApiClientResponse[] }>('/v1/api-clients');
  return res.data;
}

export async function createApiClient(input: CreateApiClientInput): Promise<ApiClientResponse> {
  return apiFetch<ApiClientResponse>('/v1/api-clients', {
    method: 'POST',
    body: input,
  });
}

export async function getApiClient(id: string): Promise<ApiClientResponse> {
  return apiFetch<ApiClientResponse>(`/v1/api-clients/${id}`);
}

export async function updateApiClient(id: string, patch: UpdateApiClientInput): Promise<ApiClientResponse> {
  return apiFetch<ApiClientResponse>(`/v1/api-clients/${id}`, {
    method: 'PATCH',
    body: patch,
  });
}

export async function deleteApiClient(id: string): Promise<void> {
  await apiFetch(`/v1/api-clients/${id}`, {
    method: 'DELETE',
  });
}

export async function rotateClientSecret(id: string): Promise<RotateClientSecretResponse> {
  return apiFetch<RotateClientSecretResponse>(`/v1/api-clients/${id}/rotate-secret`, {
    method: 'POST',
  });
}
