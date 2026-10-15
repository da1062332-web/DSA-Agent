// apps/web/src/features/performance/types.ts — Performance & Reporting UI Types
import type {
  CanonicalMetricCode,
  DimensionType,
  LeaderboardDashboardDto,
  MetricResultDto,
  MetricsQueryResponse,
  TeamPerformanceDashboardDto,
} from '@dsa/contracts';

export type {
  CanonicalMetricCode,
  DimensionType,
  LeaderboardDashboardDto,
  MetricResultDto,
  MetricsQueryResponse,
  TeamPerformanceDashboardDto,
};

export interface DashboardFilterState {
  period: string;
  branchId?: string;
  userId?: string;
  productId?: string;
}

