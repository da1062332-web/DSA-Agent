// apps/api/src/modules/origination/lender-cases/service.ts — owner: Dev 4 (MOD-LCS Domain Service)
import {
  AppError,
  isValidLenderCaseTransition,
  type BuildPackageInput,
  type ApplicationPort,
  type ConsentPort,
  type CreateLenderCaseInput,
  type LenderCaseResource,
  type LenderCaseStatus,
  type LenderCaseStatusHistoryResource,
  type LenderQueryResource,
  type PermissionCode,
  type RecordLenderQueryInput,
  type RecordQueryResponseInput,
  type RequestContext,
  type SubmissionPackageResource,
  type SubmitLenderCaseInput,
  type SubmitLenderCaseResponse,
  type TaskPort,
  type Tx,
  type UpdateLenderCaseStatusInput,
} from '@dsa/contracts';
import { createHash } from 'crypto';
import { monotonicFactory } from 'ulid';
import type { LenderCaseRepository } from './repository';
import type { LenderCaseRow, LenderQueryRow, SubmissionPackageRow } from './types';

const nextUlid = monotonicFactory();

export function newId(prefix: string): string {
  return `${prefix}_${nextUlid()}`;
}

export interface LenderCaseServiceDeps {
  repository: LenderCaseRepository;
  /** Required for packages and submissions; without it they fail closed (503), never share without consent. */
  consentPort?: ConsentPort;
  /** Required for packages: the checklist and document hashes come from the applications module (MOD-DOC). */
  applicationPort?: ApplicationPort;
  taskPort?: TaskPort;
}

/** Fields that leave the DSA in a lender package. No S3 data (PAN, Aadhaar, DOB, bank details) in the MVP. */
const SHARED_FIELDS = ['applicant_name', 'requested_amount', 'product_category'];

/** A lender query with the answer recorded for it, if any. */
export interface LenderQueryHistoryResource extends LenderQueryResource {
  responseText: string | null;
  responseDocumentReferences: string[];
}

/** Cursor for the lender case list: the sort key of the last case on a page, base64url-encoded. */
function encodeLenderCaseCursor(row: LenderCaseRow): string {
  return Buffer.from(JSON.stringify({ k: row.created_at.toISOString(), id: row.id })).toString('base64url');
}

function decodeLenderCaseCursor(cursor: string | undefined): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { k?: unknown; id?: unknown };
    if (typeof v.k === 'string' && typeof v.id === 'string' && !Number.isNaN(Date.parse(v.k))) {
      return { createdAt: v.k, id: v.id };
    }
  } catch {
    // reported below
  }
  throw AppError.of('VALIDATION_ERROR', 'cursor is not a valid page cursor', [{ field: 'cursor', issue: 'INVALID' }]);
}

export class LenderCaseService {
  constructor(private readonly deps: LenderCaseServiceDeps) {}

  /** FR-PRV: data goes to a lender only under an ACTIVE SHARE_WITH_LENDER consent naming that lender. */
  private async requireShareConsent(tx: Tx, customerId: string, lenderId: string): Promise<string> {
    if (!this.deps.consentPort) {
      throw AppError.of('DEPENDENCY_UNAVAILABLE', 'Consent cannot be checked, so nothing is shared with the lender.');
    }
    const active = await this.deps.consentPort.findActive(tx, {
      customerId,
      purpose: 'SHARE_WITH_LENDER',
      purposeTarget: lenderId,
    });
    if (!active) {
      throw AppError.of('CONSENT_REQUIRED', 'Active SHARE_WITH_LENDER consent for this lender is required.');
    }
    return active.consentId;
  }

  private requirePermission(ctx: RequestContext, code: PermissionCode): void {
    const { principal } = ctx;
    if (principal.kind === 'SERVICE') return;
    const hasGrant = principal.grants.some((g) => g.code === code);
    if (!hasGrant) {
      throw AppError.of('FORBIDDEN', `Permission denied: ${code} required.`);
    }
  }

  private checkBranchScope(ctx: RequestContext, code: PermissionCode, branchId: string): void {
    const { principal } = ctx;
    if (principal.kind === 'SERVICE') return;
    const tenantGrants = principal.grants.filter((g) => g.code === code && g.scope === 'TENANT');
    if (tenantGrants.length > 0) return;

    const branchGrants = principal.grants.filter((g) => g.code === code && g.scope === 'BRANCH');
    if (branchGrants.length > 0) {
      const allowed = new Set<string>();
      for (const g of branchGrants) {
        for (const b of g.branchIds) allowed.add(b);
      }
      if (principal.primaryBranchId) allowed.add(principal.primaryBranchId);
      if (!allowed.has(branchId)) {
        throw AppError.of('FORBIDDEN', `Cannot access branch '${branchId}'.`);
      }
    }
  }

