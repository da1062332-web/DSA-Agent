// apps/api/src/modules/platform/imports/service.ts — owner: Platform Squad (MOD-IMP, TASK-413)
import crypto from 'node:crypto';
import { tenantBlindIndex } from '../../../secrets';
import {
  AppError,
  type CommitImportDto,
  type ConfigureMappingDto,
  type CreateImportDto,
  type ImportErrorDetail,
  type ImportBatch,
  type SaveLenderMisMappingInput,
  type LenderMisMappingResponse,
  type MisColumnMap,
  type MisDateFormat,
  type MisStatusMap,
  type RequestContext,
  type RollbackImportDto,
  type Tx,
} from '@dsa/contracts';
import { sql } from 'kysely';
import type { ApiDeps } from '../../types';
import { redactSecrets } from '../../../http/redact';
import { globalStorage, type ObjectStoragePort } from '../../../storage/object-storage';
import { parseCsvBuffer, serializeCsv } from './csv-parser';
import { parseMisAmount, parseMisDate, resolveMisStatus } from './mis-row';
import { MisMappingRepository, type LenderMisMappingRow } from './mis-mapping-repository';
import { ImportRepository, toImportBatchDto, type ImportBatchRow } from './repository';

/**
 * What one row did. `valid` counts a row the sheet described properly; `imported` counts one that changed something.
 * They differ: a row that names a real case but asks for a move the case cannot make is valid and not imported.
 */
interface RowOutcome {
  valid: boolean;
  imported: boolean;
  error?: ImportErrorDetail;
}

/** The lender's saved mapping, read once per batch rather than once per row: a 2,000-row sheet is one lender's. */
interface MisImportContext {
  lenderId: string;
  statusMap: MisStatusMap;
  dateFormat: MisDateFormat;
  mappingId: string;
  mappingVersion: number;
}

function toMisMappingResponse(row: LenderMisMappingRow): LenderMisMappingResponse {
  return {
    id: row.id,
    lenderId: row.lender_id,
    columnMap: row.column_map as MisColumnMap,
    statusMap: row.status_map as MisStatusMap,
    dateFormat: row.date_format,
    version: row.version,
    lastImportAt: row.last_import_at ? new Date(row.last_import_at).toISOString() : null,
    lockVersion: row.lock_version,
    createdAt: new Date(row.created_at).toISOString(),
    createdBy: row.created_by,
  };
}

export class ImportService {
  constructor(
    private readonly deps: ApiDeps,
    private readonly repo = new ImportRepository(),
    private readonly storage: ObjectStoragePort = globalStorage,
    private readonly misMappings = new MisMappingRepository(),
  ) {}

  /**
   * Whether the caller may see imports of this target: import.read (view only), import.run or config.manage for any, else the target's
   * create permission. Working with a batch (create, map, commit, roll back) is checked by requireTargetPermission, which import.read
   * does not satisfy.
   */
  private canUseTarget(ctx: RequestContext, targetEntity: string): boolean {
    const grants = ctx.principal.grants.map((g) => g.code);
    const required = targetEntity === 'CUSTOMER' ? 'customer.create' : 'lead.create';
    return (
      grants.includes(required as any) ||
      grants.includes('import.read') ||
      grants.includes('import.run') ||
      grants.includes('config.manage')
    );
  }

  /** import.read, import.run and config.manage see every batch of the tenant; anyone else (a holder of only a create permission) sees their own. */
  private seesAllBatches(ctx: RequestContext): boolean {
    return ctx.principal.grants.some(
      (g) => g.code === 'import.read' || g.code === 'import.run' || g.code === 'config.manage',
    );
  }

  /** Whether this caller may see this batch: the target rule, and for a non-administrator only their own uploads (audit F-06). */
  private canSeeBatch(ctx: RequestContext, batch: { target_entity: string; requester_id: string }): boolean {
    return (
      this.canUseTarget(ctx, batch.target_entity) &&
      (this.seesAllBatches(ctx) || batch.requester_id === ctx.principal.id)
    );
  }

