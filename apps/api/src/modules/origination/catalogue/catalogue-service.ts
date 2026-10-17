// apps/api/src/modules/origination/catalogue/catalogue-service.ts — owner: Developer 5 (Bhushan)
import {
  AppError,
  type AuditPort,
  type CreateEmpanelmentInput,
  type CreateLenderInput,
  type CreateProductInput,
  type CreateProductVersionInput,
  type EmpanelmentResponse,
  type LenderContactResponse,
  type LenderListQuery,
  type LenderResponse,
  type PermissionCode,
  type ProductListQuery,
  type ProductResponse,
  type ProductVersionResponse,
  type RequestContext,
  type SetLenderContactsInput,
  type Tx,
  type UpdateEmpanelmentInput,
  type UpdateLenderInput,
  type UpdateProductStatusInput,
} from '@dsa/contracts';
import { ulid } from 'ulid';
import type {
  CatalogueRepository,
  EmpanelmentRow,
  LenderContactRow,
  LenderRow,
  LoanProductRow,
  LoanProductVersionRow,
} from './repository';

export interface CatalogueServiceDeps {
  repository: CatalogueRepository;
  audit?: AuditPort;
}

export class CatalogueService {
  constructor(private readonly deps: CatalogueServiceDeps) {}

  private nextId(prefix: string): string {
    return `${prefix}_${ulid()}`;
  }

  private assertPermission(ctx: RequestContext, permission: PermissionCode): void {
    const hasGrant = ctx.principal.grants.some((g) => g.code === permission);
    if (!hasGrant) {
      throw AppError.of('FORBIDDEN', `Permission '${permission}' is required.`);
    }
  }

  // --- LENDERS ---

  async createLender(tx: Tx, ctx: RequestContext, input: CreateLenderInput): Promise<LenderResponse> {
    this.assertPermission(ctx, 'config.manage');

    const tenantId = ctx.principal.tenantId;
    const existing = await this.deps.repository.findLenderByName(tx, tenantId, input.name);
    if (existing) {
      throw AppError.of('VALIDATION_ERROR', `Lender with name "${input.name}" already exists.`, [
        { field: 'name', issue: 'DUPLICATE_NAME' },
      ]);
    }

    const id = this.nextId('lnd');
    const now = new Date();
    const row: LenderRow = {
      id,
      tenant_id: tenantId,
      name: input.name,
      lender_type: input.lenderType,
      regulator_ref: input.regulatorRef ?? null,
      status: input.status,
      status_reason: input.statusReason ?? null,
      lock_version: 0,
      created_at: now,
      created_by: ctx.principal.id,
      updated_at: now,
      updated_by: ctx.principal.id,
    };

    await this.deps.repository.insertLender(tx, row);

    if (this.deps.audit) {
      await this.deps.audit.record(tx, ctx, {
        action: 'lender.created',
        entityType: 'lender',
        entityId: id,
        after: { name: row.name, status: row.status },
      });
    }

    return this.toLenderResponse(row);
  }

  async getLender(tx: Tx, ctx: RequestContext, id: string): Promise<LenderResponse> {
    const row = await this.deps.repository.findLenderById(tx, ctx.principal.tenantId, id);
    if (!row) {
      throw AppError.of('NOT_FOUND', `Lender ${id} not found.`);
    }
    return this.toLenderResponse(row);
  }

  async listLenders(
    tx: Tx,
    ctx: RequestContext,
    query: LenderListQuery,
  ): Promise<{ data: LenderResponse[]; meta: { nextCursor: string | null; limit: number } }> {
    const { rows, nextCursor } = await this.deps.repository.listLenders(tx, ctx.principal.tenantId, {
      status: query.status,
      lenderType: query.lenderType,
      cursor: query.cursor,
      limit: query.limit,
    });
    return {
      data: rows.map((r) => this.toLenderResponse(r)),
      meta: { nextCursor, limit: query.limit },
    };
  }

