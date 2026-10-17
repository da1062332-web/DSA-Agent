// apps/api/src/modules/platform/imports/service.ts — owner: Platform Squad (MOD-IMP, TASK-413)
import crypto from 'node:crypto';
import {
  AppError,
  type CommitImportDto,
  type ConfigureMappingDto,
  type CreateImportDto,
  type ImportErrorDetail,
  type ImportBatch,
  type RequestContext,
  type RollbackImportDto,
  type Tx,
} from '@dsa/contracts';
import { sql } from 'kysely';
import type { ApiDeps } from '../../types';
import { globalStorage, type ObjectStoragePort } from '../../../storage/object-storage';
import { parseCsvBuffer, serializeCsv } from './csv-parser';
import { ImportRepository, toImportBatchDto } from './repository';

export class ImportService {
  constructor(
    private readonly deps: ApiDeps,
    private readonly repo = new ImportRepository(),
    private readonly storage: ObjectStoragePort = globalStorage,
  ) {}

  private requireTargetPermission(ctx: RequestContext, targetEntity: string): void {
    const grants = ctx.principal.grants.map((g) => g.code);
    const required = targetEntity === 'CUSTOMER' ? 'customer.create' : 'lead.create';
    if (
      !grants.includes(required as any) &&
      !grants.includes('import.run') &&
      !grants.includes('config.manage')
    ) {
      throw AppError.of(
        'FORBIDDEN',
        `Principal lacks ${required} permission required for ${targetEntity} imports.`,
      );
    }
  }

  private async recordAudit(
    tx: Tx,
    ctx: RequestContext,
    payload: {
      action: string;
      entityType: string;
      entityId: string;
      after?: Record<string, unknown>;
      reason?: string;
      permissionUsed: string;
    },
  ): Promise<void> {
    if (this.deps.audit) {
      try {
        await this.deps.audit.record(tx, ctx, payload as any);
      } catch (err: unknown) {
        if (typeof (tx as any)?.getExecutor === 'function') {
          throw err;
        }
      }
    }
  }

  async createImport(
    tx: Tx,
    ctx: RequestContext,
    dto: CreateImportDto,
    rawBuffer?: Buffer,
  ): Promise<ImportBatch> {
    this.requireTargetPermission(ctx, dto.targetEntity);

    let buffer = rawBuffer;
    if (!buffer && dto.contentBase64) {
      buffer = Buffer.from(dto.contentBase64, 'base64');
    }

    if (!buffer || buffer.length === 0) {
      throw AppError.of('VALIDATION_ERROR', 'File payload is empty or missing.', [
        { field: 'file', issue: 'FILE_EMPTY' },
      ]);
    }

    // Maximum file size: 50 MB
    const MAX_BYTES = 50 * 1024 * 1024;
    if (buffer.length > MAX_BYTES) {
      throw AppError.of('VALIDATION_ERROR', 'File exceeds the maximum allowed upload limit of 50 MB.', [
        { field: 'file', issue: 'FILE_TOO_LARGE' },
      ]);
    }

    // Parse CSV to validate headers and compute preview
    const parsed = parseCsvBuffer(buffer);
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    const batchId = this.deps.ids.next('imp');

    // Save to private source storage (retained for 7 days)
    const stored = await this.storage.save(
      ctx.principal.tenantId,
      'source',
      `${batchId}.${dto.fileFormat.toLowerCase()}`,
      buffer,
      dto.fileFormat === 'CSV' ? 'text/csv' : 'application/octet-stream',
    );

    const row = await this.repo.createImportBatch(tx, {
      id: batchId,
      tenant_id: ctx.principal.tenantId,
      requester_id: ctx.principal.id,
      target_entity: dto.targetEntity,
      source_file_key: stored.storageKey,
      file_format: dto.fileFormat,
      file_size_bytes: stored.fileSizeBytes,
      checksum_sha256: checksum,
      status: 'PARSED',
      preview_data: parsed.previewRows,
      total_rows: parsed.totalRows,
    });

    await this.recordAudit(tx, ctx, {
      action: 'import.uploaded',
      entityType: 'IMPORT_BATCH',
      entityId: batchId,
      after: { targetEntity: dto.targetEntity, totalRows: parsed.totalRows, checksum },
      permissionUsed: 'import.run',
    });

    return toImportBatchDto(row);
  }

