// apps/web/src/features/invoices/api.ts — Module 33: Invoices API client
import { getStoredAuthToken } from '../../auth/token';
import type {
  ConnectorStatement,
  CreateInvoiceInput,
  InvoiceRecord,
  UpdateInvoiceStatusInput,
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

  const token = getStoredAuthToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, { ...options, headers });

  const etag = res.headers.get('ETag') || undefined;

  if (!res.ok) {
    let code = 'HTTP_ERROR';
    let message = `Request failed with status ${res.status}`;
    let details: unknown[] = [];

    try {
      const errJson = await res.json();
      if (errJson && errJson.error) {
        code = errJson.error.code || code;
        message = errJson.error.message || message;
        details = errJson.error.details || [];
      } else if (errJson && errJson.message) {
        message = errJson.message;
      }
    } catch {
      // Non-json error
    }

    throw new ApiError(code, message, res.status, details);
  }

  if (res.status === 204) {
    return { data: undefined as unknown as T, etag };
  }

  const data = await res.json();
  return { data, etag };
}

export async function getInvoices(params: {
  direction?: string;
  status?: string;
  partyId?: string;
  search?: string;
  cursor?: string;
  limit?: number;
} = {}): Promise<{ data: InvoiceRecord[]; nextCursor: string | null }> {
  const q = new URLSearchParams();
  if (params.direction) q.set('direction', params.direction);
  if (params.status) q.set('status', params.status);
  if (params.partyId) q.set('partyId', params.partyId);
  if (params.search) q.set('search', params.search);
  if (params.cursor) q.set('cursor', params.cursor);
  if (params.limit) q.set('limit', String(params.limit));

  const queryStr = q.toString() ? `?${q.toString()}` : '';
  const res = await request<{ data: InvoiceRecord[]; nextCursor: string | null }>(
    `/v1/invoices${queryStr}`,
    { method: 'GET' },
  );
  return res.data;
}

export async function getInvoice(id: string): Promise<{ invoice: InvoiceRecord; etag?: string }> {
  const res = await request<InvoiceRecord>(`/v1/invoices/${encodeURIComponent(id)}`, {
    method: 'GET',
  });
  return { invoice: res.data, etag: res.etag };
}

export async function createInvoice(
  input: CreateInvoiceInput,
  idempotencyKey?: string,
): Promise<{ invoice: InvoiceRecord; etag?: string }> {
  const ik = idempotencyKey || (typeof crypto !== 'undefined' ? crypto.randomUUID() : undefined);
  const res = await request<InvoiceRecord>('/v1/invoices', {
    method: 'POST',
    body: JSON.stringify(input),
    idempotencyKey: ik,
  });
  return { invoice: res.data, etag: res.etag };
}

export async function updateInvoiceStatus(
  id: string,
  input: UpdateInvoiceStatusInput,
  ifMatch?: string,
  idempotencyKey?: string,
): Promise<{ invoice: InvoiceRecord; etag?: string }> {
  const ik = idempotencyKey || (typeof crypto !== 'undefined' ? crypto.randomUUID() : undefined);
  const res = await request<InvoiceRecord>(`/v1/invoices/${encodeURIComponent(id)}/status`, {
    method: 'POST',
    body: JSON.stringify(input),
    ifMatch,
    idempotencyKey: ik,
  });
  return { invoice: res.data, etag: res.etag };
}

export async function getConnectorStatements(
  connectorId: string,
  params: { fromDate?: string; toDate?: string; limit?: number } = {},
): Promise<ConnectorStatement> {
  const q = new URLSearchParams();
  if (params.fromDate) q.set('fromDate', params.fromDate);
  if (params.toDate) q.set('toDate', params.toDate);
  if (params.limit) q.set('limit', String(params.limit));

  const queryStr = q.toString() ? `?${q.toString()}` : '';
  const res = await request<ConnectorStatement>(
    `/v1/connectors/${encodeURIComponent(connectorId)}/statements${queryStr}`,
    { method: 'GET' },
  );
  return res.data;
}

export async function getPortalConnectorStatements(
  connectorId: string,
  params: { fromDate?: string; toDate?: string; limit?: number } = {},
): Promise<ConnectorStatement> {
  const q = new URLSearchParams();
  if (params.fromDate) q.set('fromDate', params.fromDate);
  if (params.toDate) q.set('toDate', params.toDate);
  if (params.limit) q.set('limit', String(params.limit));

  const queryStr = q.toString() ? `?${q.toString()}` : '';
  const res = await request<ConnectorStatement>(
    `/v1/portal/connectors/${encodeURIComponent(connectorId)}/statements${queryStr}`,
    { method: 'GET' },
  );
  return res.data;
}