  async updateLender(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    ifMatchVersion: number,
    input: UpdateLenderInput,
  ): Promise<LenderResponse> {
    this.assertPermission(ctx, 'config.manage');

    const tenantId = ctx.principal.tenantId;
    const updated = await this.deps.repository.updateLender(tx, tenantId, id, ifMatchVersion, {
      name: input.name,
      lender_type: input.lenderType,
      regulator_ref: input.regulatorRef,
      status: input.status,
      status_reason: input.statusReason,
      updated_by: ctx.principal.id,
    });

    if (!updated) {
      const current = await this.deps.repository.findLenderById(tx, tenantId, id);
      if (!current) {
        throw AppError.of('NOT_FOUND', `Lender ${id} not found.`);
      }
      throw AppError.of(
        'VERSION_CONFLICT',
        `Lender version conflict. Current version is ${current.lock_version}.`,
      );
    }

    return this.toLenderResponse(updated);
  }

  // --- EMPANELMENTS ---

  async createEmpanelment(
    tx: Tx,
    ctx: RequestContext,
    lenderId: string,
    input: CreateEmpanelmentInput,
  ): Promise<EmpanelmentResponse> {
    this.assertPermission(ctx, 'config.manage');

    const tenantId = ctx.principal.tenantId;
    const lender = await this.deps.repository.findLenderById(tx, tenantId, lenderId);
    if (!lender) {
      throw AppError.of('NOT_FOUND', `Lender ${lenderId} not found.`);
    }

    const id = this.nextId('emp');
    const now = new Date();
    const validRange = `[${input.validFrom},${input.validTo}]`;

    const row: EmpanelmentRow = {
      id,
      tenant_id: tenantId,
      organisation_id: input.organisationId,
      lender_id: lenderId,
      dsa_code: input.dsaCode,
      valid_range: validRange,
      permitted_categories: input.permittedCategories,
      permitted_geos: input.permittedGeos ?? null,
      agreement_document_id: input.agreementDocumentId ?? null,
      status: input.status ?? 'ACTIVE',
      lock_version: 0,
      created_at: now,
      created_by: ctx.principal.id,
      updated_at: now,
      updated_by: ctx.principal.id,
    };

    await this.deps.repository.insertEmpanelment(tx, row);
    return this.toEmpanelmentResponse(row);
  }

  async getEmpanelment(tx: Tx, ctx: RequestContext, id: string): Promise<EmpanelmentResponse> {
    const row = await this.deps.repository.findEmpanelmentById(tx, ctx.principal.tenantId, id);
    if (!row) {
      throw AppError.of('NOT_FOUND', `Empanelment ${id} not found.`);
    }
    return this.toEmpanelmentResponse(row);
  }

  async listEmpanelments(tx: Tx, ctx: RequestContext, lenderId: string): Promise<EmpanelmentResponse[]> {
    const rows = await this.deps.repository.listEmpanelments(tx, ctx.principal.tenantId, lenderId);
    return rows.map((r) => this.toEmpanelmentResponse(r));
  }

  async updateEmpanelment(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    ifMatchVersion: number,
    input: UpdateEmpanelmentInput,
  ): Promise<EmpanelmentResponse> {
    this.assertPermission(ctx, 'config.manage');

    const updated = await this.deps.repository.updateEmpanelment(
      tx,
      ctx.principal.tenantId,
      id,
      ifMatchVersion,
      {
        permitted_categories: input.permittedCategories,
        permitted_geos: input.permittedGeos,
        agreement_document_id: input.agreementDocumentId,
        status: input.status,
        updated_by: ctx.principal.id,
      },
    );

    if (!updated) {
      throw AppError.of('VERSION_CONFLICT', `Empanelment version conflict for ${id}.`);
    }

    return this.toEmpanelmentResponse(updated);
  }

  // --- CONTACTS ---

