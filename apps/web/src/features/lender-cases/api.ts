// apps/web/src/features/lender-cases/api.ts — owner: Dev 4 (MOD-LCS API Client)
import type {
  BuildPackagePayload,
  CreateLenderCasePayload,
  LenderCaseResource,
  LenderQueryResource,
  RecordLenderQueryPayload,
  RecordQueryResponsePayload,
  SubmissionPackageResource,
  SubmitLenderCasePayload,
  UpdateLenderCaseStatusPayload,
} from './types';
import { getStoredAuthToken } from '../../auth/token';

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

  const token = getStoredAuthToken() || (typeof localStorage !== 'undefined' ? localStorage.getItem('dsa_token') : null);
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
      if (errorBody?.error) {
        errCode = errorBody.error.code || errCode;
        errMessage = errorBody.error.message || errMessage;
        errDetails = errorBody.error.details || [];
      }
    } catch {
      // Body not JSON
    }

    throw new ApiError(errCode, errMessage, response.status, errDetails);
  }

  const data = (await response.json()) as T;
  return { data, etag };
}

export async function fetchLenderCases(applicationId: string): Promise<LenderCaseResource[]> {
  const res = await request<{ data: LenderCaseResource[] }>(`/v1/applications/${applicationId}/lender-cases`, {
    method: 'GET',
  });
  return res.data.data;
}

export async function fetchLenderCase(id: string): Promise<{ case: LenderCaseResource; etag?: string }> {
  const res = await request<LenderCaseResource>(`/v1/lender-cases/${id}`, {
    method: 'GET',
  });
  return { case: res.data, etag: res.etag };
}

export async function createLenderCase(
  applicationId: string,
  payload: CreateLenderCasePayload,
  idempotencyKey?: string,
): Promise<{ case: LenderCaseResource; etag?: string }> {
  const res = await request<LenderCaseResource>(`/v1/applications/${applicationId}/lender-cases`, {
    method: 'POST',
    body: JSON.stringify(payload),
    idempotencyKey,
  });
  return { case: res.data, etag: res.etag };
}

export async function buildPackage(
  id: string,
  payload: BuildPackagePayload = {},
  ifMatch?: string,
): Promise<{ package: SubmissionPackageResource; case: LenderCaseResource; etag?: string }> {
  const res = await request<{ package: SubmissionPackageResource; case: LenderCaseResource }>(
    `/v1/lender-cases/${id}/package`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
      ifMatch,
    },
  );
  return { package: res.data.package, case: res.data.case, etag: res.etag };
}

export async function submitLenderCase(
  id: string,
  payload: SubmitLenderCasePayload,
  ifMatch?: string,
  idempotencyKey?: string,
): Promise<any> {
  const res = await request<any>(`/v1/lender-cases/${id}/submission`, {
    method: 'POST',
    body: JSON.stringify(payload),
    ifMatch,
    idempotencyKey,
  });
  return res.data;
}

export async function updateLenderCaseStatus(
  id: string,
  payload: UpdateLenderCaseStatusPayload,
  ifMatch: string,
): Promise<{ case: LenderCaseResource; etag?: string }> {
  const res = await request<LenderCaseResource>(`/v1/lender-cases/${id}/status-updates`, {
    method: 'POST',
    body: JSON.stringify(payload),
    ifMatch,
  });
  return { case: res.data, etag: res.etag };
}

export async function recordLenderQuery(
  id: string,
  payload: RecordLenderQueryPayload,
  ifMatch?: string,
): Promise<{ query: LenderQueryResource; case: LenderCaseResource; etag?: string }> {
  const res = await request<{ query: LenderQueryResource; case: LenderCaseResource }>(
    `/v1/lender-cases/${id}/queries`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
      ifMatch,
    },
  );
  return { query: res.data.query, case: res.data.case, etag: res.etag };
}

export async function recordQueryResponse(
  queryId: string,
  payload: RecordQueryResponsePayload,
): Promise<{ query: LenderQueryResource; case: LenderCaseResource; etag?: string }> {
  const res = await request<{ query: LenderQueryResource; case: LenderCaseResource }>(
    `/v1/lender-queries/${queryId}/responses`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
  return { query: res.data.query, case: res.data.case, etag: res.etag };
}
