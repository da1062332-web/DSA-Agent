// apps/web/src/features/rules/api.ts — owner: Developer 6 (Module 23: Business Rule Engine)
import { readConfig } from '../../config';
import { getStoredAuthToken } from '../../auth/token';
import type {
  CreateRuleSetInput,
  CreateRuleSetVersionInput,
  CreateTestCaseInput,
  DecisionDefinitionResponse,
  DecisionRecordResponse,
  PublishVersionInput,
  ReinstateVersionInput,
  ReviewVersionInput,
  RuleSetResponse,
  RuleSetVersionResponse,
  SimulateVersionInput,
  SimulationResponse,
  SubmitVersionInput,
  SuspendVersionInput,
  TestCaseResponse,
  UpdateRuleSetVersionInput,
  ValidationReportResponse,
} from './types';

function getApiBaseUrl(): string {
  const config = readConfig();
  return config.success ? config.data.VITE_API_BASE_URL : 'http://localhost:3000';
}

function getAuthHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  const token = getStoredAuthToken() || '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function handleResponse<T>(res: Response): Promise<{ data: T; etag?: string | null }> {
  const etag = res.headers.get('ETag');
  if (!res.ok) {
    let errorMessage = `Request failed with status ${res.status}`;
    try {
      const errorJson = await res.json();
      if (errorJson?.error?.message) {
        errorMessage = errorJson.error.message;
      }
    } catch {
      // ignore
    }
    throw new Error(errorMessage);
  }
  const data = (await res.json()) as T;
  return { data, etag };
}

// ---------------- Decision Definitions ----------------
export async function fetchDecisionDefinitions(): Promise<DecisionDefinitionResponse[]> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/decision-definitions`, {
    headers: getAuthHeaders(),
  });
  const { data } = await handleResponse<DecisionDefinitionResponse[]>(res);
  return data;
}

export async function fetchDecisionDefinition(key: string): Promise<DecisionDefinitionResponse> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/decision-definitions/${encodeURIComponent(key)}`, {
    headers: getAuthHeaders(),
  });
  const { data } = await handleResponse<DecisionDefinitionResponse>(res);
  return data;
}

// ---------------- Rule Sets ----------------
export async function fetchRuleSets(params?: {
  decisionKey?: string;
  scopeType?: string;
  status?: string;
  ownerUserId?: string;
  limit?: number;
  cursor?: string;
}): Promise<{ data: RuleSetResponse[]; meta: { limit: number; nextCursor: string | null } }> {
  const baseUrl = getApiBaseUrl();
  const url = new URL(`${baseUrl}/v1/rule-sets`);
  if (params?.decisionKey) url.searchParams.set('decisionKey', params.decisionKey);
  if (params?.scopeType) url.searchParams.set('scopeType', params.scopeType);
  if (params?.status) url.searchParams.set('status', params.status);
  if (params?.ownerUserId) url.searchParams.set('ownerUserId', params.ownerUserId);
  if (params?.limit) url.searchParams.set('limit', String(params.limit));
  if (params?.cursor) url.searchParams.set('cursor', params.cursor);

  const res = await fetch(url.toString(), { headers: getAuthHeaders() });
  const { data } = await handleResponse<{ data: RuleSetResponse[]; meta: { limit: number; nextCursor: string | null } }>(res);
  return data;
}

export async function createRuleSet(input: CreateRuleSetInput): Promise<RuleSetResponse> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/rule-sets`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  const { data } = await handleResponse<RuleSetResponse>(res);
  return data;
}

export async function fetchRuleSet(ruleSetId: string): Promise<{ data: RuleSetResponse; etag?: string | null }> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/rule-sets/${ruleSetId}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<RuleSetResponse>(res);
}

// ---------------- Rule Set Versions ----------------
export async function fetchRuleSetVersions(ruleSetId: string): Promise<RuleSetVersionResponse[]> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/rule-sets/${ruleSetId}/versions`, {
    headers: getAuthHeaders(),
  });
  const { data } = await handleResponse<{ data: RuleSetVersionResponse[] }>(res);
  return data.data;
}

