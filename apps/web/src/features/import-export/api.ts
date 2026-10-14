// apps/web/src/features/import-export/api.ts — owner: Platform Squad (MOD-IMP, TASK-413)
import type {
  CommitImportDto,
  ConfigureMappingDto,
  CreateExportJobDto,
  CreateImportDto,
  ExportJob,
  ImportBatch,
  RollbackImportDto,
} from '@dsa/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client';

export function useImportBatches() {
  return useQuery({
    queryKey: ['imports'],
    queryFn: async () => {
      const res = await apiFetch<{ data: ImportBatch[] }>('/v1/imports');
      return res.data;
    },
  });
}

export function useImportBatch(id: string | null) {
  return useQuery({
    queryKey: ['imports', id],
    queryFn: async () => {
      if (!id) return null;
      return apiFetch<ImportBatch>(`/v1/imports/${id}`);
    },
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && (data.status === 'COMMITTING' || data.status === 'VALIDATING')) {
        return 1000;
      }
      return false;
    },
  });
}

export function useCreateImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateImportDto) =>
      apiFetch<ImportBatch>('/v1/imports', {
        method: 'POST',
        body: dto,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['imports'] });
    },
  });
}

export function useConfigureMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: ConfigureMappingDto }) =>
      apiFetch<ImportBatch>(`/v1/imports/${id}/mapping`, {
        method: 'POST',
        body: dto,
      }),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['imports', variables.id] });
      qc.invalidateQueries({ queryKey: ['imports'] });
    },
  });
}

export function useCommitImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto?: CommitImportDto }) =>
      apiFetch<ImportBatch>(`/v1/imports/${id}/commit`, {
        method: 'POST',
        body: dto ?? {},
      }),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['imports', variables.id] });
      qc.invalidateQueries({ queryKey: ['imports'] });
    },
  });
}

export function useRollbackImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: RollbackImportDto }) =>
      apiFetch<ImportBatch>(`/v1/imports/${id}/rollback`, {
        method: 'POST',
        body: dto,
      }),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['imports', variables.id] });
      qc.invalidateQueries({ queryKey: ['imports'] });
    },
  });
}

export function useExportJobs() {
  return useQuery({
    queryKey: ['exports'],
    queryFn: async () => {
      const res = await apiFetch<{ data: ExportJob[] }>('/v1/exports');
      return res.data;
    },
  });
}

export function useCreateExportJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateExportJobDto) =>
      apiFetch<ExportJob>('/v1/exports', {
        method: 'POST',
        body: dto,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exports'] });
    },
  });
}
