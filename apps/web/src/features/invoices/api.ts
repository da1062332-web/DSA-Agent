// apps/web/src/features/invoices/api.ts — Module 33: Invoices API client
import { ApiError as SharedApiError, apiRequest, type ApiRequest } from '../../api/client';
import type {
  ConnectorStatement,
  CreateInvoiceInput,
  InvoiceRecord,
  UpdateInvoiceStatusInput,
} from './types';


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

export async function getInvoices(
  params: {
    direction?: string;
    status?: string;
    partyId?: string;
    search?: string;
    cursor?: string;
    limit?: number;
  } = {},
): Promise<{ data: InvoiceRecord[]; nextCursor: string | null }> {
  const q = new URLSearchParams();
  if (params.direction) q.set('direction', params.direction);
  if (params.status) q.set('status', params.status);
  if (params.partyId) q.set('partyId', params.partyId);
  if (params.search) q.set('search', params.search);
  if (params.cursor) q.set('cursor', params.cursor);
  if (params.limit) q.set('limit', String(params.limit));

  const queryStr = q.toString() ? `?${q.toString()}` : '';
  const res = await request<{ data: InvoiceRecord[]; nextCursor: string | null }>(`/v1/invoices${queryStr}`, {
    method: 'GET',
  });
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