export async function createRuleSetVersion(
  ruleSetId: string,
  input: CreateRuleSetVersionInput
): Promise<RuleSetVersionResponse> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/rule-sets/${ruleSetId}/versions`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  const { data } = await handleResponse<RuleSetVersionResponse>(res);
  return data;
}

export async function fetchRuleSetVersion(
  versionId: string
): Promise<{ data: RuleSetVersionResponse; etag?: string | null }> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/rule-set-versions/${versionId}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<RuleSetVersionResponse>(res);
}

export async function updateRuleSetVersion(
  versionId: string,
  input: UpdateRuleSetVersionInput,
  lockVersion: number
): Promise<{ data: RuleSetVersionResponse; etag?: string | null }> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/rule-set-versions/${versionId}`, {
    method: 'PUT',
    headers: getAuthHeaders({
      'If-Match': `"${lockVersion}"`,
    }),
    body: JSON.stringify(input),
  });
  return handleResponse<RuleSetVersionResponse>(res);
}

// ---------------- Validation & Simulation ----------------
export async function validateRuleSetVersion(versionId: string): Promise<ValidationReportResponse> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/rule-set-versions/${versionId}/validate`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  const { data } = await handleResponse<ValidationReportResponse>(res);
  return data;
}

export async function simulateRuleSetVersion(
  versionId: string,
  input: SimulateVersionInput
): Promise<SimulationResponse> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/rule-set-versions/${versionId}/simulations`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  const { data } = await handleResponse<SimulationResponse>(res);
  return data;
}

// ---------------- Test Cases ----------------
export async function fetchTestCases(ruleSetId: string): Promise<TestCaseResponse[]> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/rule-sets/${ruleSetId}/test-cases`, {
    headers: getAuthHeaders(),
  });
  const { data } = await handleResponse<TestCaseResponse[]>(res);
  return data;
}

export async function createTestCase(
  ruleSetId: string,
  input: CreateTestCaseInput
): Promise<TestCaseResponse> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/rule-sets/${ruleSetId}/test-cases`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  const { data } = await handleResponse<TestCaseResponse>(res);
  return data;
}

// ---------------- Lifecycle Actions ----------------
export async function submitVersion(versionId: string, input: SubmitVersionInput): Promise<RuleSetVersionResponse> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/rule-set-versions/${versionId}/submit`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  const { data } = await handleResponse<RuleSetVersionResponse>(res);
  return data;
}

export async function reviewVersion(versionId: string, input: ReviewVersionInput): Promise<RuleSetVersionResponse> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/rule-set-versions/${versionId}/reviews`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  const { data } = await handleResponse<RuleSetVersionResponse>(res);
  return data;
}

export async function publishVersion(versionId: string, input: PublishVersionInput): Promise<RuleSetVersionResponse> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/rule-set-versions/${versionId}/publish`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  const { data } = await handleResponse<RuleSetVersionResponse>(res);
  return data;
}

export async function suspendVersion(versionId: string, input: SuspendVersionInput): Promise<RuleSetVersionResponse> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/rule-set-versions/${versionId}/suspend`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  const { data } = await handleResponse<RuleSetVersionResponse>(res);
  return data;
}

export async function reinstateVersion(versionId: string, input: ReinstateVersionInput): Promise<RuleSetVersionResponse> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/rule-set-versions/${versionId}/reinstate`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  const { data } = await handleResponse<RuleSetVersionResponse>(res);
  return data;
}

export async function retireVersion(versionId: string, reason: string): Promise<RuleSetVersionResponse> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/rule-set-versions/${versionId}/retire`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ reason }),
  });
  const { data } = await handleResponse<RuleSetVersionResponse>(res);
  return data;
}

// ---------------- Decision Records ----------------
export async function fetchDecisionRecords(params?: {
  decisionKey?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}): Promise<{ data: DecisionRecordResponse[]; meta: { limit: number; nextCursor: string | null } }> {
  const baseUrl = getApiBaseUrl();
  const url = new URL(`${baseUrl}/v1/decision-records`);
  if (params?.decisionKey) url.searchParams.set('decisionKey', params.decisionKey);
  if (params?.status) url.searchParams.set('status', params.status);
  if (params?.limit) url.searchParams.set('limit', String(params.limit));
  if (params?.cursor) url.searchParams.set('cursor', params.cursor);

  const res = await fetch(url.toString(), { headers: getAuthHeaders() });
  const { data } = await handleResponse<{ data: DecisionRecordResponse[]; meta: { limit: number; nextCursor: string | null } }>(res);
  return data;
}

export async function fetchDecisionRecord(id: string): Promise<DecisionRecordResponse> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/decision-records/${id}`, {
    headers: getAuthHeaders(),
  });
  const { data } = await handleResponse<DecisionRecordResponse>(res);
  return data;
}
