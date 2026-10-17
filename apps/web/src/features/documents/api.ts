// apps/web/src/features/documents/api.ts — API-APP-007 (owner: Dev 3, MOD-DOC checklist slice).
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client';
import type { ChecklistResponse } from './model';

export const getChecklist = (applicationId: string) =>
  apiFetch<ChecklistResponse>(`/v1/applications/${encodeURIComponent(applicationId)}/checklist`);

export function useChecklist(applicationId: string | null) {
  return useQuery({
    queryKey: ['application-checklist', applicationId],
    queryFn: () => getChecklist(applicationId!),
    enabled: !!applicationId,
  });
}
