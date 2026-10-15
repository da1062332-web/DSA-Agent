// apps/web/src/features/targets/api.ts — owner: Dev 5 (MOD-PERF Targets)
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, newIdempotencyKey } from '../../api/client';
import type {
  ApproveTargetRequest,
  CreateTargetRequest,
  TargetDto,
  TargetListQuery,
  TargetListResponse,
} from './types';

export function useTargets(query: Partial<TargetListQuery>) {
  return useQuery<TargetListResponse>({
    queryKey: ['targets', query],
    queryFn: () =>
      apiFetch<TargetListResponse>('/v1/targets', {
        query: {
          period: query.period || undefined,
          dimensionType: query.dimensionType || undefined,
          dimensionId: query.dimensionId || undefined,
          metricCode: query.metricCode || undefined,
          status: query.status || undefined,
          limit: query.limit || 20,
          cursor: query.cursor || undefined,
        },
      }),
  });
}

export function useTargetHistory(targetId: string | null) {
  return useQuery<TargetListResponse>({
    queryKey: ['target-history', targetId],
    queryFn: () => apiFetch<TargetListResponse>(`/v1/targets/${targetId}/history`),
    enabled: Boolean(targetId),
  });
}

export function useCreateTarget() {
  const queryClient = useQueryClient();
  return useMutation<TargetDto, Error, CreateTargetRequest>({
    meta: { successMessage: 'Target created.' },
    mutationFn: (body) =>
      apiFetch<TargetDto>('/v1/targets', {
        method: 'POST',
        body,
        idempotencyKey: newIdempotencyKey(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['targets'] });
    },
  });
}

export function useApproveTarget() {
  const queryClient = useQueryClient();
  return useMutation<
    TargetDto,
    Error,
    { id: string; version: number; input: ApproveTargetRequest }
  >({
    meta: { successMessage: 'Target approved.' },
    mutationFn: ({ id, version, input }) =>
      apiFetch<TargetDto>(`/v1/targets/${id}/approval`, {
        method: 'POST',
        version,
        body: input,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['targets'] });
      queryClient.invalidateQueries({ queryKey: ['target-history'] });
    },
  });
}
