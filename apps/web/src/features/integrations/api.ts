// apps/web/src/features/integrations/api.ts
// Module 28: Integration Management (MOD-INT) Client API

import type {
  CapabilityDescriptor,
  ConfigureIntegrationRequest,
  HealthCheckResult,
  IntegrationConnection,
  ListIntegrationsQuery,
} from '@dsa/contracts';
import { apiFetch } from '../../api/client';

export async function fetchCapabilities(): Promise<{
  data: CapabilityDescriptor[];
  meta: { total: number };
}> {
  return apiFetch<{ data: CapabilityDescriptor[]; meta: { total: number } }>('/v1/integrations/capabilities');
}

export async function fetchIntegrations(
  query?: ListIntegrationsQuery,
): Promise<{ data: IntegrationConnection[]; meta: { total: number } }> {
  return apiFetch<{ data: IntegrationConnection[]; meta: { total: number } }>('/v1/integrations', {
    query: query as Record<string, string | number | undefined>,
  });
}

export async function fetchIntegration(provider: string, capability: string): Promise<IntegrationConnection> {
  return apiFetch<IntegrationConnection>(`/v1/integrations/${encodeURIComponent(provider)}`, {
    query: { capability },
  });
}

export async function configureIntegration(
  provider: string,
  input: ConfigureIntegrationRequest,
  etag?: string,
): Promise<IntegrationConnection> {
  const headers: Record<string, string> = {};
  if (etag) headers['If-Match'] = etag;

  return apiFetch<IntegrationConnection>(`/v1/integrations/${encodeURIComponent(provider)}`, {
    method: 'PUT',
    headers,
    body: input,
  });
}

export async function pingIntegration(provider: string, capability: string): Promise<HealthCheckResult> {
  return apiFetch<HealthCheckResult>(`/v1/integrations/${encodeURIComponent(provider)}/ping`, {
    method: 'POST',
    body: { capability },
  });
}