  /**
   * Reading batches (audit F-06): refused before any lookup for a caller who can use no import target at all, so batch ids and
   * metadata cannot be probed without an import permission. Per-batch checks (requireTargetPermission) still apply after the lookup.
   */
  private requireAnyImportAccess(ctx: RequestContext): void {
    if (!this.canUseTarget(ctx, 'CUSTOMER') && !this.canUseTarget(ctx, 'LEAD')) {
      throw AppError.of(
        'FORBIDDEN',
        'Import access requires import.read, import.run, config.manage, customer.create or lead.create.',
      );
    }
  }

  /**
   * The permission each target needs. A lookup, not a ternary: with `CUSTOMER ? customer.create : lead.create`, every
   * target added later silently demanded lead.create, and nobody would notice because import.run satisfies the check
   * on its own. An unknown target fails closed instead of borrowing another target's permission.
   */
  private static readonly TARGET_PERMISSION: Record<string, string> = {
    LEAD: 'lead.create',
    CUSTOMER: 'customer.create',
    // A status sheet creates nothing; it moves cases that already exist, which is this permission.
    LENDER_CASE_STATUS: 'lender_case.update_status',
  };

  private requireTargetPermission(ctx: RequestContext, targetEntity: string): void {
    const grants = ctx.principal.grants.map((g) => g.code);
    const required = ImportService.TARGET_PERMISSION[targetEntity];
    if (!required) {
      throw AppError.of('VALIDATION_ERROR', `Unknown import target '${targetEntity}'.`);
    }
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

    // Refused at upload rather than at commit: by commit time the operator has already mapped the columns, and
    // sending them back to the start for a field the first screen could have asked for is the kind of small
    // cruelty that makes people stop using a tool.
    if (dto.targetEntity === 'LENDER_CASE_STATUS' && typeof dto.importOptions?.lenderId !== 'string') {
      throw AppError.of(
        'VALIDATION_ERROR',
        'A lender case status import must name its lender: set importOptions.lenderId.',
        [{ field: 'importOptions.lenderId', issue: 'REQUIRED' }],
      );
    }

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
      // The preview is shown back to the uploader and stored with the batch, so identity numbers in it are masked (TEST-SECRETS-04).
      // The commit reads the stored file, not this preview.
      preview_data: parsed.previewRows.map((row) =>
        Object.fromEntries(Object.entries(row).map(([k, v]) => [k, redactSecrets(v)])),
      ),
      total_rows: parsed.totalRows,
      // Which bank's sheet this is, for LENDER_CASE_STATUS. Stored on the batch rather than asked for again at
      // commit, so the record of a past import says whose sheet it read.
      import_options: dto.importOptions ?? {},
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


  /**
   * The lender's saved mapping, as the editor sees it. Needs import.run: whoever configures how a bank's sheet is
   * read decides which of our statuses its words become, which is the same authority as running the import.
   */
  async getMisMapping(tx: Tx, ctx: RequestContext, lenderId: string): Promise<LenderMisMappingResponse | null> {
    this.requireMappingPermission(ctx);
    const row = await this.misMappings.findByLender(tx, lenderId);
    return row ? toMisMappingResponse(row) : null;
  }

  async saveMisMapping(
    tx: Tx,
    ctx: RequestContext,
    lenderId: string,
    input: SaveLenderMisMappingInput,
  ): Promise<LenderMisMappingResponse> {
    this.requireMappingPermission(ctx);

    // The lender must exist in this tenant. Without the check a typo saves a mapping nothing will ever read, and the
    // operator finds out next morning when the import refuses the batch.
    if (this.deps.lenderPort && !(await this.deps.lenderPort.exists(tx, lenderId))) {
      throw AppError.of('NOT_FOUND', `Lender ${lenderId} not found.`);
    }

    // The sheet's reference column and status column are what match and move a case; a mapping without either
    // cannot do anything, so it is refused at save time rather than producing a report of 2,000 exceptions.
    const fields = new Set(Object.values(input.columnMap ?? {}));
    for (const required of ['lenderReference', 'status'] as const) {
      if (!fields.has(required)) {
        throw AppError.of(
          'VALIDATION_ERROR',
          `The column map must name which column holds ${required}.`,
          [{ field: 'columnMap', issue: 'MISSING_FIELD', meta: { required } }],
        );
      }
    }
    if (Object.keys(input.statusMap ?? {}).length === 0) {
      throw AppError.of(
        'VALIDATION_ERROR',
        "The status map is empty, so none of the bank's stage words could be understood.",
        [{ field: 'statusMap', issue: 'EMPTY' }],
      );
    }

    const row = await this.misMappings.upsert(tx, ctx, this.deps.ids.next('mism'), {
      lenderId,
      columnMap: input.columnMap as MisColumnMap,
      statusMap: input.statusMap as MisStatusMap,
      dateFormat: (input.dateFormat ?? 'DD-MM-YYYY') as MisDateFormat,
    });

    await this.recordAudit(tx, ctx, {
      action: 'lender_mis_mapping.saved',
      entityType: 'LENDER_MIS_MAPPING',
      entityId: row.id,
      // The map itself is the bank's column headings and stage words, not anyone's personal data, so it is safe to
      // record — and it is the thing a reviewer needs when an import turns out to have moved cases wrongly.
      after: { lenderId, version: row.version, dateFormat: row.date_format },
      permissionUsed: 'import.run',
    });

    return toMisMappingResponse(row);
  }

  private requireMappingPermission(ctx: RequestContext): void {
    const grants = ctx.principal.grants.map((g) => g.code);
    if (!grants.includes('import.run') && !grants.includes('config.manage')) {
      throw AppError.of('FORBIDDEN', 'Principal lacks import.run permission required for MIS mappings.');
    }
  }

  /**
   * The lender's saved mapping for this batch. Read once, before the loop: a 2,000-row sheet belongs to one lender,
   * and re-reading per row would be 2,000 queries for one answer.
   */
  private async loadMisContext(tx: Tx, ctx: RequestContext, batch: ImportBatchRow): Promise<MisImportContext> {
    const options =
      typeof batch.import_options === 'string' ? JSON.parse(batch.import_options) : batch.import_options;
    const lenderId = typeof options?.lenderId === 'string' ? options.lenderId : null;
    if (!lenderId) {
      throw AppError.of(
        'VALIDATION_ERROR',
        'A lender case status import must name its lender. Set importOptions.lenderId when creating the batch.',
      );
    }

    const row = await this.misMappings.findByLender(tx, lenderId);
    if (!row) {
      // Refusing the whole batch is right: without the bank's status words every row would be an exception, and a
      // report of 2,000 identical exceptions hides the one thing the operator has to do, which is save a mapping.
      throw AppError.of(
        'VALIDATION_ERROR',
        `No MIS mapping saved for lender ${lenderId}. Save the column and status mapping before importing its sheet.`,
      );
    }

    return {
      lenderId,
      statusMap: (row.status_map as MisStatusMap) ?? {},
      dateFormat: row.date_format,
      mappingId: row.id,
      mappingVersion: row.version,
    };
  }

  /**
   * One row of a bank's status sheet. Creates nothing: it finds the case the bank's reference points at and moves it
   * through LenderCaseStatusPort, which is the same path a person's click takes — same permission check, same legal
   * transition rules, same audit and outbox events, in this batch's transaction.
   *
   * Nothing here throws. A row the sheet got wrong, a case this tenant does not have, a move the case cannot make:
   * each returns an exception row, because one bad row out of 2,000 must not cost the other 1,999.
   */
  private async processLenderCaseStatusRow(
    tx: Tx,
    ctx: RequestContext,
    mis: MisImportContext,
    mappedRow: Record<string, string>,
    rowNum: number,
  ): Promise<RowOutcome> {
    const exception = (issue: string, message: string, field?: string, rawValue?: string): RowOutcome => ({
      valid: false,
      imported: false,
      error: { rowNumber: rowNum, ...(field ? { field } : {}), issue, message, ...(rawValue !== undefined ? { rawValue } : {}) },
    });

    const reference = (mappedRow['lenderReference'] ?? '').trim();
    if (!reference) {
      return exception('MISSING_REFERENCE', 'The row has no lender reference, so no case can be matched.', 'lenderReference');
    }

    const statusWord = (mappedRow['status'] ?? '').trim();
    const toStatus = resolveMisStatus(statusWord, mis.statusMap);
    if (!toStatus) {
      return exception(
        'UNKNOWN_STATUS_WORD',
        `The lender's mapping has no entry for "${statusWord}". Add it to the status map and re-import.`,
        'status',
        statusWord,
      );
    }

    const port = this.deps.lenderCaseStatusPort;
    if (!port) {
      throw AppError.of('DEPENDENCY_UNAVAILABLE', 'The lender cases module is not available.');
    }

    const existing = await port.findByReference(tx, mis.lenderId, reference);
    if (!existing) {
      return exception(
        'UNMATCHED_REFERENCE',
        'No lender case for this lender carries that reference.',
        'lenderReference',
        reference,
      );
    }

    // A sheet repeats yesterday's rows every morning. A case already in the status the row asks for is left alone:
    // re-applying would write a history entry and an outbox event daily for a case that has not moved.
    const alreadyThere = existing.status === toStatus;

    if (!alreadyThere) {
      try {
        await port.applyStatus(
          tx,
          ctx,
          existing.id,
          {
            toStatus,
            statusSource: 'LENDER_FILE',
            ...(mappedRow['reasonText'] ? { reasonText: mappedRow['reasonText'].trim().slice(0, 1000) } : {}),
            lenderReference: reference,
          },
          existing.lockVersion,
        );
      } catch (err: unknown) {
        // An illegal move is the sheet disagreeing with our record, not a failure of the import: the bank may have
        // re-opened a case we closed, or sent a stage out of order. It belongs on the exceptions list for a person.
        return exception(
          'ILLEGAL_TRANSITION',
          err instanceof Error
            ? `${existing.status} to ${toStatus} was refused: ${err.message}`
            : `${existing.status} to ${toStatus} was refused.`,
          'status',
          statusWord,
        );
      }
    }

    // A disbursement row carries money, and money is a separate authority from a status: recordTranche checks
    // disbursement.record itself, so an operator with only import rights gets this as an exception, not a tranche.
    const rawAmount = (mappedRow['disbursedAmount'] ?? '').trim();
    if (!rawAmount) {
      return { valid: true, imported: !alreadyThere };
    }

    const amount = parseMisAmount(rawAmount);
    if (amount === null) {
      return exception('INVALID_AMOUNT', 'The disbursed amount is not a positive number.', 'disbursedAmount', rawAmount);
    }

    const rawDate = (mappedRow['disbursedOn'] ?? '').trim();
    const disbursedOn = parseMisDate(rawDate, mis.dateFormat);
    if (!disbursedOn) {
      return exception(
        'INVALID_DATE',
        `The disbursement date is not a ${mis.dateFormat} date.`,
        'disbursedOn',
        rawDate,
      );
    }

    const tranchePort = this.deps.sanctionTranchePort;
    if (!tranchePort) {
      throw AppError.of('DEPENDENCY_UNAVAILABLE', 'The sanctions module is not available.');
    }

    const sanction = await tranchePort.findActiveSanctionForCase(tx, existing.id);
    if (!sanction) {
      return exception(
        'NO_ACTIVE_SANCTION',
        'The case has no active sanction, so a disbursement cannot be recorded against it.',
        'disbursedAmount',
        rawAmount,
      );
    }

    try {
      await tranchePort.recordTranche(tx, ctx, sanction.sanctionId, { amount, currency: 'INR', disbursedOn });
    } catch (err: unknown) {
      return exception(
        'TRANCHE_REFUSED',
        err instanceof Error ? err.message : 'The disbursement could not be recorded.',
        'disbursedAmount',
        rawAmount,
      );
    }

    return { valid: true, imported: true };
  }

  /**
   * One LEAD or CUSTOMER row: validate, then insert. Lifted out of commitImport unchanged when P1-07 added a third
   * target; the only difference is that a rejected row returns its error instead of pushing and continuing.
   */
  private async processRecordRow(
    tx: Tx,
    ctx: RequestContext,
    batch: ImportBatchRow,
    mappedRow: Record<string, string>,
    rowNum: number,
    branchId: string,
  ): Promise<RowOutcome> {

    // Business Rule Validations
    const fullName = (mappedRow['fullName'] ?? '').trim();
    const rawMobile = (mappedRow['mobile'] ?? '').trim();
    let mobileE164 = rawMobile;

    if (!fullName || fullName.length < 2 || fullName.length > 200) {
      return { valid: false, imported: false, error: {
        rowNumber: rowNum,
        field: 'fullName',
        issue: 'INVALID_LENGTH',
        message: 'Full name must be between 2 and 200 characters.',
        rawValue: fullName,
      } };
    }

    // Normalize mobile to E.164 format (+91...)
    const digitsOnly = rawMobile.replace(/[^0-9]/g, '');
    if (digitsOnly.length === 10) {
      mobileE164 = `+91${digitsOnly}`;
    } else if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
      mobileE164 = `+${digitsOnly}`;
    }

    if (!/^\+[1-9][0-9]{7,14}$/.test(mobileE164)) {
      return { valid: false, imported: false, error: {
        rowNumber: rowNum,
        field: 'mobile',
        issue: 'INVALID_MOBILE',
        message: 'Mobile number must be a valid 10-digit Indian number or E.164 phone.',
        rawValue: rawMobile,
      } };
    }

    // Email validation if present
    const email = mappedRow['email'] ? mappedRow['email'].trim().toLowerCase() : null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { valid: false, imported: false, error: {
        rowNumber: rowNum,
        field: 'email',
        issue: 'INVALID_EMAIL',
        message: 'Email format is invalid.',
        rawValue: email,
      } };
    }

