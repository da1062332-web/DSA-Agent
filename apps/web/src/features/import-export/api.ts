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
import { apiFetch, ApiError } from '../../api/client';

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

// ============================================================
// P1-07: the lender's saved MIS sheet mapping
// ============================================================

export interface LenderMisMapping {
  id: string;
  lenderId: string;
  columnMap: Record<string, string>;
  statusMap: Record<string, string>;
  dateFormat: string;
  version: number;
  lastImportAt: string | null;
  lockVersion: number;
  createdAt: string;
  createdBy: string;
}

export interface SaveLenderMisMappingInput {
  columnMap: Record<string, string>;
  statusMap: Record<string, string>;
  dateFormat: string;
}

/** Null when the lender has no mapping yet, which is a different thing from an empty one. */
export async function fetchLenderMisMapping(lenderId: string): Promise<LenderMisMapping | null> {
  try {
    return await apiFetch<LenderMisMapping>(`/v1/lenders/${encodeURIComponent(lenderId)}/mis-mapping`);
  } catch (err) {
    if (err instanceof ApiError && err.httpStatus === 404) return null;
    throw err;
  }
}

export async function saveLenderMisMapping(
  lenderId: string,
  input: SaveLenderMisMappingInput,
): Promise<LenderMisMapping> {
  return apiFetch<LenderMisMapping>(`/v1/lenders/${encodeURIComponent(lenderId)}/mis-mapping`, {
    method: 'PUT',
    body: input,
  });
}

export function useLenderMisMapping(lenderId: string | null) {
  return useQuery({
    queryKey: ['lender-mis-mapping', lenderId],
    queryFn: () => fetchLenderMisMapping(lenderId!),
    enabled: Boolean(lenderId),
  });
}

export function useSaveLenderMisMapping() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ lenderId, input }: { lenderId: string; input: SaveLenderMisMappingInput }) =>
      saveLenderMisMapping(lenderId, input),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['lender-mis-mapping', vars.lenderId] });
    },
  });
}