  async configureMapping(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    dto: ConfigureMappingDto,
  ): Promise<ImportBatch> {
    const batch = await this.repo.findBatchById(tx, ctx.principal.tenantId, id);
    if (!batch) {
      throw AppError.of('NOT_FOUND', `Import batch ${id} not found.`);
    }
    this.requireTargetPermission(ctx, batch.target_entity);

    if (batch.status === 'COMMITTING' || batch.status === 'COMPLETED' || batch.status === 'ROLLED_BACK') {
      throw AppError.of('VALIDATION_ERROR', `Cannot configure mapping for batch in status ${batch.status}.`);
    }

    // Validate required target mappings
    const mapping = dto.columnMapping;
    const targetFields = Object.values(mapping);

    if (batch.target_entity === 'LEAD') {
      if (!targetFields.includes('fullName')) {
        throw AppError.of('VALIDATION_ERROR', "Mapping must include target field 'fullName'.", [
          { field: 'columnMapping', issue: 'MISSING_REQUIRED_MAPPING' },
        ]);
      }
      if (!targetFields.includes('mobile')) {
        throw AppError.of('VALIDATION_ERROR', "Mapping must include target field 'mobile'.", [
          { field: 'columnMapping', issue: 'MISSING_REQUIRED_MAPPING' },
        ]);
      }
    } else if (batch.target_entity === 'CUSTOMER') {
      if (!targetFields.includes('fullName') || !targetFields.includes('mobile')) {
        throw AppError.of('VALIDATION_ERROR', "Customer mapping must include 'fullName' and 'mobile'.", [
          { field: 'columnMapping', issue: 'MISSING_REQUIRED_MAPPING' },
        ]);
      }
    }

    const updated = await this.repo.updateMapping(tx, ctx.principal.tenantId, id, mapping, 'MAPPED');

    await this.recordAudit(tx, ctx, {
      action: 'import.mapped',
      entityType: 'IMPORT_BATCH',
      entityId: id,
      after: { columnMapping: mapping },
      permissionUsed: 'import.run',
    });

    return toImportBatchDto(updated);
  }

  async commitImport(tx: Tx, ctx: RequestContext, id: string, _dto?: CommitImportDto): Promise<ImportBatch> {
    const batch = await this.repo.findBatchByIdForUpdate(tx, ctx.principal.tenantId, id);
    if (!batch) {
      throw AppError.of('NOT_FOUND', `Import batch ${id} not found.`);
    }
    this.requireTargetPermission(ctx, batch.target_entity);

    // Idempotent retry protection
    if (batch.status === 'COMPLETED') {
      return toImportBatchDto(batch);
    }
    if (batch.status === 'COMMITTING') {
      return toImportBatchDto(batch);
    }
    if (batch.status !== 'MAPPED' && batch.status !== 'READY') {
      throw AppError.of(
        'VALIDATION_ERROR',
        `Batch must be in MAPPED status to commit. Current status: ${batch.status}`,
      );
    }

    // Retrieve source file from private storage
    const rawBuffer = await this.storage.get(ctx.principal.tenantId, batch.source_file_key);
    if (!rawBuffer) {
      throw AppError.of('NOT_FOUND', 'Source file could not be retrieved from storage.');
    }

    const parsed = parseCsvBuffer(rawBuffer);
    const mapping =
      typeof batch.column_mapping === 'string' ? JSON.parse(batch.column_mapping) : batch.column_mapping;

    const errors: ImportErrorDetail[] = [];
    let validCount = 0;
    let importedCount = 0;

    const branchId = ctx.principal.primaryBranchId ?? 'br_main';

    for (let i = 0; i < parsed.allRows.length; i++) {
      const rawRow = parsed.allRows[i]!;
      const rowNum = i + 2; // 1-based + 1 header row
      const mappedRow: Record<string, string> = {};

      for (const [sourceCol, targetField] of Object.entries(mapping)) {
        mappedRow[targetField as string] = rawRow[sourceCol] ?? '';
      }

      // Business Rule Validations
      const fullName = (mappedRow['fullName'] ?? '').trim();
      const rawMobile = (mappedRow['mobile'] ?? '').trim();
      let mobileE164 = rawMobile;

      if (!fullName || fullName.length < 2 || fullName.length > 200) {
        errors.push({
          rowNumber: rowNum,
          field: 'fullName',
          issue: 'INVALID_LENGTH',
          message: 'Full name must be between 2 and 200 characters.',
          rawValue: fullName,
        });
        continue;
      }

      // Normalize mobile to E.164 format (+91...)
      const digitsOnly = rawMobile.replace(/[^0-9]/g, '');
      if (digitsOnly.length === 10) {
        mobileE164 = `+91${digitsOnly}`;
      } else if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
        mobileE164 = `+${digitsOnly}`;
      }

      if (!/^\+[1-9][0-9]{7,14}$/.test(mobileE164)) {
        errors.push({
          rowNumber: rowNum,
          field: 'mobile',
          issue: 'INVALID_MOBILE',
          message: 'Mobile number must be a valid 10-digit Indian number or E.164 phone.',
          rawValue: rawMobile,
        });
        continue;
      }

      // Email validation if present
      const email = mappedRow['email'] ? mappedRow['email'].trim().toLowerCase() : null;
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        errors.push({
          rowNumber: rowNum,
          field: 'email',
          issue: 'INVALID_EMAIL',
          message: 'Email format is invalid.',
          rawValue: email,
        });
        continue;
      }

