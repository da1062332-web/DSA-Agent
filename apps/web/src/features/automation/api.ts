// apps/web/src/features/automation/api.ts — owner: Akash (Module 24: Workflow Automation MOD-WFA)
import type {
  AutomationDefinition,
  AutomationVersion,
  AutomationExecution,
  DeadLetterRecord,
  CreateAutomationDefinitionInput,
  CreateAutomationVersionInput,
  ReviewVersionActionInput,
  ExecuteAutomationInput,
} from '@dsa/contracts';
import { apiFetch } from '../../api/client';

export async function listAutomations(params?: {
  status?: string;
  entityType?: string;
}): Promise<AutomationDefinition[]> {
  const query: Record<string, string> = {};
  if (params?.status) query.status = params.status;
  if (params?.entityType) query.entityType = params.entityType;
  const res = await apiFetch<{ data: AutomationDefinition[] }>('/v1/automations', { query });
  return res.data;
}

export async function createAutomation(
  input: CreateAutomationDefinitionInput & { initialSteps?: unknown[] },
): Promise<AutomationDefinition> {
  const res = await apiFetch<{ definition: AutomationDefinition }>('/v1/automations', {
    method: 'POST',
    body: input,
  });
  return res.definition;
}

export async function getAutomation(
  id: string,
): Promise<{ definition: AutomationDefinition; version?: AutomationVersion }> {
  return apiFetch<{ definition: AutomationDefinition; version?: AutomationVersion }>(`/v1/automations/${id}`);
}

export async function updateAutomation(
  id: string,
  patch: { name?: string; description?: string; status?: string },
): Promise<AutomationDefinition> {
  const res = await apiFetch<{ definition: AutomationDefinition }>(`/v1/automations/${id}`, {
    method: 'PATCH',
    body: patch,
  });
  return res.definition;
}

export async function listAutomationVersions(id: string): Promise<AutomationVersion[]> {
  const res = await apiFetch<{ data: AutomationVersion[] }>(`/v1/automations/${id}/versions`);
  return res.data;
}

export async function createAutomationVersion(
  id: string,
  input: CreateAutomationVersionInput,
): Promise<AutomationVersion> {
  const res = await apiFetch<{ version: AutomationVersion }>(`/v1/automations/${id}/versions`, {
    method: 'POST',
    body: input,
  });
  return res.version;
}

export async function reviewAutomationVersion(
  id: string,
  versionId: string,
  input: ReviewVersionActionInput,
): Promise<{ version: AutomationVersion }> {
  return apiFetch<{ version: AutomationVersion }>(`/v1/automations/${id}/versions/${versionId}/review`, {
    method: 'POST',
    body: input,
  });
}

export async function executeAutomation(
  id: string,
  input: ExecuteAutomationInput,
): Promise<{ executionId: string; status: string; outcome?: unknown }> {
  return apiFetch<{ executionId: string; status: string; outcome?: unknown }>(
    `/v1/automations/${id}/execute`,
    {
      method: 'POST',
      body: input,
    },
  );
}

export async function listExecutions(params?: {
  status?: string;
  definitionId?: string;
  limit?: number;
}): Promise<AutomationExecution[]> {
  const query: Record<string, string | number> = {};
  if (params?.status) query.status = params.status;
  if (params?.definitionId) query.definitionId = params.definitionId;
  if (params?.limit) query.limit = params.limit;
  const res = await apiFetch<{ data: AutomationExecution[] }>('/v1/automations/executions', { query });
  return res.data;
}

export async function getExecution(
  id: string,
): Promise<{ execution: AutomationExecution; steps: unknown[] }> {
  const execution = await apiFetch<AutomationExecution>(`/v1/automations/executions/${id}`);
  const stepsRes = await apiFetch<{ data: unknown[] }>(`/v1/automations/executions/${id}/steps`);
  return { execution, steps: stepsRes.data };
}

export async function cancelExecution(id: string, reason: string): Promise<void> {
  await apiFetch(`/v1/automations/executions/${id}/cancel`, {
    method: 'POST',
    body: { reason },
  });
}

export async function listDeadLetters(): Promise<DeadLetterRecord[]> {
  const res = await apiFetch<{ data: DeadLetterRecord[] }>('/v1/automations/dead-letters');
  return res.data;
}

export async function resolveDeadLetter(
  id: string,
  resolutionAction: 'RETRY' | 'SKIP' | 'CANCEL',
  notes?: string,
): Promise<void> {
  await apiFetch(`/v1/automations/dead-letters/${id}/resolve`, {
    method: 'POST',
    body: { resolutionAction, notes },
  });
}
