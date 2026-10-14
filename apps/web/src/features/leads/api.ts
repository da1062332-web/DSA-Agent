import type { ConversionResponse, CreateLeadPayload, LeadListResponse, LeadResource } from './types';
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

  const token = getStoredAuthToken() || localStorage.getItem('dsa_token');
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
      const errBody = await response.json();
      if (errBody?.error) {
        errCode = errBody.error.code || errCode;
        errMessage = errBody.error.message || errMessage;
        errDetails = errBody.error.details || [];
      }
    } catch {
      // ignore JSON parse error
    }

    throw new ApiError(errCode, errMessage, response.status, errDetails);
  }

  const data = (await response.json()) as T;
  return { data, etag };
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
      transition.qualification?.applicantType || transition.qualApplicantType || 'SALARIED';
    let reqAmount = transition.qualification?.requestedAmount || transition.qualRequestedAmount;
    if (reqAmount && typeof reqAmount.amount === 'string') {
      const amt = reqAmount.amount.trim();
      reqAmount = {
        amount: /^\d+$/.test(amt) ? `${amt}.00` : /^\d+\.\d$/.test(amt) ? `${amt}0` : amt,
        currency: reqAmount.currency || 'INR',
      };
    } else {
      reqAmount = { amount: '500000.00', currency: 'INR' };
    }
    bodyPayload.qualification = {
      applicantType,
      requestedAmount: reqAmount,
    };
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
