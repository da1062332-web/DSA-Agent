// apps/api/src/modules/partner-api/service.ts — owner: Akash (Module 37: API Development)
import crypto from 'node:crypto';
import {
  AppError,
  type CreateApiKeyInput,
  type ApiKeyResponse,
  type IdPrefix,
  type PartnerCreateLeadInput,
  type PartnerLeadResponse,
  type PartnerListLeadsQuery,
  type PartnerListLeadsResponse,
  type PartnerCreateApplicationInput,
  type PartnerApplicationResponse,
  type PartnerSanctionOffersResponse,
  type PartnerUploadSessionRequest,
  type PartnerUploadSessionResponse,
  type CreateApiClientInput,
  type UpdateApiClientInput,
  type ApiClientResponse,
  type RotateClientSecretResponse,
  type RequestContext,
} from '@dsa/contracts';
import type { ApiDeps } from '../types';
import { InMemoryApiClientRepository, type ApiClientRepository } from './api-client-repository';
import { hashApiKey, InMemoryApiKeyStore, type ApiKeyRecord, type ApiKeyStore } from './auth-middleware';

export interface ApiClientRecord {
  id: string;
  tenantId: string;
  clientId: string;
  clientSecretHash: string;
  name: string;
  partnerName: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  scopes: string[];
  rateLimitRpm: number;
  allowedIps?: string[] | null;
  lastUsedAt?: string | null;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export interface PartnerLeadRecord {
  id: string;
  tenantId: string;
  partnerId: string;
  externalReferenceId: string;
  status:
    'RECEIVED' | 'DUPLICATE_SUSPECTED' | 'QUALIFIED' | 'CONVERTED' | 'CONTACTED' | 'DROPPED' | 'REJECTED';
  loanProductCode: string;
  requestedAmount: { amount: string; currency: string };
  applicant: {
    firstName: string;
    lastName: string;
    mobile: string;
    email: string;
    city: string;
    state: string;
    pincode: string;
  };
  duplicateFlag: boolean;
  conversionApplicationId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PartnerApplicationRecord {
  id: string;
  tenantId: string;
  partnerId: string;
  leadId: string;
  productId: string;
  appliedAmount: { amount: string; currency: string };
  tenureMonths: number;
  status:
    | 'DRAFT'
    | 'SUBMITTED'
    | 'UNDERWRITING'
    | 'LENDER_PROCESSING'
    | 'APPROVED'
    | 'SANCTIONED'
    | 'DISBURSED'
    | 'REJECTED'
    | 'CANCELLED';
  currentStage: string;
  sanctionCount: number;
  createdAt: string;
  updatedAt: string;
}

export class PartnerApiService {
  private leadsMap = new Map<string, PartnerLeadRecord>();
  private applicationsMap = new Map<string, PartnerApplicationRecord>();
  private idempotencyStore = new Map<string, { body: unknown; statusCode: number }>();
  private readonly apiClients: ApiClientRepository;

  constructor(
    private deps: ApiDeps,
    private apiKeyStore: ApiKeyStore,
    apiClients?: ApiClientRepository,
  ) {
    this.apiClients =
      apiClients ??
      (deps.apiClientRepository as ApiClientRepository | undefined) ??
      new InMemoryApiClientRepository();
  }

  // Helper for masking
  private maskMobile(m: string): string {
    const cleaned = m.trim();
    if (cleaned.length < 10) return '***';
    const last3 = cleaned.slice(-3);
    const first3 = cleaned.slice(0, Math.min(3, cleaned.length - 6));
    return `${first3}***${last3}`;
  }

  private maskEmail(e: string): string {
    const parts = e.split('@');
    if (parts.length !== 2) return '***@***';
    const name = parts[0] ?? '';
    const domain = parts[1] ?? '';
    const maskedName = name.length <= 2 ? `${name[0]}*` : `${name[0]}***${name[name.length - 1]}`;
    return `${maskedName}@${domain}`;
  }

  // S2/S3 Prohibited data check
  private scanProhibitedData(val: unknown) {
    if (!val) return;
    const str = typeof val === 'string' ? val : JSON.stringify(val);
    // PAN: [A-Z]{5}[0-9]{4}[A-Z]{1}
    if (/[A-Za-z]{5}\d{4}[A-Za-z]/.test(str)) {
      throw AppError.of(
        'VALIDATION_ERROR',
        'Plaintext PAN detected. S3-class identity data is prohibited in Partner API.',
        [{ field: 'metadata', issue: 'S3_PAN_PROHIBITED' }],
      );
    }
    // Aadhaar: 12 digits
    if (/\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/.test(str)) {
      throw AppError.of(
        'VALIDATION_ERROR',
        'Plaintext Aadhaar detected. S3-class identity data is prohibited in Partner API.',
        [{ field: 'metadata', issue: 'S3_AADHAAR_PROHIBITED' }],
      );
    }
  }

  private nextId(prefix: IdPrefix): string {
    return this.deps.ids.next(prefix);
  }

  // ==========================================================================
  // API Key Management
  // ==========================================================================

  async createApiKey(ctx: RequestContext, input: CreateApiKeyInput): Promise<ApiKeyResponse> {
    const { principal } = ctx;
    const hasManage = principal.grants.some((g) => g.code === 'api.manage' || g.code === 'config.manage');
    if (!hasManage) {
      throw AppError.of('FORBIDDEN', 'Permission denied: api.manage required.');
    }

    const keyId = this.nextId('apk');
    const secretRandom = crypto.randomBytes(24).toString('hex');
    const secretKey = `dsa_live_${secretRandom}`;
    const keyPrefix = `dsa_live_${secretRandom.slice(0, 8)}`;
    const keyHash = hashApiKey(secretKey);

    const record: ApiKeyRecord = {
      id: keyId,
      tenantId: principal.tenantId,
      partnerId: input.partnerId,
      name: input.name,
      keyPrefix,
      keyHash,
      scopes: input.scopes,
      allowedIps: input.allowedIps ?? null,
      rateLimitRpm: input.rateLimitRpm,
      status: 'ACTIVE',
      expiresAt: input.expiresAt ?? null,
    };

    if (this.apiKeyStore instanceof InMemoryApiKeyStore) {
      this.apiKeyStore.addKey(record);
    }

    return {
      id: keyId,
      tenantId: principal.tenantId,
      partnerId: input.partnerId,
      name: input.name,
      keyPrefix,
      scopes: input.scopes,
      allowedIps: input.allowedIps ?? null,
      rateLimitRpm: input.rateLimitRpm,
      status: 'ACTIVE',
      expiresAt: input.expiresAt ?? null,
      lastUsedAt: null,
      lockVersion: 0,
      createdAt: ctx.now.toISOString(),
      secretKey,
    };
  }

  // ==========================================================================
  // Partner Lead Ingestion & Tracking
  // ==========================================================================

  async ingestLead(
    ctx: RequestContext,
    input: PartnerCreateLeadInput,
    idemKey: string,
  ): Promise<{ lead: PartnerLeadResponse; isReplayed: boolean }> {
    const { principal } = ctx;

    // 1. Idempotency Check
    const cacheKey = `${principal.tenantId}:lead:${idemKey}`;
    const cached = this.idempotencyStore.get(cacheKey);
    if (cached) {
      return { lead: cached.body as PartnerLeadResponse, isReplayed: true };
    }

    // 2. Authorization
    const hasIngest = principal.grants.some(
      (g) => g.code === 'partner.lead_ingest' || g.code === 'lead.create',
    );
    if (!hasIngest) {
      throw AppError.of('FORBIDDEN', 'Permission denied: partner.lead_ingest required.');
    }

    // 3. Sensitive Data Scan on metadata
    if (input.metadata) {
      this.scanProhibitedData(input.metadata);
    }

    // 4. Duplicate Detection
    const mobileClean = input.applicant.mobile.trim();
    const emailClean = input.applicant.email.trim().toLowerCase();
    let isDuplicate = false;

    for (const existing of this.leadsMap.values()) {
      if (existing.tenantId === principal.tenantId) {
        if (existing.applicant.mobile === mobileClean || existing.applicant.email === emailClean) {
          isDuplicate = true;
          break;
        }
      }
    }

    const leadId = this.nextId('lead');
    const partnerId = principal.kind === 'SERVICE' ? principal.id : (input.connectorId ?? 'direct');
    const status = isDuplicate ? 'DUPLICATE_SUSPECTED' : 'RECEIVED';

    const record: PartnerLeadRecord = {
      id: leadId,
      tenantId: principal.tenantId,
      partnerId,
      externalReferenceId: input.externalReferenceId,
      status,
      loanProductCode: input.loanProductCode,
      requestedAmount: input.requestedAmount,
      applicant: {
        firstName: input.applicant.firstName,
        lastName: input.applicant.lastName,
        mobile: mobileClean,
        email: emailClean,
        city: input.applicant.city,
        state: input.applicant.state,
        pincode: input.applicant.pincode,
      },
      duplicateFlag: isDuplicate,
      conversionApplicationId: null,
      createdAt: ctx.now.toISOString(),
      updatedAt: ctx.now.toISOString(),
    };

    this.leadsMap.set(leadId, record);

    const response: PartnerLeadResponse = {
      id: leadId,
      externalReferenceId: input.externalReferenceId,
      tenantId: principal.tenantId,
      status,
      requestedAmount: input.requestedAmount,
      loanProductCode: input.loanProductCode,
      applicantName: `${input.applicant.firstName} ${input.applicant.lastName}`,
      maskedMobile: this.maskMobile(mobileClean),
      maskedEmail: this.maskEmail(emailClean),
      city: input.applicant.city,
      duplicateFlag: isDuplicate,
      conversionApplicationId: null,
      createdAt: ctx.now.toISOString(),
      updatedAt: ctx.now.toISOString(),
    };

    this.idempotencyStore.set(cacheKey, { body: response, statusCode: 201 });

    return { lead: response, isReplayed: false };
  }

  async getLead(ctx: RequestContext, id: string): Promise<PartnerLeadResponse> {
    const { principal } = ctx;
    const hasRead = principal.grants.some(
      (g) => g.code === 'partner.lead_ingest' || g.code === 'lead.read' || g.code === 'api.read',
    );
    if (!hasRead) {
      throw AppError.of('FORBIDDEN', 'Permission denied: partner.lead_ingest required.');
    }

    const lead = this.leadsMap.get(id);
    if (!lead || lead.tenantId !== principal.tenantId) {
      throw AppError.of('NOT_FOUND', `Lead ${id} not found.`);
    }

    return {
      id: lead.id,
      externalReferenceId: lead.externalReferenceId,
      tenantId: lead.tenantId,
      status: lead.status,
      requestedAmount: lead.requestedAmount,
      loanProductCode: lead.loanProductCode,
      applicantName: `${lead.applicant.firstName} ${lead.applicant.lastName}`,
      maskedMobile: this.maskMobile(lead.applicant.mobile),
      maskedEmail: this.maskEmail(lead.applicant.email),
      city: lead.applicant.city,
      duplicateFlag: lead.duplicateFlag,
      conversionApplicationId: lead.conversionApplicationId ?? null,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
    };
  }

  async listLeads(ctx: RequestContext, query: PartnerListLeadsQuery): Promise<PartnerListLeadsResponse> {
    const { principal } = ctx;
    const hasRead = principal.grants.some(
      (g) => g.code === 'partner.lead_ingest' || g.code === 'lead.read' || g.code === 'api.read',
    );
    if (!hasRead) {
      throw AppError.of('FORBIDDEN', 'Permission denied: partner.lead_ingest required.');
    }

    const matched: PartnerLeadResponse[] = [];
    for (const lead of this.leadsMap.values()) {
      if (lead.tenantId !== principal.tenantId) continue;
      if (query.status && lead.status !== query.status) continue;
      if (query.externalReferenceId && lead.externalReferenceId !== query.externalReferenceId) continue;

      matched.push({
        id: lead.id,
        externalReferenceId: lead.externalReferenceId,
        tenantId: lead.tenantId,
        status: lead.status,
        requestedAmount: lead.requestedAmount,
        loanProductCode: lead.loanProductCode,
        applicantName: `${lead.applicant.firstName} ${lead.applicant.lastName}`,
        maskedMobile: this.maskMobile(lead.applicant.mobile),
        maskedEmail: this.maskEmail(lead.applicant.email),
        city: lead.applicant.city,
        duplicateFlag: lead.duplicateFlag,
        conversionApplicationId: lead.conversionApplicationId ?? null,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
      });
    }

    const limit = query.limit ?? 20;
    const paginated = matched.slice(0, limit);

    return {
      data: paginated,
      meta: {
        nextCursor: matched.length > limit ? 'cursor_next' : null,
        limit,
      },
    };
  }

  // ==========================================================================
  // Partner Application Lifecycle & Offers
  // ==========================================================================

  async createApplication(
    ctx: RequestContext,
    input: PartnerCreateApplicationInput,
    idemKey: string,
  ): Promise<{ application: PartnerApplicationResponse; isReplayed: boolean }> {
    const { principal } = ctx;
    const cacheKey = `${principal.tenantId}:app:${idemKey}`;
    const cached = this.idempotencyStore.get(cacheKey);
    if (cached) {
      return { application: cached.body as PartnerApplicationResponse, isReplayed: true };
    }

    const hasIngest = principal.grants.some(
      (g) => g.code === 'partner.lead_ingest' || g.code === 'application.create',
    );
    if (!hasIngest) {
      throw AppError.of('FORBIDDEN', 'Permission denied: partner.lead_ingest required.');
    }

    const lead = this.leadsMap.get(input.leadId);
    if (!lead || lead.tenantId !== principal.tenantId) {
      throw AppError.of('NOT_FOUND', `Lead ${input.leadId} not found.`);
    }

    const appId = this.nextId('app');
    const partnerId = principal.kind === 'SERVICE' ? principal.id : 'direct';

    const appRecord: PartnerApplicationRecord = {
      id: appId,
      tenantId: principal.tenantId,
      partnerId,
      leadId: input.leadId,
      productId: input.productId,
      appliedAmount: input.appliedAmount,
      tenureMonths: input.tenureMonths,
      status: 'SUBMITTED',
      currentStage: 'INITIAL_REVIEW',
      sanctionCount: 0,
      createdAt: ctx.now.toISOString(),
      updatedAt: ctx.now.toISOString(),
    };

    this.applicationsMap.set(appId, appRecord);
    lead.conversionApplicationId = appId;
    lead.status = 'CONVERTED';

    const response: PartnerApplicationResponse = {
      id: appId,
      leadId: input.leadId,
      tenantId: principal.tenantId,
      status: 'SUBMITTED',
      appliedAmount: input.appliedAmount,
      currentStage: 'INITIAL_REVIEW',
      checklistCompleted: false,
      sanctionCount: 0,
      createdAt: ctx.now.toISOString(),
      updatedAt: ctx.now.toISOString(),
    };

    this.idempotencyStore.set(cacheKey, { body: response, statusCode: 201 });

    return { application: response, isReplayed: false };
  }

  async getApplication(ctx: RequestContext, id: string): Promise<PartnerApplicationResponse> {
    const { principal } = ctx;
    const hasRead = principal.grants.some(
      (g) => g.code === 'partner.application_read' || g.code === 'application.read',
    );
    if (!hasRead) {
      throw AppError.of('FORBIDDEN', 'Permission denied: partner.application_read required.');
    }

    const app = this.applicationsMap.get(id);
    if (!app || app.tenantId !== principal.tenantId) {
      throw AppError.of('NOT_FOUND', `Application ${id} not found.`);
    }

    return {
      id: app.id,
      leadId: app.leadId,
      tenantId: app.tenantId,
      status: app.status,
      appliedAmount: app.appliedAmount,
      currentStage: app.currentStage,
      checklistCompleted: true,
      sanctionCount: app.sanctionCount,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
    };
  }

  async getApplicationOffers(ctx: RequestContext, id: string): Promise<PartnerSanctionOffersResponse> {
    const { principal } = ctx;
    const hasRead = principal.grants.some(
      (g) => g.code === 'partner.application_read' || g.code === 'application.read',
    );
    if (!hasRead) {
      throw AppError.of('FORBIDDEN', 'Permission denied: partner.application_read required.');
    }

    const app = this.applicationsMap.get(id);
    if (!app || app.tenantId !== principal.tenantId) {
      throw AppError.of('NOT_FOUND', `Application ${id} not found.`);
    }

    const sncId = this.nextId('snc');
    const lndId = this.nextId('lnd');

    return {
      applicationId: id,
      offers: [
        {
          id: sncId,
          lenderId: lndId,
          lenderName: 'HDFC Bank Lending Solutions',
          sanctionedAmount: app.appliedAmount,
          interestRateAnnual: '8.45',
          tenureMonths: app.tenureMonths,
          processingFee: { amount: '5000.00', currency: 'INR' },
          sanctionLetterDocumentId: 'doc_sanction_letter_01',
          validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
          status: 'ACTIVE',
        },
      ],
    };
  }

  // ==========================================================================
  // Document Upload Session Handoff
  // ==========================================================================

  async createUploadSession(
    ctx: RequestContext,
    input: PartnerUploadSessionRequest,
    _idemKey: string,
  ): Promise<PartnerUploadSessionResponse> {
    const { principal } = ctx;
    const hasIngest = principal.grants.some(
      (g) => g.code === 'partner.lead_ingest' || g.code === 'document.upload',
    );
    if (!hasIngest) {
      throw AppError.of('FORBIDDEN', 'Permission denied: partner.lead_ingest required.');
    }

    const app = this.applicationsMap.get(input.applicationId);
    if (!app || app.tenantId !== principal.tenantId) {
      throw AppError.of('NOT_FOUND', `Application ${input.applicationId} not found.`);
    }

    const sessionId = this.nextId('upl');
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + input.expiresInMinutes * 60000).toISOString();

    return {
      sessionId,
      uploadUrl: `https://app.dsa-crm.com/public/v1/upload/${token}`,
      token,
      expiresAt,
      items: input.documentChecklistCodes,
    };
  }

  // ==========================================================================
  // API Management (MOD-API)
  // ==========================================================================

  private toClientResponse(r: ApiClientRecord): ApiClientResponse {
    return {
      id: r.id,
      clientId: r.clientId,
      tenantId: r.tenantId,
      name: r.name,
      partnerName: r.partnerName,
      status: r.status,
      scopes: r.scopes,
      rateLimitRpm: r.rateLimitRpm,
      allowedIps: r.allowedIps ?? null,
      lastUsedAt: r.lastUsedAt ?? null,
      lockVersion: r.lockVersion,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private requireApiRead(principal: RequestContext['principal']): void {
    const hasAccess = principal.grants.some(
      (g) => g.code === 'api.read' || g.code === 'api.manage' || g.code === 'config.manage',
    );
    if (!hasAccess && principal.kind !== 'SERVICE') {
      throw AppError.of('FORBIDDEN', 'Permission denied: api.read or api.manage required.');
    }
  }

  private requireApiManage(principal: RequestContext['principal']): void {
    const hasManage = principal.grants.some((g) => g.code === 'api.manage' || g.code === 'config.manage');
    if (!hasManage && principal.kind !== 'SERVICE') {
      throw AppError.of('FORBIDDEN', 'Permission denied: api.manage required.');
    }
  }

  async listApiClients(ctx: RequestContext): Promise<{ data: ApiClientResponse[] }> {
    this.requireApiRead(ctx.principal);
    const clients = await this.apiClients.list(ctx);
    return { data: clients.map((c) => this.toClientResponse(c)) };
  }

  async createApiClient(ctx: RequestContext, input: CreateApiClientInput): Promise<ApiClientResponse> {
    const { principal } = ctx;
    this.requireApiManage(principal);

    const secretRandom = crypto.randomBytes(24).toString('hex');
    const clientSecret = `sec_${secretRandom}`;
    const nowIso = ctx.now.toISOString();
    const record: ApiClientRecord = {
      id: this.nextId('clt'),
      tenantId: principal.tenantId,
      clientId: `clt_${crypto.randomBytes(12).toString('hex')}`,
      clientSecretHash: crypto.createHash('sha256').update(clientSecret).digest('hex'),
      name: input.name,
      partnerName: input.partnerName,
      status: 'ACTIVE',
      scopes: input.scopes,
      rateLimitRpm: input.rateLimitRpm ?? 120,
      allowedIps: input.allowedIps ?? null,
      lastUsedAt: null,
      lockVersion: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      createdBy: principal.id,
      updatedBy: principal.id,
    };
    // A failure here is an error to the caller. It used to be swallowed, which left a client that existed only in memory.
    await this.apiClients.create(ctx, record);
    return { ...this.toClientResponse(record), clientSecret };
  }

  async getApiClient(ctx: RequestContext, id: string): Promise<ApiClientResponse> {
    this.requireApiRead(ctx.principal);
    const record = await this.apiClients.get(ctx, id);
    if (!record) throw AppError.of('NOT_FOUND', `API Client ${id} not found.`);
    return this.toClientResponse(record);
  }

  async updateApiClient(
    ctx: RequestContext,
    id: string,
    input: UpdateApiClientInput,
  ): Promise<ApiClientResponse> {
    this.requireApiManage(ctx.principal);
    const record = await this.apiClients.update(ctx, id, input);
    if (!record) throw AppError.of('NOT_FOUND', `API Client ${id} not found.`);
    return this.toClientResponse(record);
  }

  async deleteApiClient(ctx: RequestContext, id: string): Promise<void> {
    this.requireApiManage(ctx.principal);
    if (!(await this.apiClients.revoke(ctx, id)))
      throw AppError.of('NOT_FOUND', `API Client ${id} not found.`);
  }

  async rotateClientSecret(ctx: RequestContext, id: string): Promise<RotateClientSecretResponse> {
    this.requireApiManage(ctx.principal);
    const clientSecret = `sec_${crypto.randomBytes(24).toString('hex')}`;
    const record = await this.apiClients.rotateSecret(
      ctx,
      id,
      crypto.createHash('sha256').update(clientSecret).digest('hex'),
    );
    if (!record) throw AppError.of('NOT_FOUND', `API Client ${id} not found.`);
    return { clientId: record.clientId, clientSecret, rotatedAt: record.updatedAt };
  }
}
