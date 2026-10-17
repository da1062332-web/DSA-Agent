import { apiFetch } from '../../api/client';
import type {
  CreateEmpanelmentInput,
  CreateLenderInput,
  Empanelment,
  Lender,
  LenderContact,
  SetLenderContactsInput,
  UpdateEmpanelmentInput,
  UpdateLenderInput,
} from './types';

export interface ListLendersResponse {
  data: Lender[];
  meta: {
    nextCursor: string | null;
    limit: number;
  };
}

export async function fetchLenders(params?: {
  status?: string;
  type?: string;
  cursor?: string;
  limit?: number;
}): Promise<ListLendersResponse> {
  return apiFetch<ListLendersResponse>('/v1/lenders', {
    query: {
      status: params?.status,
      type: params?.type,
      cursor: params?.cursor,
      limit: params?.limit,
    },
  });
}

export async function fetchLenderById(id: string): Promise<Lender> {
  return apiFetch<Lender>(`/v1/lenders/${id}`);
}

export async function createLender(input: CreateLenderInput): Promise<Lender> {
  return apiFetch<Lender>('/v1/lenders', {
    method: 'POST',
    body: input,
  });
}

export async function updateLender(id: string, version: number, input: UpdateLenderInput): Promise<Lender> {
  return apiFetch<Lender>(`/v1/lenders/${id}`, {
    method: 'PATCH',
    version,
    body: input,
  });
}

export async function createEmpanelment(
  lenderId: string,
  input: CreateEmpanelmentInput,
): Promise<Empanelment> {
  return apiFetch<Empanelment>(`/v1/lenders/${lenderId}/empanelments`, {
    method: 'POST',
    body: input,
  });
}

export async function updateEmpanelment(
  id: string,
  version: number,
  input: UpdateEmpanelmentInput,
): Promise<Empanelment> {
  return apiFetch<Empanelment>(`/v1/empanelments/${id}`, {
    method: 'PATCH',
    version,
    body: input,
  });
}

export async function setLenderContacts(
  lenderId: string,
  version: number,
  input: SetLenderContactsInput,
): Promise<{ data: LenderContact[] }> {
  return apiFetch<{ data: LenderContact[] }>(`/v1/lenders/${lenderId}/contacts`, {
    method: 'PUT',
    version,
    body: input,
  });
}
