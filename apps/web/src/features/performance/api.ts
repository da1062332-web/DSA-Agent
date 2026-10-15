// apps/web/src/features/performance/api.ts — API hooks for Performance Dashboards & Leaderboards
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client';
import type {
  DashboardFilterState,
  LeaderboardDashboardDto,
  MetricsQueryResponse,
  TeamPerformanceDashboardDto,
} from './types';

export function useTeamPerformanceDashboard(filters: DashboardFilterState) {
  return useQuery<TeamPerformanceDashboardDto>({
    queryKey: ['performance-dashboard', filters],
    queryFn: () =>
      apiFetch<TeamPerformanceDashboardDto>('/v1/dashboards/TEAM_PERFORMANCE', {
        query: {
          period: filters.period,
          branchId: filters.branchId || undefined,
          userId: filters.userId || undefined,
          productId: filters.productId || undefined,
        },
      }),
  });
}

export function useLeaderboardDashboard(filters: DashboardFilterState) {
  return useQuery<LeaderboardDashboardDto>({
    queryKey: ['leaderboard-dashboard', filters],
    queryFn: () =>
      apiFetch<LeaderboardDashboardDto>('/v1/dashboards/LEADERBOARD', {
        query: {
          period: filters.period,
          branchId: filters.branchId || undefined,
          userId: filters.userId || undefined,
        },
      }),
  });
}

export function useMetrics(filters: DashboardFilterState & { metricCodes?: string[] }) {
  return useQuery<MetricsQueryResponse>({
    queryKey: ['metrics', filters],
    queryFn: () =>
      apiFetch<MetricsQueryResponse>('/v1/metrics', {
        query: {
          period: filters.period,
          metricCodes: filters.metricCodes ? filters.metricCodes.join(',') : undefined,
          branchId: filters.branchId || undefined,
          userId: filters.userId || undefined,
          productId: filters.productId || undefined,
        },
      }),
  });
}