  async setLenderContacts(
    tx: Tx,
    ctx: RequestContext,
    lenderId: string,
    input: SetLenderContactsInput,
  ): Promise<LenderContactResponse[]> {
    this.assertPermission(ctx, 'config.manage');

    const tenantId = ctx.principal.tenantId;
    const lender = await this.deps.repository.findLenderById(tx, tenantId, lenderId);
    if (!lender) {
      throw AppError.of('NOT_FOUND', `Lender ${lenderId} not found.`);
    }

    const now = new Date();
    const rows: LenderContactRow[] = input.contacts.map((c) => ({
      id: this.nextId('lcon'),
      tenant_id: tenantId,
      lender_id: lenderId,
      name: c.name,
      role: c.role,
      email: c.email ?? null,
      phone: c.phone ?? null,
      channel: c.channel,
      escalation_level: c.escalationLevel,
      lock_version: 0,
      created_at: now,
      created_by: ctx.principal.id,
      updated_at: now,
      updated_by: ctx.principal.id,
    }));

    await this.deps.repository.replaceLenderContacts(tx, tenantId, lenderId, rows);
    return rows.map((r) => this.toContactResponse(r));
  }

  async listLenderContacts(tx: Tx, ctx: RequestContext, lenderId: string): Promise<LenderContactResponse[]> {
    const rows = await this.deps.repository.listLenderContacts(tx, ctx.principal.tenantId, lenderId);
    return rows.map((r) => this.toContactResponse(r));
  }

  // --- PRODUCTS ---

  async createProduct(tx: Tx, ctx: RequestContext, input: CreateProductInput): Promise<ProductResponse> {
    this.assertPermission(ctx, 'config.manage');

    const tenantId = ctx.principal.tenantId;
    const lender = await this.deps.repository.findLenderById(tx, tenantId, input.lenderId);
    if (!lender) {
      throw AppError.of('NOT_FOUND', `Lender ${input.lenderId} not found.`);
    }
    if (lender.status === 'PAUSED') {
      throw AppError.of('LENDER_PAUSED', `Lender ${lender.name} is currently PAUSED.`);
    }

    const id = this.nextId('prd');
    const now = new Date();
    const row: LoanProductRow = {
      id,
      tenant_id: tenantId,
      lender_id: input.lenderId,
      name: input.name,
      category: input.category,
      applicant_types: input.applicantTypes,
      secured: input.secured,
      owner_user_id: input.ownerUserId ?? null,
      next_review_at: input.nextReviewAt ? new Date(input.nextReviewAt) : null,
      status: 'ACTIVE',
      lock_version: 0,
      created_at: now,
      created_by: ctx.principal.id,
      updated_at: now,
      updated_by: ctx.principal.id,
    };

    await this.deps.repository.insertProduct(tx, row);

    let initialVersion: LoanProductVersionRow | null = null;
    if (input.initialVersion) {
      const vId = this.nextId('lpv');
      initialVersion = {
        id: vId,
        tenant_id: tenantId,
        product_id: id,
        version_no: 1,
        effective_from: input.initialVersion.effectiveFrom
          ? new Date(input.initialVersion.effectiveFrom)
          : now,
        amount_min: input.initialVersion.amountMin,
        amount_max: input.initialVersion.amountMax,
        currency: input.initialVersion.currency,
        tenure_min_months: input.initialVersion.tenureMinMonths,
        tenure_max_months: input.initialVersion.tenureMaxMonths,
        illustrative_rate_text: input.initialVersion.illustrativeRateText ?? null,
        status: 'ACTIVE',
        created_at: now,
        created_by: ctx.principal.id,
      };
      await this.deps.repository.insertProductVersion(tx, initialVersion);
    }

    return this.toProductResponse(row, initialVersion, lender.name);
  }

  async getProduct(tx: Tx, ctx: RequestContext, id: string): Promise<ProductResponse> {
    const tenantId = ctx.principal.tenantId;
    const product = await this.deps.repository.findProductById(tx, tenantId, id);
    if (!product) {
      throw AppError.of('NOT_FOUND', `Product ${id} not found.`);
    }
    const version = await this.deps.repository.findActiveProductVersion(tx, tenantId, id);
    const lender = await this.deps.repository.findLenderById(tx, tenantId, product.lender_id);
    return this.toProductResponse(product, version, lender?.name);
  }

