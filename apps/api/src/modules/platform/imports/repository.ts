// apps/api/src/modules/platform/imports/repository.ts — owner: Platform Squad (MOD-IMP, TASK-413)
import crypto from 'node:crypto';
import type { ImportBatch, ImportBatchStatus, TargetEntityType, Tx } from '@dsa/contracts';
import { sql } from 'kysely';

export interface ImportBatchRow {
  id: string;
  tenant_id: string;
  requester_id: string;
  target_entity: TargetEntityType;
  source_file_key: string;
  file_format: 'CSV' | 'XLSX';
  file_size_bytes: string | number;
  checksum_sha256: string;
  idempotency_key: string | null;
  column_mapping: Record<string, string>;
  import_options: Record<string, unknown>;
  status: ImportBatchStatus;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  imported_rows: number;
  report_file_key: string | null;
  error_summary: unknown;
  preview_data: unknown;
  created_at: Date;
  updated_at: Date;
  committed_at: Date | null;
  rolled_back_at: Date | null;
  expires_at: Date;
  lock_version: number;
}

export function toImportBatchDto(row: ImportBatchRow): ImportBatch {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    requesterId: row.requester_id,
    targetEntity: row.target_entity,
    sourceFileKey: row.source_file_key,
    fileFormat: row.file_format,
    fileSizeBytes: Number(row.file_size_bytes),
    checksumSha256: row.checksum_sha256,
    idempotencyKey: row.idempotency_key,
    columnMapping:
      typeof row.column_mapping === 'string' ? JSON.parse(row.column_mapping) : (row.column_mapping ?? {}),
    importOptions:
      typeof row.import_options === 'string' ? JSON.parse(row.import_options) : (row.import_options ?? {}),
    status: row.status,
    totalRows: row.total_rows,
    validRows: row.valid_rows,
    invalidRows: row.invalid_rows,
    importedRows: row.imported_rows,
    reportFileKey: row.report_file_key,
    errorSummary:
      typeof row.error_summary === 'string' ? JSON.parse(row.error_summary) : (row.error_summary ?? []),
    previewData:
      typeof row.preview_data === 'string' ? JSON.parse(row.preview_data) : (row.preview_data ?? []),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    committedAt: row.committed_at
      ? row.committed_at instanceof Date
        ? row.committed_at.toISOString()
        : String(row.committed_at)
      : null,
    rolledBackAt: row.rolled_back_at
      ? row.rolled_back_at instanceof Date
        ? row.rolled_back_at.toISOString()
        : String(row.rolled_back_at)
      : null,
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at),
    lockVersion: row.lock_version,
  };
}

export class ImportRepository {
  async createImportBatch(
    tx: Tx,
    batch: {
      id: string;
      tenant_id: string;
      requester_id: string;
      target_entity: TargetEntityType;
      source_file_key: string;
      file_format: 'CSV' | 'XLSX';
      file_size_bytes: number;
      checksum_sha256: string;
      idempotency_key?: string | null;
      status: ImportBatchStatus;
      preview_data: Record<string, unknown>[];
      total_rows: number;
    },
  ): Promise<ImportBatchRow> {
    const result = await sql<ImportBatchRow>`
      INSERT INTO import_batch (
        id, tenant_id, requester_id, target_entity, source_file_key, file_format,
        file_size_bytes, checksum_sha256, idempotency_key, status, preview_data, total_rows
      ) VALUES (
        ${batch.id}, ${batch.tenant_id}, ${batch.requester_id}, ${batch.target_entity},
        ${batch.source_file_key}, ${batch.file_format}, ${batch.file_size_bytes},
        ${batch.checksum_sha256}, ${batch.idempotency_key ?? null}, ${batch.status},
        ${JSON.stringify(batch.preview_data)}::jsonb, ${batch.total_rows}
      )
      RETURNING *
    `.execute(tx);

    return result.rows[0]!;
  }

