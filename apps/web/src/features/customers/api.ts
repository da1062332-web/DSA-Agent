// apps/web/src/features/customers/api.ts — owner: Dev 5 (MOD-CUST)
import type {
  ConsentResource,
  CustomerResource,
  RecordConsentPayload,
} from './types';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) || '';

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

async function request<T>(
  path: string,
  options: RequestInit & { ifMatch?: string; idempotencyKey?: string } = {},
): Promise<{ data: T; etag?: string }> {
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');

  if (options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  if (options.ifMatch) {
    headers.set('If-Match', options.ifMatch);
  }

  if (options.idempotencyKey) {
    headers.set('Idempotency-Key', options.idempotencyKey);
  }

  let token = localStorage.getItem('dsa_token');
  if (!token) {
    try {
      const raw = localStorage.getItem('dsa_auth_session');
      if (raw) {
        const parsed = JSON.parse(raw);
        token = parsed.access_token || parsed.token || null;
      }
    } catch {
      // ignore
    }
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const url = `${API_BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers,
  });

  const etag = response.headers.get('ETag') || undefined;

  if (!response.ok) {
    let errCode = 'UNKNOWN_ERROR';
    let errMessage = `HTTP error ${response.status}`;
    let errDetails: unknown[] = [];

    try {
      const errorBody = await response.json();
      if (errorBody && errorBody.error) {
        errCode = errorBody.error.code || errCode;
        errMessage = errorBody.error.message || errMessage;
        errDetails = errorBody.error.details || [];
      }
    } catch {
      // Non-json response
    }

    throw new ApiError(errCode, errMessage, response.status, errDetails);
  }

  const data = (await response.json()) as T;
  return { data, etag };
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

export async function withdrawConsent(
  consentId: string,
  reason?: string,
): Promise<ConsentResource> {
  const { data } = await request<ConsentResource>(`/v1/consents/${consentId}/withdrawal`, {
    method: 'POST',
    idempotencyKey: generateIdempotencyKey(),
    body: JSON.stringify({ withdrawalReason: reason }),
  });
  return data;
}