    let imported = false;

    // Insert record retaining import_batch_id
    // Keyed, tenant-scoped hashes, as leads and customers use. An unkeyed SHA-256 of a phone number can be reversed by enumeration, and it
    // never matched the keyed lookups, so an imported row could not be found.
    const mobileHash = tenantBlindIndex('MOBILE_HMAC_SECRET', ctx.principal.tenantId, mobileE164);
    const emailHash = email ? tenantBlindIndex('MOBILE_HMAC_SECRET', ctx.principal.tenantId, email) : null;

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
          imported = true;
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
          imported = true;
        }
      } else {
        imported = true;
      }
    } catch (insertErr: unknown) {
      return { valid: true, imported: false, error: {
        rowNumber: rowNum,
        issue: 'DATABASE_INSERT_ERROR',
        message: insertErr instanceof Error ? insertErr.message : 'Database insertion error',
      } };
    }

    return { valid: true, imported };

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

    // Read once, before the loop. Throwing here fails the whole batch on purpose: without the lender's mapping every
    // row would be an exception, and 2,000 identical exceptions hide the single action the operator needs to take.
    const misContext =
      batch.target_entity === 'LENDER_CASE_STATUS' ? await this.loadMisContext(tx, ctx, batch) : null;

    for (let i = 0; i < parsed.allRows.length; i++) {
      const rawRow = parsed.allRows[i]!;
      const rowNum = i + 2; // 1-based + 1 header row
      const mappedRow: Record<string, string> = {};

      for (const [sourceCol, targetField] of Object.entries(mapping)) {
        mappedRow[targetField as string] = rawRow[sourceCol] ?? '';
      }

      // One handler per target. LEAD and CUSTOMER create records from the sheet; LENDER_CASE_STATUS creates nothing
      // and moves cases that already exist, so it cannot share the name-and-mobile validation the other two need —
      // a status sheet carries neither, and every row would have been rejected before reaching its handler.
      const outcome =
        batch.target_entity === 'LENDER_CASE_STATUS'
          ? await this.processLenderCaseStatusRow(tx, ctx, misContext!, mappedRow, rowNum)
          : await this.processRecordRow(tx, ctx, batch, mappedRow, rowNum, branchId);

      if (outcome.valid) validCount++;
      if (outcome.imported) importedCount++;
      if (outcome.error) errors.push(outcome.error);
    }

    // Generate validation error report if errors occurred
    let reportKey: string | null = null;
    if (errors.length > 0) {
      const errorRows = errors.map((e) => ({
        RowNumber: e.rowNumber,
        Field: e.field ?? 'General',
        Issue: e.issue,
        Message: e.message,
        // The report is an export: a PAN or Aadhaar number typed into the wrong column is masked here too (TEST-SECRETS-04).
        RawValue: redactSecrets(String(e.rawValue ?? '')),
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

    // So the lender page can show when its sheet was last loaded. Stamped even when every row was an exception: the
    // sheet was still processed, and "last import" that only moves on success would read as though nothing ran.
    if (misContext) {
      await this.misMappings.markImported(tx, misContext.lenderId);
      // A tenant that loads bank sheets is the one whose cases can go quiet. Books the daily sweep once; later
      // commits find it already pending and do nothing.
      await this.deps.lenderCaseStatusPort?.ensureStalenessSweepScheduled(tx, ctx.principal.tenantId);
    }

    const finalStatus = importedCount > 0 ? 'COMPLETED' : 'FAILED';
    const updated = await this.repo.updateCommitProgress(tx, ctx.principal.tenantId, id, {
      status: finalStatus,
      total_rows: parsed.totalRows,
      valid_rows: validCount,
      invalid_rows: errors.length,
      imported_rows: importedCount,
      report_file_key: reportKey,
      // Top 50 errors in jsonb, returned with the batch. The raw value is masked here too (TEST-SECRETS-04).
      error_summary: errors
        .slice(0, 50)
        .map((e) => ({ ...e, rawValue: e.rawValue === undefined ? undefined : redactSecrets(String(e.rawValue)) })),
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
    this.requireAnyImportAccess(ctx);
    const batch = await this.repo.findBatchById(tx, ctx.principal.tenantId, id);
    if (!batch) {
      throw AppError.of('NOT_FOUND', `Import batch ${id} not found.`);
    }
    this.requireTargetPermission(ctx, batch.target_entity);
    // Someone else's upload is not visible to a caller without import.run or config.manage: the same answer as an unknown id.
    if (!this.canSeeBatch(ctx, batch)) throw AppError.of('NOT_FOUND', `Import batch ${id} not found.`);
    return toImportBatchDto(batch);
  }

  async listBatches(tx: Tx, ctx: RequestContext): Promise<ImportBatch[]> {
    this.requireAnyImportAccess(ctx);
    const rows = await this.repo.listBatches(tx, ctx.principal.tenantId);
    // Only the batches this caller may see: the target rule, and for a non-administrator only their own uploads.
    return rows.filter((r) => this.canSeeBatch(ctx, r)).map(toImportBatchDto);
  }

  async getReport(tx: Tx, ctx: RequestContext, id: string): Promise<Buffer> {
    this.requireAnyImportAccess(ctx);
    const batch = await this.repo.findBatchById(tx, ctx.principal.tenantId, id);
    if (!batch) {
      throw AppError.of('NOT_FOUND', `Import batch ${id} not found.`);
    }
    this.requireTargetPermission(ctx, batch.target_entity);
    if (!this.canSeeBatch(ctx, batch)) throw AppError.of('NOT_FOUND', `Import batch ${id} not found.`);

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
