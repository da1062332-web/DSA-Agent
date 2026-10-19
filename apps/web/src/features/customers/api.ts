// apps/web/src/features/customers/api.ts — owner: Dev 5 (MOD-CUST)
import { ApiError as SharedApiError, apiRequest, type ApiRequest } from '../../api/client';
import type { ConsentResource, CustomerResource, RecordConsentPayload } from './types';


export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number,
    public readonly details: unknown[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Goes through the shared client (api/client.ts): the Supabase session token, no-store, the step-up (TOTP) dialog and the
// error envelope. Errors are re-thrown as this feature's ApiError so the screens keep their handling.
async function request<T>(
  path: string,
  options: RequestInit & { ifMatch?: string; idempotencyKey?: string } = {},
): Promise<{ data: T; etag?: string }> {
  try {
    return await apiRequest<T>(path, {
      method: (options.method ?? 'GET') as ApiRequest['method'],
      body: typeof options.body === 'string' ? options.body : undefined,
      ifMatch: options.ifMatch,
      idempotencyKey: options.idempotencyKey,
    });
  } catch (err) {
    if (err instanceof SharedApiError) {
      throw new ApiError(err.code, err.message, err.httpStatus, err.details);
    }
    throw err;
  }
}

export function generateIdempotencyKey(): string {
  const rand = Math.random().toString(36).substring(2, 12);
  const time = Date.now().toString(36);
  return `idem_${time}_${rand}`;
}

export async function getCustomer(id: string): Promise<{ customer: CustomerResource; etag?: string }> {
  const { data, etag } = await request<CustomerResource>(`/v1/customers/${id}`);
  return { customer: data, etag };
}

export async function getCustomerConsents(id: string): Promise<ConsentResource[]> {
  const { data } = await request<{ data: ConsentResource[] }>(`/v1/customers/${id}/consents`);
  return data.data;
}

export async function recordCustomerConsent(
  customerId: string,
  payload: RecordConsentPayload,
): Promise<ConsentResource> {
  const { data } = await request<ConsentResource>(`/v1/customers/${customerId}/consents`, {
    method: 'POST',
    idempotencyKey: generateIdempotencyKey(),
    body: JSON.stringify(payload),
  });
  return data;
}

export async function listCustomers(
  params: {
    partyType?: 'INDIVIDUAL' | 'ENTITY';
    status?: 'ACTIVE' | 'MERGED';
    homeBranchId?: string;
    limit?: number;
    cursor?: string;
  } = {},
): Promise<{ data: CustomerResource[]; meta: { nextCursor: string | null; limit: number } }> {
  const query = new URLSearchParams();
  if (params.partyType) query.set('partyType', params.partyType);
  if (params.status) query.set('status', params.status);
  if (params.homeBranchId) query.set('homeBranchId', params.homeBranchId);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.cursor) query.set('cursor', params.cursor);

  const qs = query.toString() ? `?${query.toString()}` : '';
  const { data } = await request<{
    data: CustomerResource[];
    meta: { nextCursor: string | null; limit: number };
  }>(`/v1/customers${qs}`);
  return data;
}

export async function updateCustomer(
  id: string,
  payload: { fullName?: string; homeBranchId?: string },
  etag?: string,
): Promise<{ customer: CustomerResource; etag?: string }> {
  const { data, etag: newEtag } = await request<CustomerResource>(`/v1/customers/${id}`, {
    method: 'PATCH',
    ifMatch: etag,
    body: JSON.stringify(payload),
  });
  return { customer: data, etag: newEtag };
}

export async function withdrawConsent(consentId: string, reason?: string): Promise<ConsentResource> {
  const { data } = await request<ConsentResource>(`/v1/consents/${consentId}/withdrawal`, {
    method: 'POST',
    idempotencyKey: generateIdempotencyKey(),
    body: JSON.stringify({ withdrawalReason: reason }),
  });
  return data;
}
