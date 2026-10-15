// packages/contracts/src/import-export.ts — owner: Platform Squad (MOD-IMP, TASK-413)
import { z } from 'zod';

export const IMPORT_BATCH_STATUSES = [
  'UPLOADED',
  'PARSED',
  'MAPPED',
  'VALIDATING',
  'READY',
  'COMMITTING',
  'COMPLETED',
  'FAILED',
  'ROLLED_BACK',
] as const;
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

export const TARGET_ENTITY_TYPES = ['LEAD', 'CUSTOMER'] as const;
export type TargetEntityType = (typeof TARGET_ENTITY_TYPES)[number];

export const IMPORT_FILE_FORMATS = ['CSV', 'XLSX'] as const;
export type ImportFileFormat = (typeof IMPORT_FILE_FORMATS)[number];

export interface ImportErrorDetail {
  rowNumber: number;
  field?: string;
  issue: string;
  message: string;
  rawValue?: unknown;
}

export interface ImportBatch {
  id: string;
  tenantId: string;
  requesterId: string;
  targetEntity: TargetEntityType;
  sourceFileKey: string;
  fileFormat: ImportFileFormat;
  fileSizeBytes: number;
  checksumSha256: string;
  idempotencyKey?: string | null;
  columnMapping: Record<string, string>;
  importOptions: Record<string, unknown>;
  status: ImportBatchStatus;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  importedRows: number;
  reportFileKey?: string | null;
  errorSummary: ImportErrorDetail[];
  previewData: Record<string, unknown>[];
  createdAt: string;
  updatedAt: string;
  committedAt?: string | null;
  rolledBackAt?: string | null;
  expiresAt: string;
  lockVersion: number;
}

export const CreateImportSchema = z.object({
  targetEntity: z.enum(TARGET_ENTITY_TYPES),
  fileFormat: z.enum(IMPORT_FILE_FORMATS).default('CSV'),
  filename: z.string().min(1).max(255),
  contentBase64: z.string().min(1).optional(),
});
export type CreateImportDto = z.infer<typeof CreateImportSchema>;

export const ConfigureMappingSchema = z.object({
  columnMapping: z.record(z.string().min(1)),
});
export type ConfigureMappingDto = z.infer<typeof ConfigureMappingSchema>;

export const CommitImportSchema = z.object({
  importOptions: z.record(z.unknown()).default({}),
});
export type CommitImportDto = z.infer<typeof CommitImportSchema>;

export const RollbackImportSchema = z.object({
  reason: z.string().min(3).max(500),
});
export type RollbackImportDto = z.infer<typeof RollbackImportSchema>;

// Export Contracts
import type { ExportStatus } from './reporting';
export const EXPORT_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] as const;

export const EXPORT_FORMATS = ['CSV', 'XLSX', 'JSON'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_SCOPE_TYPES = ['TENANT', 'BRANCH', 'USER'] as const;
export type ExportScopeType = (typeof EXPORT_SCOPE_TYPES)[number];

export interface ExportJob {
  id: string;
  tenantId: string;
  requesterId: string;
  scopeType: ExportScopeType;
  scopeId: string | null;
  exportType: string;
  fileFormat: ExportFormat;
  filters: Record<string, unknown>;
  rowCount: number;
  fileKey: string | null;
  status: ExportStatus;
  downloadUrl: string | null;
  expiresAt: string;
  downloadedAt: string | null;
  createdAt: string;
}

export const CreateExportJobSchema = z.object({
  exportType: z.string().min(2).max(50),
  fileFormat: z.enum(EXPORT_FORMATS).default('CSV'),
  filters: z.record(z.unknown()).default({}),
  scopeType: z.enum(EXPORT_SCOPE_TYPES).default('TENANT'),
  scopeId: z.string().optional().nullable(),
});
export type CreateExportJobDto = z.infer<typeof CreateExportJobSchema>;
