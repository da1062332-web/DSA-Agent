// apps/web/src/features/rules/api.ts — owner: Developer 6 (Module 23: Business Rule Engine)
import { apiFetch, apiRequest } from '../../api/client';
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

type Page<T> = { data: T[]; meta: { limit: number; nextCursor: string | null } };

// All calls go through the shared client: the Supabase session token, Idempotency-Key on POSTs, If-Match from the version,
// the error envelope as ApiError, and the step-up (TOTP) dialog that rule approval, publish and suspend require.

// ---------------- Decision Definitions ----------------
export async function fetchDecisionDefinitions(): Promise<DecisionDefinitionResponse[]> {
  return (await apiFetch<{ data: DecisionDefinitionResponse[] }>('/v1/decision-definitions')).data;
}

export async function fetchDecisionDefinition(key: string): Promise<DecisionDefinitionResponse> {
  return apiFetch<DecisionDefinitionResponse>(`/v1/decision-definitions/${encodeURIComponent(key)}`);
}

// ---------------- Rule Sets ----------------
export async function fetchRuleSets(params?: {
  decisionKey?: string;
  scopeType?: string;
  status?: string;
  ownerUserId?: string;
  limit?: number;
  cursor?: string;
}): Promise<Page<RuleSetResponse>> {
  return apiFetch<Page<RuleSetResponse>>('/v1/rule-sets', { query: { ...params } });
}

export async function createRuleSet(input: CreateRuleSetInput): Promise<RuleSetResponse> {
  return apiFetch<RuleSetResponse>('/v1/rule-sets', { method: 'POST', body: input });
}

export async function fetchRuleSet(ruleSetId: string): Promise<{ data: RuleSetResponse; etag?: string | null }> {
  return apiRequest<RuleSetResponse>(`/v1/rule-sets/${encodeURIComponent(ruleSetId)}`);
}

// ---------------- Rule Set Versions ----------------
export async function fetchRuleSetVersions(ruleSetId: string): Promise<RuleSetVersionResponse[]> {
  return (await apiFetch<{ data: RuleSetVersionResponse[] }>(`/v1/rule-sets/${encodeURIComponent(ruleSetId)}/versions`))
    .data;
}

export async function createRuleSetVersion(
  ruleSetId: string,
  input: CreateRuleSetVersionInput,
): Promise<RuleSetVersionResponse> {
  return apiFetch<RuleSetVersionResponse>(`/v1/rule-sets/${encodeURIComponent(ruleSetId)}/versions`, {
    method: 'POST',
    body: input,
  });
}

export async function fetchRuleSetVersion(
  versionId: string,
): Promise<{ data: RuleSetVersionResponse; etag?: string | null }> {
  return apiRequest<RuleSetVersionResponse>(`/v1/rule-set-versions/${encodeURIComponent(versionId)}`);
}

export async function updateRuleSetVersion(
  versionId: string,
  input: UpdateRuleSetVersionInput,
  lockVersion: number,
): Promise<{ data: RuleSetVersionResponse; etag?: string | null }> {
  return apiRequest<RuleSetVersionResponse>(`/v1/rule-set-versions/${encodeURIComponent(versionId)}`, {
    method: 'PUT',
    body: input,
    version: lockVersion,
  });
}

// ---------------- Validation & Simulation ----------------
export async function validateRuleSetVersion(versionId: string): Promise<ValidationReportResponse> {
  return apiFetch<ValidationReportResponse>(`/v1/rule-set-versions/${encodeURIComponent(versionId)}/validate`, {
    method: 'POST',
  });
}

export async function simulateRuleSetVersion(
  versionId: string,
  input: SimulateVersionInput,
): Promise<SimulationResponse> {
  return apiFetch<SimulationResponse>(`/v1/rule-set-versions/${encodeURIComponent(versionId)}/simulations`, {
    method: 'POST',
    body: input,
  });
}

// ---------------- Test Cases ----------------
export async function fetchTestCases(ruleSetId: string): Promise<TestCaseResponse[]> {
  return (await apiFetch<{ data: TestCaseResponse[] }>(`/v1/rule-sets/${encodeURIComponent(ruleSetId)}/test-cases`))
    .data;
}

export async function createTestCase(ruleSetId: string, input: CreateTestCaseInput): Promise<TestCaseResponse> {
  return apiFetch<TestCaseResponse>(`/v1/rule-sets/${encodeURIComponent(ruleSetId)}/test-cases`, {
    method: 'POST',
    body: input,
  });
}

// ---------------- Lifecycle Actions ----------------
const lifecycle = <I>(action: string) => (versionId: string, input: I) =>
  apiFetch<RuleSetVersionResponse>(`/v1/rule-set-versions/${encodeURIComponent(versionId)}/${action}`, {
    method: 'POST',
    body: input,
  });

export const submitVersion: (versionId: string, input: SubmitVersionInput) => Promise<RuleSetVersionResponse> =
  lifecycle<SubmitVersionInput>('submit');
export const reviewVersion: (versionId: string, input: ReviewVersionInput) => Promise<RuleSetVersionResponse> =
  lifecycle<ReviewVersionInput>('reviews');
export const publishVersion: (versionId: string, input: PublishVersionInput) => Promise<RuleSetVersionResponse> =
  lifecycle<PublishVersionInput>('publish');
export const suspendVersion: (versionId: string, input: SuspendVersionInput) => Promise<RuleSetVersionResponse> =
  lifecycle<SuspendVersionInput>('suspend');
export const reinstateVersion: (versionId: string, input: ReinstateVersionInput) => Promise<RuleSetVersionResponse> =
  lifecycle<ReinstateVersionInput>('reinstate');

export async function retireVersion(versionId: string, reason: string): Promise<RuleSetVersionResponse> {
  return lifecycle<{ reason: string }>('retire')(versionId, { reason });
}

// ---------------- Decision Records ----------------
export async function fetchDecisionRecords(params?: {
  decisionKey?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}): Promise<Page<DecisionRecordResponse>> {
  return apiFetch<Page<DecisionRecordResponse>>('/v1/decision-records', { query: { ...params } });
}

export async function fetchDecisionRecord(id: string): Promise<DecisionRecordResponse> {
  return apiFetch<DecisionRecordResponse>(`/v1/decision-records/${encodeURIComponent(id)}`);
}