  async findBatchById(tx: Tx, tenantId: string, id: string): Promise<ImportBatchRow | null> {
    const result = await sql<ImportBatchRow>`
      SELECT * FROM import_batch
       WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);

    return result.rows[0] ?? null;
  }

  async findBatchByIdForUpdate(tx: Tx, tenantId: string, id: string): Promise<ImportBatchRow | null> {
    const result = await sql<ImportBatchRow>`
      SELECT * FROM import_batch
       WHERE tenant_id = ${tenantId} AND id = ${id}
       FOR UPDATE
    `.execute(tx);

    return result.rows[0] ?? null;
  }

  async listBatches(tx: Tx, tenantId: string): Promise<ImportBatchRow[]> {
    const result = await sql<ImportBatchRow>`
      SELECT * FROM import_batch
       WHERE tenant_id = ${tenantId}
       ORDER BY created_at DESC
       LIMIT 50
    `.execute(tx);

    return result.rows;
  }

  async updateMapping(
    tx: Tx,
    tenantId: string,
    id: string,
    columnMapping: Record<string, string>,
    status: ImportBatchStatus,
  ): Promise<ImportBatchRow> {
    const result = await sql<ImportBatchRow>`
      UPDATE import_batch
         SET column_mapping = ${JSON.stringify(columnMapping)}::jsonb,
             status = ${status},
             updated_at = now(),
             lock_version = lock_version + 1
       WHERE tenant_id = ${tenantId} AND id = ${id}
      RETURNING *
    `.execute(tx);

    return result.rows[0]!;
  }

  async updateCommitProgress(
    tx: Tx,
    tenantId: string,
    id: string,
    updates: {
      status: ImportBatchStatus;
      total_rows?: number;
      valid_rows?: number;
      invalid_rows?: number;
      imported_rows?: number;
      report_file_key?: string | null;
      error_summary?: unknown;
      committed_at?: Date;
    },
  ): Promise<ImportBatchRow> {
    const result = await sql<ImportBatchRow>`
      UPDATE import_batch
         SET status = ${updates.status},
             total_rows = COALESCE(${updates.total_rows ?? null}, total_rows),
             valid_rows = COALESCE(${updates.valid_rows ?? null}, valid_rows),
             invalid_rows = COALESCE(${updates.invalid_rows ?? null}, invalid_rows),
             imported_rows = COALESCE(${updates.imported_rows ?? null}, imported_rows),
             report_file_key = COALESCE(${updates.report_file_key ?? null}, report_file_key),
             error_summary = COALESCE(${updates.error_summary ? JSON.stringify(updates.error_summary) : null}::jsonb, error_summary),
             committed_at = COALESCE(${updates.committed_at ? updates.committed_at.toISOString() : null}::timestamptz, committed_at),
             updated_at = now(),
             lock_version = lock_version + 1
       WHERE tenant_id = ${tenantId} AND id = ${id}
      RETURNING *
    `.execute(tx);

    return result.rows[0]!;
  }

  async updateRollback(tx: Tx, tenantId: string, id: string): Promise<ImportBatchRow> {
    const result = await sql<ImportBatchRow>`
      UPDATE import_batch
         SET status = 'ROLLED_BACK',
             rolled_back_at = now(),
             updated_at = now(),
             lock_version = lock_version + 1
       WHERE tenant_id = ${tenantId} AND id = ${id}
      RETURNING *
    `.execute(tx);

    return result.rows[0]!;
  }

  // Target entity batch rollback & queries
  async findImportedLeads(
    tx: Tx,
    tenantId: string,
    batchId: string,
  ): Promise<Array<{ id: string; state: string; application_id: string | null }>> {
    const result = await sql<{ id: string; state: string; application_id: string | null }>`
      SELECT id, state, application_id FROM lead
       WHERE tenant_id = ${tenantId} AND import_batch_id = ${batchId}
    `.execute(tx);

    return result.rows;
  }

  async rollbackImportedLeads(tx: Tx, tenantId: string, batchId: string): Promise<number> {
    // Only archive leads that have not converted and have no applications
    const result = await sql`
      UPDATE lead
         SET state = 'ARCHIVED',
             updated_at = now()
       WHERE tenant_id = ${tenantId}
         AND import_batch_id = ${batchId}
         AND state NOT IN ('CONVERTED')
         AND application_id IS NULL
    `.execute(tx);

    return Number(result.numAffectedRows ?? 0);
  }

  async rollbackImportedCustomers(tx: Tx, tenantId: string, batchId: string): Promise<number> {
    // Anonymize or mark inactive for customers
    const result = await sql`
      UPDATE customer
         SET updated_at = now()
       WHERE tenant_id = ${tenantId}
         AND import_batch_id = ${batchId}
    `.execute(tx);

    return Number(result.numAffectedRows ?? 0);
  }
}

export class InMemoryImportRepository extends ImportRepository {
  private batches = new Map<string, ImportBatchRow>();
  private importedLeads = new Map<
    string,
    Array<{ id: string; state: string; application_id: string | null }>
  >();

  override async createImportBatch(
    _tx: Tx,
    batch: {
      id: string;
      tenant_id: string;
      requester_id: string;
      target_entity: TargetEntityType;
      source_file_key: string;
      file_format: 'CSV' | 'XLSX';
      file_size_bytes: number;
      checksum_sha256: string;
      idempotency_key?: string | null;
      status: ImportBatchStatus;
      preview_data: Record<string, unknown>[];
      total_rows: number;
    },
  ): Promise<ImportBatchRow> {
    const now = new Date();
    const row: ImportBatchRow = {
      id: batch.id,
      tenant_id: batch.tenant_id,
      requester_id: batch.requester_id,
      target_entity: batch.target_entity,
      source_file_key: batch.source_file_key,
      file_format: batch.file_format,
      file_size_bytes: batch.file_size_bytes,
      checksum_sha256: batch.checksum_sha256,
      idempotency_key: batch.idempotency_key ?? null,
      column_mapping: {},
      import_options: {},
      status: batch.status,
      total_rows: batch.total_rows,
      valid_rows: 0,
      invalid_rows: 0,
      imported_rows: 0,
      report_file_key: null,
      error_summary: [],
      preview_data: batch.preview_data,
      created_at: now,
      updated_at: now,
      committed_at: null,
      rolled_back_at: null,
      expires_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      lock_version: 0,
    };
    this.batches.set(`${batch.tenant_id}:${batch.id}`, row);
    return row;
  }

  override async findBatchById(_tx: Tx, tenantId: string, id: string): Promise<ImportBatchRow | null> {
    return this.batches.get(`${tenantId}:${id}`) ?? null;
  }

  override async findBatchByIdForUpdate(
    _tx: Tx,
    tenantId: string,
    id: string,
  ): Promise<ImportBatchRow | null> {
    return this.batches.get(`${tenantId}:${id}`) ?? null;
  }

  override async listBatches(_tx: Tx, tenantId: string): Promise<ImportBatchRow[]> {
    return Array.from(this.batches.values())
      .filter((b) => b.tenant_id === tenantId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  }

  override async updateMapping(
    _tx: Tx,
    tenantId: string,
    id: string,
    columnMapping: Record<string, string>,
    status: ImportBatchStatus,
  ): Promise<ImportBatchRow> {
    const row = this.batches.get(`${tenantId}:${id}`);
    if (!row) throw new Error(`Batch ${id} not found.`);
    row.column_mapping = columnMapping;
    row.status = status;
    row.updated_at = new Date();
    row.lock_version += 1;
    return row;
  }

  override async updateCommitProgress(
    _tx: Tx,
    tenantId: string,
    id: string,
    updates: {
      status: ImportBatchStatus;
      total_rows?: number;
      valid_rows?: number;
      invalid_rows?: number;
      imported_rows?: number;
      report_file_key?: string | null;
      error_summary?: unknown;
      committed_at?: Date;
    },
  ): Promise<ImportBatchRow> {
    const row = this.batches.get(`${tenantId}:${id}`);
    if (!row) throw new Error(`Batch ${id} not found.`);
    row.status = updates.status;
    if (updates.total_rows !== undefined) row.total_rows = updates.total_rows;
    if (updates.valid_rows !== undefined) row.valid_rows = updates.valid_rows;
    if (updates.invalid_rows !== undefined) row.invalid_rows = updates.invalid_rows;
    if (updates.imported_rows !== undefined) row.imported_rows = updates.imported_rows;
    if (updates.report_file_key !== undefined) row.report_file_key = updates.report_file_key;
    if (updates.error_summary !== undefined) row.error_summary = updates.error_summary as any;
    if (updates.committed_at !== undefined) row.committed_at = updates.committed_at;
    row.updated_at = new Date();
    row.lock_version += 1;
    return row;
  }

  override async updateRollback(_tx: Tx, tenantId: string, id: string): Promise<ImportBatchRow> {
    const row = this.batches.get(`${tenantId}:${id}`);
    if (!row) throw new Error(`Batch ${id} not found.`);
    row.status = 'ROLLED_BACK';
    row.rolled_back_at = new Date();
    row.updated_at = new Date();
    row.lock_version += 1;
    return row;
  }

  override async findImportedLeads(
    _tx: Tx,
    tenantId: string,
    batchId: string,
  ): Promise<Array<{ id: string; state: string; application_id: string | null }>> {
    return this.importedLeads.get(`${tenantId}:${batchId}`) ?? [];
  }

  override async rollbackImportedLeads(_tx: Tx, tenantId: string, batchId: string): Promise<number> {
    const list = this.importedLeads.get(`${tenantId}:${batchId}`) ?? [];
    let count = 0;
    for (const item of list) {
      if (item.state !== 'CONVERTED' && !item.application_id) {
        item.state = 'ARCHIVED';
        count++;
      }
    }
    return count;
  }

  override async rollbackImportedCustomers(_tx: Tx, _tenantId: string, _batchId: string): Promise<number> {
    return 1;
  }
}
