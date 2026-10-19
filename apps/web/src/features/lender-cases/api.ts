// apps/web/src/features/lender-cases/api.ts — owner: Dev 4 (MOD-LCS API Client)
import { ApiError as SharedApiError, apiRequest, type ApiRequest } from '../../api/client';
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

export async function fetchLenderCases(applicationId: string): Promise<LenderCaseResource[]> {
  const res = await request<{ data: LenderCaseResource[] }>(
    `/v1/applications/${applicationId}/lender-cases`,
    {
      method: 'GET',
    },
  );
  return res.data.data;
}

export async function fetchAllLenderCases(params?: {
  status?: string;
  lenderId?: string;
  applicationId?: string;
}): Promise<LenderCaseResource[]> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.lenderId) query.set('lenderId', params.lenderId);
  if (params?.applicationId) query.set('applicationId', params.applicationId);
  const qStr = query.toString();
  const url = `/v1/lender-cases${qStr ? `?${qStr}` : ''}`;
  const res = await request<{ data: LenderCaseResource[] }>(url, { method: 'GET' });
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