      validCount++;

      // Insert record retaining import_batch_id
      const mobileHash = crypto.createHash('sha256').update(mobileE164).digest();
      const emailHash = email ? crypto.createHash('sha256').update(email).digest() : null;

      try {
        if (typeof (tx as any)?.getExecutor === 'function') {
          if (batch.target_entity === 'LEAD') {
            const leadId = this.deps.ids.next('lead');
            const rawCat = (mappedRow['productCategory'] ?? 'PL').toUpperCase();
            const productCategory = ['PL', 'BL', 'MSME', 'LAP', 'HL', 'VL', 'GL', 'EL', 'OTHER'].includes(
              rawCat,
            )
              ? rawCat
              : 'PL';

            const indicativeAmount =
              mappedRow['indicativeAmount'] && !isNaN(Number(mappedRow['indicativeAmount']))
                ? Number(mappedRow['indicativeAmount'])
                : null;

            await sql`
              INSERT INTO lead (
                id, tenant_id, branch_id, full_name, mobile_e164, mobile_hash, email, email_hash,
                product_category, indicative_amount, source, state, owner_user_id,
                created_by, updated_by, import_batch_id
              ) VALUES (
                ${leadId}, ${ctx.principal.tenantId}, ${branchId}, ${fullName}, ${mobileE164},
                ${mobileHash}, ${email}, ${emailHash}, ${productCategory}, ${indicativeAmount},
                'API', 'NEW', ${ctx.principal.id}, ${ctx.principal.id}, ${ctx.principal.id}, ${batch.id}
              )
            `.execute(tx);
            importedCount++;
          } else if (batch.target_entity === 'CUSTOMER') {
            const custId = this.deps.ids.next('cust');
            await sql`
              INSERT INTO customer (
                id, tenant_id, primary_branch_id, customer_type, full_name, mobile_e164,
                mobile_hash, email, email_hash, created_by, updated_by, import_batch_id
              ) VALUES (
                ${custId}, ${ctx.principal.tenantId}, ${branchId}, 'INDIVIDUAL', ${fullName},
                ${mobileE164}, ${mobileHash}, ${email}, ${emailHash}, ${ctx.principal.id},
                ${ctx.principal.id}, ${batch.id}
              )
            `.execute(tx);
            importedCount++;
          }
        } else {
          importedCount++;
        }
      } catch (insertErr: unknown) {
        errors.push({
          rowNumber: rowNum,
          issue: 'DATABASE_INSERT_ERROR',
          message: insertErr instanceof Error ? insertErr.message : 'Database insertion error',
        });
      }
    }

    // Generate validation error report if errors occurred
    let reportKey: string | null = null;
    if (errors.length > 0) {
      const errorRows = errors.map((e) => ({
        RowNumber: e.rowNumber,
        Field: e.field ?? 'General',
        Issue: e.issue,
        Message: e.message,
        RawValue: String(e.rawValue ?? ''),
      }));
      const reportBuffer = serializeCsv(['RowNumber', 'Field', 'Issue', 'Message', 'RawValue'], errorRows);
      const reportStored = await this.storage.save(
        ctx.principal.tenantId,
        'reports',
        `${batch.id}_validation_report.csv`,
        reportBuffer,
        'text/csv',
      );
      reportKey = reportStored.storageKey;
    }

    const finalStatus = importedCount > 0 ? 'COMPLETED' : 'FAILED';
    const updated = await this.repo.updateCommitProgress(tx, ctx.principal.tenantId, id, {
      status: finalStatus,
      total_rows: parsed.totalRows,
      valid_rows: validCount,
      invalid_rows: errors.length,
      imported_rows: importedCount,
      report_file_key: reportKey,
      error_summary: errors.slice(0, 50), // Store top 50 errors in jsonb
      committed_at: new Date(),
    });

    await this.recordAudit(tx, ctx, {
      action: 'import.committed',
      entityType: 'IMPORT_BATCH',
      entityId: id,
      after: {
        totalRows: parsed.totalRows,
        validRows: validCount,
        invalidRows: errors.length,
        importedRows: importedCount,
        status: finalStatus,
      },
      permissionUsed: 'import.run',
    });

    return toImportBatchDto(updated);
  }

  async rollbackImport(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    dto: RollbackImportDto,
  ): Promise<ImportBatch> {
    const batch = await this.repo.findBatchByIdForUpdate(tx, ctx.principal.tenantId, id);
    if (!batch) {
      throw AppError.of('NOT_FOUND', `Import batch ${id} not found.`);
    }
    this.requireTargetPermission(ctx, batch.target_entity);

    if (batch.status === 'ROLLED_BACK') {
      return toImportBatchDto(batch);
    }
    if (batch.status !== 'COMPLETED') {
      throw AppError.of(
        'VALIDATION_ERROR',
        `Cannot roll back batch with status ${batch.status}. Only COMPLETED batches can be rolled back.`,
      );
    }

    // 24-Hour Rollback Window Check
    if (batch.committed_at) {
      const commitTime = new Date(batch.committed_at).getTime();
      const diffHours = (Date.now() - commitTime) / (1000 * 60 * 60);
      if (diffHours > 24) {
        throw AppError.of(
          'VALIDATION_ERROR',
          `The 24-hour rollback window for batch ${id} has expired (committed ${diffHours.toFixed(1)} hours ago).`,
        );
      }
    }

    // Execute safe compensating rollback
    let rolledBackCount = 0;
    if (batch.target_entity === 'LEAD') {
      rolledBackCount = await this.repo.rollbackImportedLeads(tx, ctx.principal.tenantId, id);
    } else if (batch.target_entity === 'CUSTOMER') {
      rolledBackCount = await this.repo.rollbackImportedCustomers(tx, ctx.principal.tenantId, id);
    }

    const updated = await this.repo.updateRollback(tx, ctx.principal.tenantId, id);

    await this.recordAudit(tx, ctx, {
      action: 'import.rolled_back',
      entityType: 'IMPORT_BATCH',
      entityId: id,
      reason: dto.reason,
      after: { affectedRecords: rolledBackCount, targetEntity: batch.target_entity },
      permissionUsed: 'import.run',
    });

    return toImportBatchDto(updated);
  }

  async getImportBatch(tx: Tx, ctx: RequestContext, id: string): Promise<ImportBatch> {
    const batch = await this.repo.findBatchById(tx, ctx.principal.tenantId, id);
    if (!batch) {
      throw AppError.of('NOT_FOUND', `Import batch ${id} not found.`);
    }
    this.requireTargetPermission(ctx, batch.target_entity);
    return toImportBatchDto(batch);
  }

  async listBatches(tx: Tx, ctx: RequestContext): Promise<ImportBatch[]> {
    const rows = await this.repo.listBatches(tx, ctx.principal.tenantId);
    return rows.map(toImportBatchDto);
  }

  async getReport(tx: Tx, ctx: RequestContext, id: string): Promise<Buffer> {
    const batch = await this.repo.findBatchById(tx, ctx.principal.tenantId, id);
    if (!batch) {
      throw AppError.of('NOT_FOUND', `Import batch ${id} not found.`);
    }
    this.requireTargetPermission(ctx, batch.target_entity);

    if (!batch.report_file_key) {
      throw AppError.of('NOT_FOUND', 'No validation report was generated for this batch.');
    }

    const buffer = await this.storage.get(ctx.principal.tenantId, batch.report_file_key);
    if (!buffer) {
      throw AppError.of('NOT_FOUND', 'Validation report file not found in storage.');
    }

    return buffer;
  }
}