  async listProducts(
    tx: Tx,
    ctx: RequestContext,
    query: ProductListQuery,
  ): Promise<{ data: ProductResponse[]; meta: { nextCursor: string | null; limit: number } }> {
    const tenantId = ctx.principal.tenantId;
    const { rows, nextCursor } = await this.deps.repository.listProducts(tx, tenantId, {
      lenderId: query.lenderId,
      category: query.category,
      status: query.status,
      cursor: query.cursor,
      limit: query.limit,
    });

    const data: ProductResponse[] = [];
    for (const p of rows) {
      const version = await this.deps.repository.findActiveProductVersion(tx, tenantId, p.id);
      const lender = await this.deps.repository.findLenderById(tx, tenantId, p.lender_id);
      data.push(this.toProductResponse(p, version, lender?.name));
    }

    return {
      data,
      meta: { nextCursor, limit: query.limit },
    };
  }

  async updateProductStatus(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    input: UpdateProductStatusInput,
  ): Promise<ProductResponse> {
    this.assertPermission(ctx, 'config.manage');

    const tenantId = ctx.principal.tenantId;
    const updated = await this.deps.repository.updateProductStatus(tx, tenantId, id, input.status);
    if (!updated) {
      throw AppError.of('NOT_FOUND', `Product ${id} not found.`);
    }

    const version = await this.deps.repository.findActiveProductVersion(tx, tenantId, id);
    const lender = await this.deps.repository.findLenderById(tx, tenantId, updated.lender_id);
    return this.toProductResponse(updated, version, lender?.name);
  }

  async createProductVersion(
    tx: Tx,
    ctx: RequestContext,
    productId: string,
    input: CreateProductVersionInput,
  ): Promise<ProductVersionResponse> {
    this.assertPermission(ctx, 'config.manage');

    const tenantId = ctx.principal.tenantId;
    const product = await this.deps.repository.findProductById(tx, tenantId, productId);
    if (!product) {
      throw AppError.of('NOT_FOUND', `Product ${productId} not found.`);
    }

    const existingVersions = await this.deps.repository.listProductVersions(tx, tenantId, productId);
    const nextVersionNo = (existingVersions[0]?.version_no ?? 0) + 1;
    const now = new Date();

    const row: LoanProductVersionRow = {
      id: this.nextId('lpv'),
      tenant_id: tenantId,
      product_id: productId,
      version_no: nextVersionNo,
      effective_from: input.effectiveFrom ? new Date(input.effectiveFrom) : now,
      amount_min: input.amountMin,
      amount_max: input.amountMax,
      currency: input.currency,
      tenure_min_months: input.tenureMinMonths,
      tenure_max_months: input.tenureMaxMonths,
      illustrative_rate_text: input.illustrativeRateText ?? null,
      fee_text: input.feeText ?? null,
      geo_rules: input.geoRules ?? null,
      document_profile_id: input.documentProfileId ?? null,
      workflow_profile: input.workflowProfile ?? null,
      status: 'ACTIVE',
      created_at: now,
      created_by: ctx.principal.id,
    };

    await this.deps.repository.insertProductVersion(tx, row);
    return this.toVersionResponse(row);
  }

  async getProductVersion(tx: Tx, ctx: RequestContext, versionId: string): Promise<ProductVersionResponse> {
    const row = await this.deps.repository.findProductVersionById(tx, ctx.principal.tenantId, versionId);
    if (!row) {
      throw AppError.of('NOT_FOUND', `Product version ${versionId} not found.`);
    }
    return this.toVersionResponse(row);
  }

  // --- CROSS-MODULE GATE HELPERS FOR ADWAIT (Lender Cases / Origination) ---