  toResource(row: LenderCaseRow): LenderCaseResource {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      applicationId: row.application_id,
      lenderId: row.lender_id,
      productVersionId: row.product_version_id,
      empanelmentId: row.empanelment_id,
      attemptNo: row.attempt_no,
      status: row.status,
      lenderReference: row.lender_reference ?? null,
      submissionChannel: row.submission_channel ?? null,
      submittedAt: row.submitted_at ? row.submitted_at.toISOString() : null,
      packageId: row.package_id ?? null,
      statusSource: row.status_source ?? null,
      lastStatusAt: row.last_status_at ? row.last_status_at.toISOString() : null,
      declineReasonCode: row.decline_reason_code ?? null,
      stalenessFlag: row.staleness_flag,
      tags: [...row.tags],
      lockVersion: row.lock_version,
      createdAt: row.created_at.toISOString(),
      createdBy: row.created_by,
      updatedAt: row.updated_at.toISOString(),
      updatedBy: row.updated_by,
    };
  }

  toPackageResource(row: SubmissionPackageRow): SubmissionPackageResource {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      lenderCaseId: row.lender_case_id,
      kind: row.kind,
      manifest: { ...row.manifest },
      manifestSha256: row.manifest_sha256,
      consentIds: [...row.consent_ids],
      builtBy: row.built_by,
      builtAt: row.built_at.toISOString(),
      frozenAt: row.frozen_at ? row.frozen_at.toISOString() : null,
    };
  }

  toQueryResource(row: LenderQueryRow): LenderQueryResource {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      lenderCaseId: row.lender_case_id,
      text: row.text,
      requestedItems: [...row.requested_items],
      lenderDueDate: row.lender_due_date ? row.lender_due_date.toISOString() : null,
      taskId: row.task_id ?? null,
      responseManifestId: row.response_manifest_id ?? null,
      respondedAt: row.responded_at ? row.responded_at.toISOString() : null,
      createdAt: row.created_at.toISOString(),
      createdBy: row.created_by,
    };
  }

  /**
   * API-LCS-001: Create Lender Case
   */
  async createCase(
    tx: Tx,
    ctx: RequestContext,
    applicationId: string,
    input: CreateLenderCaseInput,
    idempotencyKey?: string | null,
  ): Promise<LenderCaseResource> {
    const tenantId = ctx.principal.tenantId;
    this.requirePermission(ctx, 'lender_case.submit');

    // 1. Verify Application exists in tenant
    const app = await this.deps.repository.findApplicationForUpdate(tx, tenantId, applicationId);
    if (!app) {
      throw AppError.of('NOT_FOUND', `Application '${applicationId}' not found.`);
    }
    this.checkBranchScope(ctx, 'lender_case.submit', app.branch_id);

    if (app.status === 'CANCELLED' || app.status === 'CLOSED') {
      throw AppError.of(
        'INVALID_STATE',
        `Application is in '${app.status}' state and cannot accept new lender cases.`,
      );
    }

    // 2. Verify Lender
    const lender = await this.deps.repository.findLender(tx, tenantId, input.lenderId);
    if (!lender) {
      throw AppError.of('NOT_FOUND', `Lender '${input.lenderId}' not found.`);
    }
    if (lender.status === 'PAUSED') {
      throw AppError.of('LENDER_PAUSED', `Lender '${lender.name}' is paused for new case placements.`);
    }
    if (lender.status !== 'ACTIVE') {
      throw AppError.of('VALIDATION_ERROR', `Lender '${lender.name}' is not active.`);
    }

    // 3. Verify Empanelment
    const empanelment = await this.deps.repository.findEmpanelment(tx, tenantId, input.empanelmentId);
    if (!empanelment) {
      throw AppError.of('NOT_FOUND', `Empanelment '${input.empanelmentId}' not found.`);
    }
    if (empanelment.lender_id !== input.lenderId) {
      throw AppError.of('VALIDATION_ERROR', 'Empanelment does not belong to the selected lender.');
    }
    if (empanelment.status !== 'ACTIVE') {
      throw AppError.of('EMPANELMENT_INACTIVE', `Empanelment '${empanelment.dsa_code}' is not active.`);
    }
    if (!empanelment.permitted_categories.includes(app.product_category)) {
      throw AppError.of(
        'VALIDATION_ERROR',
        `Product category '${app.product_category}' is not permitted under empanelment '${empanelment.dsa_code}'.`,
      );
    }

    // 4. Verify Product Version
    const productVersion = await this.deps.repository.findProductVersion(
      tx,
      tenantId,
      input.productVersionId,
    );
    if (!productVersion) {
      throw AppError.of('NOT_FOUND', `Product version '${input.productVersionId}' not found.`);
    }
    if (productVersion.status !== 'ACTIVE') {
      throw AppError.of('VALIDATION_ERROR', `Product version '${input.productVersionId}' is not active.`);
    }

    // 5. Active Case conflict check for same lender
    const activeSameLender = await this.deps.repository.findActiveCaseForLender(
      tx,
      tenantId,
      applicationId,
      input.lenderId,
    );
    if (activeSameLender) {
      throw AppError.of(
        'ACTIVE_CASE_EXISTS',
        `An active case (${activeSameLender.id}) already exists for lender '${lender.name}'.`,
      );
    }

    // 6. Parallel attempts check
    const existingActiveCases = await this.deps.repository.findActiveCasesForApplication(
      tx,
      tenantId,
      applicationId,
    );
    if (existingActiveCases.length > 0) {
      const allowParallel = await this.deps.repository.getTenantSetting(
        tx,
        tenantId,
        'allow_parallel_lender_attempts',
      );
      if (!allowParallel) {
        throw AppError.of(
          'ACTIVE_CASE_EXISTS',
          `Parallel lender attempts are not permitted. Active case ${existingActiveCases[0]?.id} exists.`,
        );
      }
    }

    // 7. Safe attempt number allocation
    const attemptNo = await this.deps.repository.getNextAttemptNo(tx, tenantId, applicationId);

    const now = ctx.now ?? new Date();
    const caseId = newId('lcs');
    const caseRow: LenderCaseRow = {
      id: caseId,
      tenant_id: tenantId,
      application_id: applicationId,
      lender_id: input.lenderId,
      product_version_id: input.productVersionId,
      empanelment_id: input.empanelmentId,
      attempt_no: attemptNo,
      status: 'DRAFT',
      lender_reference: null,
      submission_channel: null,
      submitted_at: null,
      package_id: null,
      status_source: 'MANUAL',
      last_status_at: now,
      decline_reason_code: null,
      staleness_flag: false,
      tags: [...input.tags],
      lock_version: 0,
      created_at: now,
      created_by: ctx.principal.id,
      updated_at: now,
      updated_by: ctx.principal.id,
    };

    await this.deps.repository.insertCase(tx, caseRow);

    // Status history
    await this.deps.repository.insertStatusHistory(tx, {
      id: newId('lcsh'),
      tenant_id: tenantId,
      lender_case_id: caseId,
      from_status: null,
      to_status: 'DRAFT',
      status_source: 'MANUAL',
      reason_text: 'Initial case draft created',
      actor: ctx.principal.id,
      occurred_at: now,
    });

    // Outbox event
    await this.deps.repository.insertOutboxEvent(tx, {
      id: newId('evt'),
      tenant_id: tenantId,
      event_type: 'lender_case.state_changed',
      event_version: 1,
      subject_type: 'LENDER_CASE',
      subject_id: caseId,
      correlation_id: ctx.correlationId,
      causation_id: idempotencyKey ?? null,
      chain_depth: 0,
      data: {
        lenderCaseId: caseId,
        applicationId,
        lenderId: input.lenderId,
        attemptNo,
        fromStatus: null,
        toStatus: 'DRAFT',
      },
      occurred_at: now,
    });

    // Audit event
    await this.deps.repository.insertAuditEvent(tx, {
      id: newId('aud'),
      tenant_id: tenantId,
      actor: ctx.principal.id,
      actor_kind: ctx.principal.kind,
      action: 'lender_case.create',
      subject_type: 'LENDER_CASE',
      subject_id: caseId,
      correlation_id: ctx.correlationId,
      ip_address: ctx.ip,
      user_agent: ctx.userAgent,
      from_state: null,
      to_state: 'DRAFT',
      metadata: { applicationId, lenderId: input.lenderId, attemptNo },
      occurred_at: now,
    });

    return this.toResource(caseRow);
  }

  /**
   * API-LCS-002: Retrieve Lender Case
   */
  async getCase(tx: Tx, ctx: RequestContext, id: string): Promise<LenderCaseResource> {
    const tenantId = ctx.principal.tenantId;
    this.requirePermission(ctx, 'application.read');

    const row = await this.deps.repository.findCaseById(tx, tenantId, id);
    if (!row) {
      throw AppError.of('NOT_FOUND', `Lender case '${id}' not found.`);
    }

    const app = await this.deps.repository.findApplication(tx, tenantId, row.application_id);
    if (app) {
      this.checkBranchScope(ctx, 'application.read', app.branch_id);
    }

    return this.toResource(row);
  }

  /**
   * List Lender Cases for Application
   */
  async listCases(tx: Tx, ctx: RequestContext, applicationId: string): Promise<LenderCaseResource[]> {
    const tenantId = ctx.principal.tenantId;
    this.requirePermission(ctx, 'application.read');

    const app = await this.deps.repository.findApplication(tx, tenantId, applicationId);
    if (!app) {
      throw AppError.of('NOT_FOUND', `Application '${applicationId}' not found.`);
    }
    this.checkBranchScope(ctx, 'application.read', app.branch_id);

    const rows = await this.deps.repository.listCasesByApplication(tx, tenantId, applicationId);
    return rows.map((r) => this.toResource(r));
  }

  /**
   * List All Lender Cases (Tenant Scope), newest first, one page at a time.
   * A page holds up to `limit` cases (default 50, at most 200); `meta.nextCursor` is set when more follow.
   */
  async listAllCases(
    tx: Tx,
    ctx: RequestContext,
    filter?: { status?: string; lenderId?: string; applicationId?: string; limit?: number; cursor?: string },
  ): Promise<{ data: LenderCaseResource[]; meta: { nextCursor: string | null; limit: number } }> {
    const tenantId = ctx.principal.tenantId;
    this.requirePermission(ctx, 'application.read');
    const limit = Math.min(filter?.limit ?? 50, 200);
    const after = decodeLenderCaseCursor(filter?.cursor);
    // One row beyond the page tells us whether another page exists.
    const rows = await this.deps.repository.listAllCases(tx, tenantId, {
      status: filter?.status,
      lenderId: filter?.lenderId,
      applicationId: filter?.applicationId,
      after: after ?? undefined,
      limit: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      data: page.map((r) => this.toResource(r)),
      meta: { nextCursor: rows.length > limit && last ? encodeLenderCaseCursor(last) : null, limit },
    };
  }

  /** Loads a case and checks that the caller's branch scope covers its application. */
  private async loadCaseInScope(tx: Tx, ctx: RequestContext, id: string): Promise<LenderCaseRow> {
    const tenantId = ctx.principal.tenantId;
    const row = await this.deps.repository.findCaseById(tx, tenantId, id);
    if (!row) {
      throw AppError.of('NOT_FOUND', `Lender case '${id}' not found.`);
    }
    const app = await this.deps.repository.findApplication(tx, tenantId, row.application_id);
    if (app) {
      this.checkBranchScope(ctx, 'application.read', app.branch_id);
    }
    return row;
  }

  /**
   * Query history for one case, oldest first. A query that has been answered carries the lender's answer text
   * and the document references the answer was sent with.
   */
  async listQueries(tx: Tx, ctx: RequestContext, id: string): Promise<LenderQueryHistoryResource[]> {
    const tenantId = ctx.principal.tenantId;
    this.requirePermission(ctx, 'application.read');
    await this.loadCaseInScope(tx, ctx, id);

    const rows = await this.deps.repository.listQueriesByCase(tx, tenantId, id);
    const result: LenderQueryHistoryResource[] = [];
    for (const row of rows) {
      let responseText: string | null = null;
      let responseDocumentReferences: string[] = [];
      if (row.response_manifest_id) {
        const pkg = await this.deps.repository.findPackageById(tx, tenantId, row.response_manifest_id);
        if (pkg) {
          const manifest = pkg.manifest as { response?: unknown; documentReferences?: unknown };
          responseText = typeof manifest.response === 'string' ? manifest.response : null;
          responseDocumentReferences = Array.isArray(manifest.documentReferences)
            ? manifest.documentReferences.map(String)
            : [];
        }
      }
      result.push({ ...this.toQueryResource(row), responseText, responseDocumentReferences });
    }
    return result;
  }

  /** Status history for one case, oldest first. */
  async listStatusHistory(
    tx: Tx,
    ctx: RequestContext,
    id: string,
  ): Promise<LenderCaseStatusHistoryResource[]> {
    const tenantId = ctx.principal.tenantId;
    this.requirePermission(ctx, 'application.read');
    await this.loadCaseInScope(tx, ctx, id);

    const rows = await this.deps.repository.listStatusHistory(tx, tenantId, id);
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      lenderCaseId: r.lender_case_id,
      fromStatus: r.from_status,
      toStatus: r.to_status,
      statusSource: r.status_source,
      reasonText: r.reason_text,
      actor: r.actor,
      occurredAt: r.occurred_at.toISOString(),
    }));
  }

  /** The submission package the case was built and frozen with. */
  async getPackage(tx: Tx, ctx: RequestContext, id: string): Promise<SubmissionPackageResource> {
    const tenantId = ctx.principal.tenantId;
    this.requirePermission(ctx, 'application.read');
    const row = await this.loadCaseInScope(tx, ctx, id);
    if (!row.package_id) {
      throw AppError.of('NOT_FOUND', 'No submission package has been built for this lender case yet.');
    }
    const pkg = await this.deps.repository.findPackageById(tx, tenantId, row.package_id);
    if (!pkg) {
      throw AppError.of('NOT_FOUND', 'The submission package for this lender case was not found.');
    }
    return this.toPackageResource(pkg);
  }

  /**
   * API-LCS-003: Build or Preview Package
   */
  async buildPackage(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    input: BuildPackageInput,
    ifMatch?: number | null,
  ): Promise<{ package: SubmissionPackageResource; case: LenderCaseResource }> {
    const tenantId = ctx.principal.tenantId;
    this.requirePermission(ctx, 'lender_case.submit');

    const row = await this.deps.repository.findCaseByIdForUpdate(tx, tenantId, id);
    if (!row) {
      throw AppError.of('NOT_FOUND', `Lender case '${id}' not found.`);
    }

    if (ifMatch !== undefined && ifMatch !== null && row.lock_version !== ifMatch) {
      throw AppError.of('VERSION_CONFLICT', `Version conflict: expected ${row.lock_version}, got ${ifMatch}`);
    }

    if (row.status !== 'DRAFT' && row.status !== 'PACKAGE_READY' && row.status !== 'QUERY_RAISED') {
      throw AppError.of('INVALID_STATE', `Cannot build package in state '${row.status}'.`);
    }

    const app = await this.deps.repository.findApplication(tx, tenantId, row.application_id);
    if (!app) {
      throw AppError.of('NOT_FOUND', `Application '${row.application_id}' not found.`);
    }
    this.checkBranchScope(ctx, 'lender_case.submit', app.branch_id);
    const consentId = await this.requireShareConsent(tx, app.customer_id, row.lender_id);

    if (!this.deps.applicationPort) {
      throw AppError.of('DEPENDENCY_UNAVAILABLE', 'The document checklist is not available to build the package.');
    }
    const checklist = await this.deps.applicationPort.getSubmissionDocuments(tx, ctx, row.application_id);
    const waived = new Set(input.waivers);
    const outstanding = checklist.documents.filter(
      (d) => d.mandatory && !['ACCEPTED', 'WAIVED', 'NOT_APPLICABLE'].includes(d.status) && !waived.has(d.documentTypeCode) && !waived.has(d.checklistItemId),
    );
    if (checklist.documents.length === 0 || outstanding.length > 0) {
      throw AppError.of(
        'COMPLETENESS_FAILED',
        'Mandatory documents are still outstanding.',
        outstanding.map((d) => ({
          field: 'checklist',
          issue: 'DOCUMENT_OUTSTANDING',
          meta: { checklistItemId: d.checklistItemId, documentTypeCode: d.documentTypeCode, status: d.status },
        })),
      );
    }

    const now = ctx.now ?? new Date();
    const manifest = {
      applicationId: row.application_id,
      lenderId: row.lender_id,
      productVersionId: row.product_version_id,
      attemptNo: row.attempt_no,
      documents: checklist.documents
        .filter((d) => d.documentId !== null)
        .map((d) => ({
          checklistItemId: d.checklistItemId,
          documentTypeCode: d.documentTypeCode,
          documentId: d.documentId,
          sha256: d.sha256,
        })),
      waivers: [...input.waivers],
      builtAt: now.toISOString(),
    };

    const canonicalString = JSON.stringify(manifest);
    const manifestSha256 = createHash('sha256').update(canonicalString).digest('hex');

    const packageId = newId('pkg');
    const packageRow: SubmissionPackageRow = {
      id: packageId,
      tenant_id: tenantId,
      lender_case_id: id,
      kind: input.kind,
      manifest,
      manifest_sha256: manifestSha256,
      consent_ids: [consentId],
      built_by: ctx.principal.id,
      built_at: now,
      frozen_at: input.freeze ? now : null,
    };

    await this.deps.repository.insertPackage(tx, packageRow);

    const nextStatus = row.status === 'QUERY_RAISED' ? 'QUERY_RAISED' : 'PACKAGE_READY';
    const updatedCase = await this.deps.repository.updateCase(tx, tenantId, id, row.lock_version, {
      package_id: packageId,
      status: nextStatus,
      last_status_at: now,
      updated_by: ctx.principal.id,
    });

    if (!updatedCase) {
      throw AppError.of('VERSION_CONFLICT', 'Failed to update case with new package.');
    }

    if (row.status !== nextStatus) {
      await this.deps.repository.insertStatusHistory(tx, {
        id: newId('lcsh'),
        tenant_id: tenantId,
        lender_case_id: id,
        from_status: row.status,
        to_status: nextStatus,
        status_source: 'MANUAL',
        reason_text: 'Submission package prepared',
        actor: ctx.principal.id,
        occurred_at: now,
      });
    }

    return {
      package: this.toPackageResource(packageRow),
      case: this.toResource(updatedCase),
    };
  }

  /**
   * API-LCS-004: Submit Lender Case
   */
  async submitCase(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    input: SubmitLenderCaseInput,
    ifMatch?: number | null,
    idempotencyKey?: string | null,
  ): Promise<SubmitLenderCaseResponse> {
    const tenantId = ctx.principal.tenantId;
    this.requirePermission(ctx, 'lender_case.submit');

    const row = await this.deps.repository.findCaseByIdForUpdate(tx, tenantId, id);
    if (!row) {
      throw AppError.of('NOT_FOUND', `Lender case '${id}' not found.`);
    }

    if (ifMatch !== undefined && ifMatch !== null && row.lock_version !== ifMatch) {
      throw AppError.of('VERSION_CONFLICT', `Version conflict: expected ${row.lock_version}, got ${ifMatch}`);
    }

    if (row.status !== 'PACKAGE_READY') {
      throw AppError.of(
        'INVALID_STATE',
        `Case must be in PACKAGE_READY status to submit (current: ${row.status}).`,
      );
    }

    if (!row.package_id) {
      throw AppError.of('VALIDATION_ERROR', 'Submission package is missing.');
    }

    const pkg = await this.deps.repository.findPackageById(tx, tenantId, row.package_id);
    if (!pkg || !pkg.frozen_at) {
      throw AppError.of('VALIDATION_ERROR', 'Submission package must be frozen before submission.');
    }

    const app = await this.deps.repository.findApplication(tx, tenantId, row.application_id);
    if (!app) {
      throw AppError.of('NOT_FOUND', `Application '${row.application_id}' not found.`);
    }
    this.checkBranchScope(ctx, 'lender_case.submit', app.branch_id);

    // Consent is checked again at submission: it may have been withdrawn since the package was built.
    const consentId = await this.requireShareConsent(tx, app.customer_id, row.lender_id);

    // Revalidate lender and empanelment
    const lender = await this.deps.repository.findLender(tx, tenantId, row.lender_id);
    if (!lender || lender.status === 'PAUSED' || lender.status !== 'ACTIVE') {
      throw AppError.of('LENDER_PAUSED', 'Lender is paused or inactive.');
    }

    const empanelment = await this.deps.repository.findEmpanelment(tx, tenantId, row.empanelment_id);
    if (!empanelment || empanelment.status !== 'ACTIVE') {
      throw AppError.of('EMPANELMENT_INACTIVE', 'Empanelment is inactive.');
    }

    const now = ctx.now ?? new Date();
    const submittedAtDate = input.submittedAt ? new Date(input.submittedAt) : now;

    // 1. Update Case
    const updatedCase = await this.deps.repository.updateCase(tx, tenantId, id, row.lock_version, {
      status: 'SUBMITTED',
      submission_channel: input.channel,
      lender_reference: input.lenderReference ?? row.lender_reference,
      submitted_at: submittedAtDate,
      last_status_at: now,
      status_source: 'MANUAL',
      updated_by: ctx.principal.id,
    });

    if (!updatedCase) {
      throw AppError.of('VERSION_CONFLICT', 'Failed to update case during submission.');
    }

    // 2. Insert Data Sharing Record (ENT-100)
    const dsrId = newId('dsr');
    await this.deps.repository.insertDataSharingRecord(tx, {
      id: dsrId,
      tenant_id: tenantId,
      subject_type: 'LOAN_APPLICATION',
      subject_id: row.application_id,
      recipient_type: 'LENDER',
      recipient_id: row.lender_id,
      purpose: 'LENDER_SUBMISSION',
      consent_ids: [consentId],
      items: {
        fields: [...SHARED_FIELDS],
        checklistItemIds: ((pkg.manifest as { documents?: { checklistItemId: string }[] }).documents ?? []).map(
          (d) => d.checklistItemId,
        ),
      },
      channel: input.channel,
      source_ref: pkg.id,
      actor_id: ctx.principal.id,
      shared_at: now,
    });

    // 3. Insert Status History
    await this.deps.repository.insertStatusHistory(tx, {
      id: newId('lcsh'),
      tenant_id: tenantId,
      lender_case_id: id,
      from_status: 'PACKAGE_READY',
      to_status: 'SUBMITTED',
      status_source: 'MANUAL',
      reason_text: `Submitted via channel ${input.channel}${input.lenderReference ? ` ref: ${input.lenderReference}` : ''}`,
      actor: ctx.principal.id,
      occurred_at: now,
    });

    // 4. Roll up application status to SUBMITTED (ROLLUP-1)
    if (app.status !== 'SANCTIONED' && app.status !== 'DISBURSED' && app.status !== 'SUBMITTED') {
      await this.deps.repository.updateApplicationStatus(
        tx,
        tenantId,
        row.application_id,
        'SUBMITTED',
        null,
        'ROLLUP-1',
        ctx.principal.id,
        id,
      );
    }

    // 5. Emit Outbox events
    await this.deps.repository.insertOutboxEvent(tx, {
      id: newId('evt'),
      tenant_id: tenantId,
      event_type: 'lender_case.submitted',
      event_version: 1,
      subject_type: 'LENDER_CASE',
      subject_id: id,
      correlation_id: ctx.correlationId,
      causation_id: idempotencyKey ?? null,
      chain_depth: 0,
      data: {
        lenderCaseId: id,
        applicationId: row.application_id,
        lenderId: row.lender_id,
        packageId: pkg.id,
        channel: input.channel,
      },
      occurred_at: now,
    });

    await this.deps.repository.insertOutboxEvent(tx, {
      id: newId('evt'),
      tenant_id: tenantId,
      event_type: 'lender_case.state_changed',
      event_version: 1,
      subject_type: 'LENDER_CASE',
      subject_id: id,
      correlation_id: ctx.correlationId,
      causation_id: idempotencyKey ?? null,
      chain_depth: 0,
      data: {
        lenderCaseId: id,
        fromStatus: 'PACKAGE_READY',
        toStatus: 'SUBMITTED',
      },
      occurred_at: now,
    });

    // 6. Audit event
    await this.deps.repository.insertAuditEvent(tx, {
      id: newId('aud'),
      tenant_id: tenantId,
      actor: ctx.principal.id,
      actor_kind: ctx.principal.kind,
      action: 'lender_case.submit',
      subject_type: 'LENDER_CASE',
      subject_id: id,
      correlation_id: ctx.correlationId,
      ip_address: ctx.ip,
      user_agent: ctx.userAgent,
      from_state: 'PACKAGE_READY',
      to_state: 'SUBMITTED',
      metadata: { channel: input.channel, packageId: pkg.id, dsrId },
      occurred_at: now,
    });

    return {
      lenderCaseId: id,
      status: 'SUBMITTED',
      packageId: pkg.id,
      manifest: pkg.manifest,
      applicationStatus: 'SUBMITTED',
      dataSharingRecordId: dsrId,
    };
  }

  /**
   * API-LCS-005: Record Status Update
   */
  async updateStatus(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    input: UpdateLenderCaseStatusInput,
    ifMatch?: number | null,
  ): Promise<LenderCaseResource> {
    const tenantId = ctx.principal.tenantId;
    this.requirePermission(ctx, 'lender_case.update_status');

    const row = await this.deps.repository.findCaseByIdForUpdate(tx, tenantId, id);
    if (!row) {
      throw AppError.of('NOT_FOUND', `Lender case '${id}' not found.`);
    }

    if (ifMatch !== undefined && ifMatch !== null && row.lock_version !== ifMatch) {
      throw AppError.of('VERSION_CONFLICT', `Version conflict: expected ${row.lock_version}, got ${ifMatch}`);
    }

    if (!isValidLenderCaseTransition(row.status, input.toStatus)) {
      throw AppError.of(
        'INVALID_TRANSITION',
        `Invalid status transition from '${row.status}' to '${input.toStatus}'.`,
      );
    }

    if (input.toStatus === 'REJECTED' && !input.declineReasonCode) {
      throw AppError.of(
        'VALIDATION_ERROR',
        'declineReasonCode is required when updating status to REJECTED.',
      );
    }

    const app = await this.deps.repository.findApplication(tx, tenantId, row.application_id);
    if (app) {
      this.checkBranchScope(ctx, 'lender_case.update_status', app.branch_id);
    }

    const now = ctx.now ?? new Date();
    const updatedCase = await this.deps.repository.updateCase(tx, tenantId, id, row.lock_version, {
      status: input.toStatus,
      decline_reason_code: input.declineReasonCode ?? row.decline_reason_code,
      lender_reference: input.lenderReference ?? row.lender_reference,
      last_status_at: now,
      status_source: input.statusSource,
      updated_by: ctx.principal.id,
    });

    if (!updatedCase) {
      throw AppError.of('VERSION_CONFLICT', 'Failed to update status due to version conflict.');
    }

    // Append to status history
    await this.deps.repository.insertStatusHistory(tx, {
      id: newId('lcsh'),
      tenant_id: tenantId,
      lender_case_id: id,
      from_status: row.status,
      to_status: input.toStatus,
      status_source: input.statusSource,
      reason_text:
        input.reasonText ?? (input.declineReasonCode ? `Decline reason: ${input.declineReasonCode}` : null),
      actor: ctx.principal.id,
      occurred_at: now,
    });

    // Roll up application status
    if (app) {
      await this.applyApplicationRollup(tx, tenantId, app.id, input.toStatus, id, ctx.principal.id);
    }

    // Outbox event
    await this.deps.repository.insertOutboxEvent(tx, {
      id: newId('evt'),
      tenant_id: tenantId,
      event_type: 'lender_case.state_changed',
      event_version: 1,
      subject_type: 'LENDER_CASE',
      subject_id: id,
      correlation_id: ctx.correlationId,
      chain_depth: 0,
      data: {
        lenderCaseId: id,
        fromStatus: row.status,
        toStatus: input.toStatus,
        declineReasonCode: input.declineReasonCode ?? null,
      },
      occurred_at: now,
    });

    // Audit event
    await this.deps.repository.insertAuditEvent(tx, {
      id: newId('aud'),
      tenant_id: tenantId,
      actor: ctx.principal.id,
      actor_kind: ctx.principal.kind,
      action: 'lender_case.update_status',
      subject_type: 'LENDER_CASE',
      subject_id: id,
      correlation_id: ctx.correlationId,
      ip_address: ctx.ip,
      user_agent: ctx.userAgent,
      from_state: row.status,
      to_state: input.toStatus,
      metadata: { reasonText: input.reasonText, declineReasonCode: input.declineReasonCode },
      occurred_at: now,
    });

    return this.toResource(updatedCase);
  }

  private async applyApplicationRollup(
    tx: Tx,
    tenantId: string,
    applicationId: string,
    caseStatus: LenderCaseStatus,
    caseId: string,
    actor: string,
  ): Promise<void> {
    if (caseStatus === 'SANCTIONED') {
      await this.deps.repository.updateApplicationStatus(
        tx,
        tenantId,
        applicationId,
        'SANCTIONED',
        null,
        'ROLLUP-4',
        actor,
        caseId,
      );
    } else if (caseStatus === 'PARTIALLY_DISBURSED') {
      await this.deps.repository.updateApplicationStatus(
        tx,
        tenantId,
        applicationId,
        'PARTIALLY_DISBURSED',
        null,
        'ROLLUP-5',
        actor,
        caseId,
      );
    } else if (caseStatus === 'DISBURSED') {
      await this.deps.repository.updateApplicationStatus(
        tx,
        tenantId,
        applicationId,
        'DISBURSED',
        null,
        'ROLLUP-5',
        actor,
        caseId,
      );
    } else if (caseStatus === 'REJECTED' || caseStatus === 'WITHDRAWN') {
      const allCases = await this.deps.repository.listCasesByApplication(tx, tenantId, applicationId);
      const allTerminal = allCases.every(
        (c) => c.status === 'REJECTED' || c.status === 'WITHDRAWN' || c.status === 'CLOSED',
      );
      if (allTerminal && allCases.length > 0) {
        const anySanctioned = allCases.some((c) => c.status === 'SANCTIONED' || c.status === 'DISBURSED');
        if (!anySanctioned) {
          const finalStatus = caseStatus === 'REJECTED' ? 'REJECTED' : 'WITHDRAWN';
          await this.deps.repository.updateApplicationStatus(
            tx,
            tenantId,
            applicationId,
            finalStatus,
            null,
            'ROLLUP-6',
            actor,
            caseId,
          );
        }
      }
    }
  }

  /**
   * API-LCS-006: Record Lender Query
   */
  async recordQuery(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    input: RecordLenderQueryInput,
    ifMatch?: number | null,
  ): Promise<{ query: LenderQueryResource; case: LenderCaseResource }> {
    const tenantId = ctx.principal.tenantId;
    this.requirePermission(ctx, 'lender_case.update_status');

    const row = await this.deps.repository.findCaseByIdForUpdate(tx, tenantId, id);
    if (!row) {
      throw AppError.of('NOT_FOUND', `Lender case '${id}' not found.`);
    }

    if (ifMatch !== undefined && ifMatch !== null && row.lock_version !== ifMatch) {
      throw AppError.of('VERSION_CONFLICT', `Version conflict: expected ${row.lock_version}, got ${ifMatch}`);
    }

    if (row.status !== 'SUBMITTED' && row.status !== 'UNDER_PROCESSING' && row.status !== 'QUERY_RESPONDED') {
      throw AppError.of('INVALID_STATE', `Cannot raise query in state '${row.status}'.`);
    }

    const app = await this.deps.repository.findApplication(tx, tenantId, row.application_id);
    if (app) {
      this.checkBranchScope(ctx, 'lender_case.update_status', app.branch_id);
    }

    const now = ctx.now ?? new Date();
    const queryId = newId('qry');
    let taskId: string | null = null;

    // Create follow-up task if TaskPort is configured (TASK-435)
    if (this.deps.taskPort && app) {
      try {
        const taskRes = await this.deps.taskPort.createTask(tx, ctx, {
          type: 'LENDER_QUERY',
          title: `Lender Query for Case ${row.attempt_no}: ${input.text.substring(0, 50)}`,
          owner: { userId: ctx.principal.id },
          linked: { type: 'LENDER_CASE', id, branchId: app.branch_id },
          priority: 'HIGH',
          slaClass: 'LENDER_QUERY',
          idempotencyKey: `lcs_query_${queryId}`,
        });
        taskId = taskRes.taskId;
      } catch {
        // Fallback gracefully if taskPort deferred
      }
    }

    const queryRow: LenderQueryRow = {
      id: queryId,
      tenant_id: tenantId,
      lender_case_id: id,
      text: input.text,
      requested_items: [...input.requestedItems],
      lender_due_date: input.lenderDueDate ? new Date(input.lenderDueDate) : null,
      task_id: taskId,
      response_manifest_id: null,
      responded_at: null,
      created_at: now,
      created_by: ctx.principal.id,
    };

    await this.deps.repository.insertQuery(tx, queryRow);

    // Transition case to QUERY_RAISED
    const updatedCase = await this.deps.repository.updateCase(tx, tenantId, id, row.lock_version, {
      status: 'QUERY_RAISED',
      last_status_at: now,
      updated_by: ctx.principal.id,
    });

    if (!updatedCase) {
      throw AppError.of('VERSION_CONFLICT', 'Failed to update case for query.');
    }

    await this.deps.repository.insertStatusHistory(tx, {
      id: newId('lcsh'),
      tenant_id: tenantId,
      lender_case_id: id,
      from_status: row.status,
      to_status: 'QUERY_RAISED',
      status_source: 'MANUAL',
      reason_text: `Lender query raised: ${input.text}`,
      actor: ctx.principal.id,
      occurred_at: now,
    });

    // Roll up application sub_status = QUERY_PENDING (ROLLUP-2)
    if (app) {
      await this.deps.repository.updateApplicationStatus(
        tx,
        tenantId,
        app.id,
        app.status,
        'QUERY_PENDING',
        'ROLLUP-2',
        ctx.principal.id,
        id,
      );
    }

    await this.deps.repository.insertOutboxEvent(tx, {
      id: newId('evt'),
      tenant_id: tenantId,
      event_type: 'lender_case.state_changed',
      event_version: 1,
      subject_type: 'LENDER_CASE',
      subject_id: id,
      correlation_id: ctx.correlationId,
      chain_depth: 0,
      data: {
        lenderCaseId: id,
        fromStatus: row.status,
        toStatus: 'QUERY_RAISED',
        queryId,
      },
      occurred_at: now,
    });

    return {
      query: this.toQueryResource(queryRow),
      case: this.toResource(updatedCase),
    };
  }

  /**
   * API-LCS-007: Record Query Response
   */
  async recordQueryResponse(
    tx: Tx,
    ctx: RequestContext,
    queryId: string,
    input: RecordQueryResponseInput,
  ): Promise<{ query: LenderQueryResource; case: LenderCaseResource }> {
    const tenantId = ctx.principal.tenantId;
    this.requirePermission(ctx, 'lender_case.update_status');

    let targetQueryId = queryId;
    if (queryId.startsWith('lcs_')) {
      const queries = await this.deps.repository.listQueriesByCase(tx, tenantId, queryId);
      const openQuery = queries.slice().reverse().find((q) => !q.responded_at);
      if (!openQuery) {
        throw AppError.of('NOT_FOUND', `No pending lender query found for lender case '${queryId}'.`);
      }
      targetQueryId = openQuery.id;
    }

    const query = await this.deps.repository.findQueryById(tx, tenantId, targetQueryId);
    if (!query) {
      throw AppError.of('NOT_FOUND', `Lender query '${targetQueryId}' not found.`);
    }
    if (query.responded_at) {
      throw AppError.of('INVALID_STATE', 'This lender query has already been answered.');
    }

    const row = await this.deps.repository.findCaseByIdForUpdate(tx, tenantId, query.lender_case_id);
    if (!row) {
      throw AppError.of('NOT_FOUND', `Lender case '${query.lender_case_id}' not found.`);
    }

    if (row.status !== 'QUERY_RAISED') {
      throw AppError.of('INVALID_STATE', `Case is not in QUERY_RAISED status (current: ${row.status}).`);
    }

    const app = await this.deps.repository.findApplication(tx, tenantId, row.application_id);
    if (!app) {
      throw AppError.of('NOT_FOUND', `Application '${row.application_id}' not found.`);
    }
    this.checkBranchScope(ctx, 'lender_case.update_status', app.branch_id);
    // The response goes to the same lender, so it needs the same consent, checked again now.
    const consentId = await this.requireShareConsent(tx, app.customer_id, row.lender_id);

    const now = ctx.now ?? new Date();

    if (!this.deps.applicationPort) {
      throw AppError.of('DEPENDENCY_UNAVAILABLE', 'The document checklist is not available to answer the query.');
    }
    // The documents cited must be this application's own checklist documents. The manifest records each one's hash.
    const checklist = await this.deps.applicationPort.getSubmissionDocuments(tx, ctx, row.application_id);
    const references = [...new Set(input.documentReferences)];
    const known = new Map(checklist.documents.flatMap((d) => (d.documentId ? [[d.documentId, d] as const] : [])));
    const unknown = references.filter((ref) => !known.has(ref));
    if (unknown.length > 0) {
      throw AppError.of(
        'VALIDATION_ERROR',
        'A referenced document does not belong to this application.',
        unknown.map(() => ({ field: 'documentReferences', issue: 'NOT_IN_APPLICATION' })),
      );
    }
    const documents = references.map((ref) => {
      const d = known.get(ref)!;
      return { documentId: ref, documentTypeCode: d.documentTypeCode, sha256: d.sha256 };
    });

    // Create QUERY_RESPONSE package
    const packageId = newId('pkg');
    const manifest = {
      queryId: targetQueryId,
      response: input.text,
      documentReferences: references,
      documents,
      respondedAt: now.toISOString(),
    };
    const manifestSha256 = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');

    await this.deps.repository.insertPackage(tx, {
      id: packageId,
      tenant_id: tenantId,
      lender_case_id: row.id,
      kind: 'QUERY_RESPONSE',
      manifest,
      manifest_sha256: manifestSha256,
      consent_ids: [consentId],
      built_by: ctx.principal.id,
      built_at: now,
      frozen_at: now,
    });

    // Update query
    const updatedQuery = await this.deps.repository.updateQuery(tx, tenantId, targetQueryId, {
      response_manifest_id: packageId,
      responded_at: now,
    });

    // Update case to QUERY_RESPONDED
    const updatedCase = await this.deps.repository.updateCase(tx, tenantId, row.id, row.lock_version, {
      status: 'QUERY_RESPONDED',
      last_status_at: now,
      updated_by: ctx.principal.id,
    });

    if (!updatedCase) {
      throw AppError.of('VERSION_CONFLICT', 'Failed to update case for query response.');
    }

    await this.deps.repository.insertStatusHistory(tx, {
      id: newId('lcsh'),
      tenant_id: tenantId,
      lender_case_id: row.id,
      from_status: 'QUERY_RAISED',
      to_status: 'QUERY_RESPONDED',
      status_source: 'MANUAL',
      reason_text: `Responded to query: ${input.text}`,
      actor: ctx.principal.id,
      occurred_at: now,
    });

    // Roll up application: clear QUERY_PENDING (ROLLUP-3)
    if (app) {
      await this.deps.repository.updateApplicationStatus(
        tx,
        tenantId,
        app.id,
        app.status,
        null,
        'ROLLUP-3',
        ctx.principal.id,
        row.id,
      );
    }

    await this.deps.repository.insertOutboxEvent(tx, {
      id: newId('evt'),
      tenant_id: tenantId,
      event_type: 'lender_case.state_changed',
      event_version: 1,
      subject_type: 'LENDER_CASE',
      subject_id: row.id,
      correlation_id: ctx.correlationId,
      chain_depth: 0,
      data: {
        lenderCaseId: row.id,
        fromStatus: 'QUERY_RAISED',
        toStatus: 'QUERY_RESPONDED',
        queryId: targetQueryId,
      },
      occurred_at: now,
    });

    return {
      query: updatedQuery ? this.toQueryResource(updatedQuery) : this.toQueryResource(query),
      case: this.toResource(updatedCase),
    };
  }
}
