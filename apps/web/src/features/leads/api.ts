import { ApiError as SharedApiError, apiRequest, type ApiRequest } from '../../api/client';
import type { ConversionResponse, CreateLeadPayload, LeadListResponse, LeadResource } from './types';


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

export async function fetchLeads(params: {
  state?: string;
  ownerUserId?: string;
  cursor?: string;
  limit?: number;
}): Promise<LeadListResponse> {
  const query = new URLSearchParams();
  if (params.state) query.set('filter[state]', params.state);
  if (params.ownerUserId) query.set('filter[ownerUserId]', params.ownerUserId);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', params.limit.toString());

  const queryString = query.toString() ? `?${query.toString()}` : '';
  const res = await request<LeadListResponse>(`/v1/leads${queryString}`, { method: 'GET' });
  return res.data;
}

export async function fetchLeadById(id: string): Promise<{ lead: LeadResource; etag: string }> {
  const res = await request<LeadResource>(`/v1/leads/${id}`, { method: 'GET' });
  return { lead: res.data, etag: res.etag || `"${res.data.lockVersion}"` };
}

export async function createLead(
  payload: CreateLeadPayload,
  idempotencyKey = `idem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
): Promise<{ lead: LeadResource; etag: string }> {
  const res = await request<LeadResource>('/v1/leads', {
    method: 'POST',
    body: JSON.stringify(payload),
    idempotencyKey,
  });
  return { lead: res.data, etag: res.etag || `"${res.data.lockVersion}"` };
}

export async function transitionLead(
  id: string,
  transition: {
    transitionCode: string;
    reasonCode?: string;
    qualApplicantType?: string;
    qualMonthlyIncome?: string;
    qualRequestedAmount?: { amount: string; currency: string };
    disqualificationReason?: string;
    qualification?: {
      applicantType: string;
      requestedAmount: { amount: string; currency: string };
      tenureMonths?: number | null;
      purposeCode?: string | null;
    };
  },
  ifMatch: string,
  idempotencyKey = `trans_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
): Promise<{ lead: LeadResource; etag: string }> {
  const bodyPayload: Record<string, unknown> = {
    transitionCode: transition.transitionCode,
    reasonCode: transition.reasonCode || undefined,
    disqualificationReason: transition.disqualificationReason || undefined,
  };

  if (transition.transitionCode === 'T-LEAD-04') {
    const applicantType =
      transition.qualification?.applicantType || transition.qualApplicantType;
    let reqAmount = transition.qualification?.requestedAmount || transition.qualRequestedAmount;
    if (reqAmount && typeof reqAmount.amount === 'string' && reqAmount.amount.trim()) {
      const amt = reqAmount.amount.trim();
      reqAmount = {
        amount: /^\d+$/.test(amt) ? `${amt}.00` : /^\d+\.\d$/.test(amt) ? `${amt}0` : amt,
        currency: reqAmount.currency || 'INR',
      };
    } else {
      reqAmount = undefined;
    }
    if (applicantType || reqAmount) {
      bodyPayload.qualification = {
        applicantType,
        requestedAmount: reqAmount,
      };
    }
  }

  const res = await request<LeadResource>(`/v1/leads/${id}/transitions`, {
    method: 'POST',
    body: JSON.stringify(bodyPayload),
    ifMatch,
    idempotencyKey,
  });
  return { lead: res.data, etag: res.etag || `"${res.data.lockVersion}"` };
}

export async function assignLead(
  id: string,
  assignment: { toUserId?: string; toQueueId?: string; reasonCode: string },
  ifMatch: string,
  idempotencyKey = `asg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
): Promise<{ lead: LeadResource; etag: string }> {
  const res = await request<LeadResource>(`/v1/leads/${id}/assignments`, {
    method: 'POST',
    body: JSON.stringify(assignment),
    ifMatch,
    idempotencyKey,
  });
  return { lead: res.data, etag: res.etag || `"${res.data.lockVersion}"` };
}

export async function convertLead(
  id: string,
  ifMatch: string,
  idempotencyKey = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
): Promise<ConversionResponse> {
  const res = await request<ConversionResponse>(`/v1/leads/${id}/conversion`, {
    method: 'POST',
    body: JSON.stringify({}),
    ifMatch,
    idempotencyKey,
  });
  return res.data;
}
