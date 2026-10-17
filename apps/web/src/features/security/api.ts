// apps/web/src/features/security/api.ts — Module 39 (owner: Akash). Security events (API-SEC-003/004 family) and incidents (API-SEC-001 to 006).
import type {
  CreateIncidentRequest,
  IncidentListResponse,
  IncidentRecord,
  SecurityEventListResponse,
  UpdateIncidentRequest,
} from '@dsa/contracts';
import { apiFetch } from '../../api/client';
import { cleanQuery } from './model';

export const listSecurityEvents = (filters: Record<string, string | undefined>, cursor?: string | null) =>
  apiFetch<SecurityEventListResponse>('/v1/security/events', {
    query: { ...cleanQuery(filters), limit: 50, cursor: cursor ?? undefined },
  });

export const listIncidents = (filters: Record<string, string | undefined>, cursor?: string | null) =>
  apiFetch<IncidentListResponse>('/v1/incidents', {
    query: { ...cleanQuery(filters), limit: 50, cursor: cursor ?? undefined },
  });

export const createIncident = (body: CreateIncidentRequest) =>
  apiFetch<IncidentRecord>('/v1/incidents', { method: 'POST', body });

/** `version` is the incident's lockVersion; the API answers 409 VERSION_CONFLICT when someone else changed it. */
export const updateIncident = (id: string, body: UpdateIncidentRequest, version: number) =>
  apiFetch<IncidentRecord>(`/v1/incidents/${id}`, { method: 'PATCH', body, version });
