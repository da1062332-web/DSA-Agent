// apps/web/src/features/reporting/api.ts — TanStack Query Hooks for MOD-RPT Reporting & Analytics
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client';
import type {
  BranchDashboardDto,
  ConnectorDashboardDto,
  ControlTotalsDto,
  CreateExportDto,
  CreateReportRunDto,
  CreateReportScheduleDto,
  ExecutiveDashboardDto,
  ExportJobDto,
  FinanceDashboardDto,
  MetricDefinitionDto,
  OperationsDashboardDto,
  ReportCatalogueItem,
  ReportRunDto,
  ReportScheduleDto,
} from '@dsa/contracts';

// ==========================================
// SUB-RPT.01: Metric Registry
// ==========================================
export function useMetricDefinitions() {
  return useQuery<{ data: MetricDefinitionDto[] }>({
    queryKey: ['reporting', 'metric-definitions'],
    queryFn: () => apiFetch<{ data: MetricDefinitionDto[] }>('/v1/metric-definitions'),
  });
}

// ==========================================
// SUB-RPT.02: Control Totals & Projections
// ==========================================
export function useControlTotals(summaryDate: string) {
  return useQuery<ControlTotalsDto>({
    queryKey: ['reporting', 'control-totals', summaryDate],
    queryFn: () =>
      apiFetch<ControlTotalsDto>('/v1/reporting/control-totals', {
        query: { summaryDate },
      }),
  });
}

export function useRefreshProjections() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dates: { startDate: string; endDate: string }) =>
      apiFetch<{ status: string; message: string; refreshedAt: string }>('/v1/reporting/refresh', {
        method: 'POST',
        body: JSON.stringify(dates),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reporting'] });
      queryClient.invalidateQueries({ queryKey: ['performance-dashboard'] });
    },
  });
}

// ==========================================
// SUB-RPT.03: Multi-Category Dashboards
// ==========================================
export function useExecutiveDashboard(period: string) {
  return useQuery<ExecutiveDashboardDto>({
    queryKey: ['reporting', 'dashboard', 'EXECUTIVE', period],
    queryFn: () =>
      apiFetch<ExecutiveDashboardDto>('/v1/dashboards/EXECUTIVE', {
        query: { period },
      }),
  });
}

export function useBranchDashboard(period: string, branchId?: string) {
  return useQuery<BranchDashboardDto>({
    queryKey: ['reporting', 'dashboard', 'BRANCH', period, branchId],
    queryFn: () =>
      apiFetch<BranchDashboardDto>('/v1/dashboards/BRANCH', {
        query: { period, branchId: branchId || undefined },
      }),
  });
}

export function useOperationsDashboard(period: string) {
  return useQuery<OperationsDashboardDto>({
    queryKey: ['reporting', 'dashboard', 'OPERATIONS', period],
    queryFn: () =>
      apiFetch<OperationsDashboardDto>('/v1/dashboards/OPERATIONS', {
        query: { period },
      }),
  });
}

export function useFinanceDashboard(period: string) {
  return useQuery<FinanceDashboardDto>({
    queryKey: ['reporting', 'dashboard', 'FINANCE', period],
    queryFn: () =>
      apiFetch<FinanceDashboardDto>('/v1/dashboards/FINANCE', {
        query: { period },
      }),
  });
}

export function useConnectorDashboard(period: string) {
  return useQuery<ConnectorDashboardDto>({
    queryKey: ['reporting', 'dashboard', 'CONNECTOR', period],
    queryFn: () =>
      apiFetch<ConnectorDashboardDto>('/v1/dashboards/CONNECTOR', {
        query: { period },
      }),
  });
}

// ==========================================
// SUB-RPT.04: Report Catalogue & Runs
// ==========================================
export function useReportCatalogue() {
  return useQuery<{ data: ReportCatalogueItem[] }>({
    queryKey: ['reporting', 'catalogue'],
    queryFn: () => apiFetch<{ data: ReportCatalogueItem[] }>('/v1/reports'),
  });
}

export function useReportRuns() {
  return useQuery<{ data: ReportRunDto[] }>({
    queryKey: ['reporting', 'runs'],
    queryFn: () => apiFetch<{ data: ReportRunDto[] }>('/v1/report-runs'),
  });
}

export function useStartReportRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ code, dto }: { code: string; dto: CreateReportRunDto }) =>
      apiFetch<ReportRunDto>(`/v1/reports/${encodeURIComponent(code)}/runs`, {
        method: 'POST',
        body: dto,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reporting', 'runs'] });
    },
  });
}

// ==========================================
// SUB-RPT.05: Exports & Schedules
// ==========================================
export function useExports() {
  return useQuery<{ data: ExportJobDto[] }>({
    queryKey: ['reporting', 'exports'],
    queryFn: () => apiFetch<{ data: ExportJobDto[] }>('/v1/exports'),
  });
}

export function useCreateExport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateExportDto) =>
      apiFetch<ExportJobDto>('/v1/exports', {
        method: 'POST',
        body: dto,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reporting', 'exports'] });
    },
  });
}

export function useReportSchedules() {
  return useQuery<{ data: ReportScheduleDto[] }>({
    queryKey: ['reporting', 'schedules'],
    queryFn: () => apiFetch<{ data: ReportScheduleDto[] }>('/v1/report-schedules'),
  });
}

export function useCreateReportSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateReportScheduleDto) =>
      apiFetch<ReportScheduleDto>('/v1/report-schedules', {
        method: 'POST',
        body: dto,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reporting', 'schedules'] });
    },
  });
}

export function useDeleteReportSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/v1/report-schedules/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reporting', 'schedules'] });
    },
  });
}