  async validateLenderAndEmpanelmentForCase(
    tx: Tx,
    tenantId: string,
    lenderId: string,
    category: string,
  ): Promise<void> {
    const lender = await this.deps.repository.findLenderById(tx, tenantId, lenderId);
    if (!lender) {
      throw AppError.of('NOT_FOUND', `Lender ${lenderId} not found.`);
    }
    if (lender.status === 'PAUSED') {
      throw AppError.of(
        'LENDER_PAUSED',
        `[LENDER_PAUSED] Lender ${lender.name} is paused. Case cannot be submitted.`,
      );
    }
    if (lender.status === 'TERMINATED') {
      throw AppError.of('INVALID_STATE', `[INVALID_STATE] Lender ${lender.name} is terminated.`);
    }

    const empanelment = await this.deps.repository.findActiveEmpanelmentForLender(
      tx,
      tenantId,
      lenderId,
      category,
    );
    if (!empanelment) {
      throw AppError.of(
        'EMPANELMENT_INACTIVE',
        `[EMPANELMENT_INACTIVE] No active empanelment found for lender ${lender.name} in category ${category}.`,
      );
    }
  }

  // --- RESPONSE MAPPERS ---

  private toLenderResponse(row: LenderRow): LenderResponse {
    return {
      id: row.id,
      name: row.name,
      lenderType: row.lender_type as any,
      regulatorRef: row.regulator_ref,
      status: row.status as any,
      statusReason: row.status_reason,
      lockVersion: row.lock_version,
      createdAt: row.created_at.toISOString(),
      createdBy: row.created_by,
      updatedAt: row.updated_at.toISOString(),
      updatedBy: row.updated_by,
    };
  }

  private toEmpanelmentResponse(row: EmpanelmentRow): EmpanelmentResponse {
    return {
      id: row.id,
      organisationId: row.organisation_id,
      lenderId: row.lender_id,
      dsaCode: row.dsa_code,
      validRange: String(row.valid_range),
      permittedCategories: row.permitted_categories,
      permittedGeos: row.permitted_geos ?? null,
      agreementDocumentId: row.agreement_document_id ?? null,
      status: row.status as any,
      lockVersion: row.lock_version,
      createdAt: row.created_at.toISOString(),
      createdBy: row.created_by,
      updatedAt: row.updated_at.toISOString(),
      updatedBy: row.updated_by,
    };
  }

  private toContactResponse(row: LenderContactRow): LenderContactResponse {
    return {
      id: row.id,
      lenderId: row.lender_id,
      name: row.name,
      role: row.role,
      email: row.email,
      phone: row.phone,
      channel: row.channel as any,
      escalationLevel: row.escalation_level,
      lockVersion: row.lock_version,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private toVersionResponse(row: LoanProductVersionRow): ProductVersionResponse {
    return {
      id: row.id,
      productId: row.product_id,
      versionNo: row.version_no,
      effectiveFrom: row.effective_from.toISOString(),
      amountMin: String(row.amount_min),
      amountMax: String(row.amount_max),
      currency: row.currency,
      tenureMinMonths: row.tenure_min_months,
      tenureMaxMonths: row.tenure_max_months,
      illustrativeRateText: row.illustrative_rate_text,
      feeText: row.fee_text ?? null,
      geoRules: row.geo_rules ?? null,
      documentProfileId: row.document_profile_id ?? null,
      workflowProfile: row.workflow_profile ?? null,
      status: row.status as any,
      createdAt: row.created_at.toISOString(),
    };
  }

  private toProductResponse(
    row: LoanProductRow,
    version: LoanProductVersionRow | null,
    lenderName?: string,
  ): ProductResponse {
    return {
      id: row.id,
      lenderId: row.lender_id,
      lenderName,
      name: row.name,
      category: row.category as any,
      applicantTypes: row.applicant_types,
      secured: row.secured,
      ownerUserId: row.owner_user_id,
      nextReviewAt: row.next_review_at ? row.next_review_at.toISOString().slice(0, 10) : null,
      status: row.status as any,
      lockVersion: row.lock_version,
      activeVersion: version ? this.toVersionResponse(version) : null,
      createdAt: row.created_at.toISOString(),
      createdBy: row.created_by,
      updatedAt: row.updated_at.toISOString(),
      updatedBy: row.updated_by,
    };
  }
}
