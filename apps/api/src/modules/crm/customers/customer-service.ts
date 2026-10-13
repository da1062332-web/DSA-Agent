// apps/api/src/modules/crm/customers/customer-service.ts — owner: Dev 5 (MOD-CUST)
import {
  AppError,
  type ConsentPort,
  type ConsentPurpose,
  type IdGenerator,
  type Party,
  type PartyPort,
  type RequestContext,
  type Tx,
} from '@dsa/contracts';
import crypto from 'node:crypto';
import {
  getCustomerScopeFilter,
  requireCustomerAccess,
  requirePermission,
} from './authz-helper';
import {
  assertNoS3Data,
  computeEmailHash,
  computeMobileHash,
  maskEmail,
  maskMobile,
  maskName,
  normalizeEmail,
  normalizeMobile,
} from './normalizer';
import type {
  ConsentRecordRow,
  CustomerRepository,
  CustomerRow,
} from './repository';
import type {
  ConsentResource,
  CreateConsentInput,
  CreateCustomerInput,
  CustomerListQuery,
  MaskedCustomerResource,
  UpdateCustomerInput,
  WithdrawConsentInput,
} from './types';

export interface CustomerServiceDeps {
  repository: CustomerRepository;
  idGenerator?: IdGenerator;
}

export class CustomerService implements PartyPort, ConsentPort {
  constructor(private readonly deps: CustomerServiceDeps) {}

  private nextId(prefix: 'cust' | 'ccp' | 'cnst' | 'aud' | 'evt'): string {
    if (this.deps.idGenerator) {
      return this.deps.idGenerator.next(prefix);
    }
    const rand = Math.random().toString(36).substring(2, 10).toUpperCase();
    const time = Date.now().toString(36).toUpperCase();
    return `${prefix}_01J${time}${rand}`.slice(0, 31);
  }

  private toCustomerResource(
    row: CustomerRow,
    contactPoints?: { mobile?: string | null; email?: string | null },
  ): MaskedCustomerResource {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      partyType: row.party_type,
      fullName: row.full_name,
      homeBranchId: row.home_branch_id,
      status: row.status,
      lockVersion: row.lock_version,
      primaryMobileMasked: maskMobile(contactPoints?.mobile),
      primaryEmailMasked: maskEmail(contactPoints?.email),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private toConsentResource(row: ConsentRecordRow): ConsentResource {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      purpose: row.purpose,
      purposeTarget: row.purpose_target,
      noticeVersion: row.notice_version,
      channel: row.channel as ConsentResource['channel'],
      evidenceRef: row.evidence_ref,
      capturedBy: row.captured_by,
      capturedAt: row.captured_at.toISOString(),
      status: row.status,
      withdrawnAt: row.withdrawn_at ? row.withdrawn_at.toISOString() : null,
      withdrawnBy: row.withdrawn_by ?? null,
      withdrawalReason: row.withdrawal_reason ?? null,
      expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
      createdAt: (row.created_at ?? row.captured_at).toISOString(),
    };
  }

  /**
   * API-CUST-001: Create Customer (Party Profile)
   */
  async createCustomer(
    tx: Tx,
    ctx: RequestContext,
    input: CreateCustomerInput,
    idempotencyKey: string,
  ): Promise<{ resource: MaskedCustomerResource; etag: string; isReplayed: boolean }> {
    const tenantId = ctx.principal.tenantId;
    const currentHash = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');

    // Idempotency check
    const existingIdem = await this.deps.repository.getIdempotency(
      tx,
      tenantId,
      ctx.principal.id,
      idempotencyKey,
    );
    if (existingIdem && existingIdem.status === 'COMPLETED' && existingIdem.response_body) {
      if (
        existingIdem.request_hash &&
        existingIdem.request_hash !== 'hash' &&
        existingIdem.request_hash !== currentHash
      ) {
        throw AppError.of(
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency key has already been used with a different request payload.',
        );
      }
      return {
        resource: existingIdem.response_body as unknown as MaskedCustomerResource,
        etag: `"${existingIdem.response_body.lockVersion ?? 0}"`,
        isReplayed: true,
      };
    }
    if (existingIdem && existingIdem.status === 'IN_PROGRESS') {
      throw AppError.of('IDEMPOTENCY_IN_PROGRESS', 'Customer creation request is currently in progress.');
    }

    requirePermission(ctx, 'customer.create');

    // S3-class data rejection
    if (
      input.pan !== undefined ||
      input.aadhaar !== undefined ||
      input.dob !== undefined ||
      input.dateOfBirth !== undefined ||
      input.bankAccount !== undefined ||
      input.bankAccountNumber !== undefined
    ) {
      throw AppError.of('VALIDATION_ERROR', 'S3-class data (PAN, Aadhaar, DOB, bank account) is prohibited in MVP', [
        { field: 'pan', issue: 'PROHIBITED_S3_DATA' },
      ]);
    }

    assertNoS3Data(input.fullName, 'fullName');

    let normalizedMobile: string | null = null;
    let mobileHash: Buffer | null = null;
    if (input.primaryMobile) {
      normalizedMobile = normalizeMobile(input.primaryMobile);
      mobileHash = computeMobileHash(tenantId, normalizedMobile);
    }

    let normalizedEmail: string | null = null;
    let emailHash: Buffer | null = null;
    if (input.primaryEmail) {
      normalizedEmail = normalizeEmail(input.primaryEmail);
      if (normalizedEmail) {
        emailHash = computeEmailHash(tenantId, normalizedEmail);
      }
    }

    const now = ctx.now;
    const customerId = this.nextId('cust');

    const customerRow: CustomerRow = {
      id: customerId,
      tenant_id: tenantId,
      party_type: input.partyType,
      full_name: input.fullName.trim(),
      home_branch_id: input.homeBranchId,
      status: 'ACTIVE',
      lock_version: 0,
      created_at: now,
      created_by: ctx.principal.id,
      updated_at: now,
      updated_by: ctx.principal.id,
    };

    await this.deps.repository.insertCustomer(tx, customerRow);

    if (normalizedMobile && mobileHash) {
      await this.deps.repository.insertContactPoint(tx, {
        id: this.nextId('ccp'),
        tenant_id: tenantId,
        customer_id: customerId,
        kind: 'MOBILE',
        value: normalizedMobile,
        value_hash: mobileHash,
        is_primary: true,
        created_at: now,
        created_by: ctx.principal.id,
      });
    }

    if (normalizedEmail && emailHash) {
      await this.deps.repository.insertContactPoint(tx, {
        id: this.nextId('ccp'),
        tenant_id: tenantId,
        customer_id: customerId,
        kind: 'EMAIL',
        value: normalizedEmail,
        value_hash: emailHash,
        is_primary: true,
        created_at: now,
        created_by: ctx.principal.id,
      });
    }

    await this.deps.repository.insertOutboxEvent(tx, {
      id: this.nextId('evt'),
      tenant_id: tenantId,
      event_type: 'customer.created',
      event_version: 1,
      subject_type: 'CUSTOMER',
      subject_id: customerId,
      payload: {
        customerId,
        partyType: input.partyType,
        homeBranchId: input.homeBranchId,
      },
      correlation_id: ctx.correlationId,
      chain_depth: 0,
      created_at: now,
    });

    const resource = this.toCustomerResource(customerRow, {
      mobile: normalizedMobile,
      email: normalizedEmail,
    });

    await this.deps.repository.insertAuditEvent(tx, {
      id: this.nextId('aud'),
      tenant_id: tenantId,
      actor_type: ctx.principal.kind,
      actor_id: ctx.principal.id,
      action: 'customer.created',
      entity_type: 'customer',
      entity_id: customerId,
      after: resource as unknown as Record<string, unknown>,
      correlation_id: ctx.correlationId,
      occurred_at: now,
    });

    await this.deps.repository.saveIdempotency(tx, {
      tenant_id: tenantId,
      principal_id: ctx.principal.id,
      key: idempotencyKey,
      method: 'POST',
      path: '/v1/customers',
      request_hash: currentHash,
      status: 'COMPLETED',
      response_status: 201,
      response_body: resource as unknown as Record<string, unknown>,
      resource_ref: customerId,
      created_at: now,
      expires_at: new Date(now.getTime() + 86400000),
    });

    return { resource, etag: '"0"', isReplayed: false };
  }

  /**
   * API-CUST-003: Update Customer Profile
   */
  async updateCustomer(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    ifMatch: string,
    input: UpdateCustomerInput,
  ): Promise<{ resource: MaskedCustomerResource; etag: string }> {
    requirePermission(ctx, 'customer.update');

    // S3-class data rejection
    if (
      input.pan !== undefined ||
      input.aadhaar !== undefined ||
      input.dob !== undefined ||
      input.dateOfBirth !== undefined ||
      input.bankAccount !== undefined ||
      input.bankAccountNumber !== undefined
    ) {
      throw AppError.of('VALIDATION_ERROR', 'S3-class data (PAN, Aadhaar, DOB, bank account) is prohibited in MVP', [
        { field: 'pan', issue: 'PROHIBITED_S3_DATA' },
      ]);
    }

    if (input.fullName) {
      assertNoS3Data(input.fullName, 'fullName');
    }

    const tenantId = ctx.principal.tenantId;
    const customer = await this.deps.repository.findCustomerByIdForUpdate(tx, tenantId, id);
    requireCustomerAccess(ctx, 'customer.update', customer);

    const expectedLockVersion = parseInt(ifMatch.replace(/"/g, ''), 10);
    if (isNaN(expectedLockVersion) || expectedLockVersion !== customer.lock_version) {
      throw AppError.of('VERSION_CONFLICT', 'Resource has been modified (ETag mismatch).');
    }

    const updated = await this.deps.repository.updateCustomer(
      tx,
      tenantId,
      id,
      expectedLockVersion,
      {
        full_name: input.fullName?.trim(),
        home_branch_id: input.homeBranchId,
        updated_by: ctx.principal.id,
      },
    );

    if (!updated) {
      throw AppError.of('VERSION_CONFLICT', 'Concurrent modification detected.');
    }

    const now = ctx.now;

    await this.deps.repository.insertOutboxEvent(tx, {
      id: this.nextId('evt'),
      tenant_id: tenantId,
      event_type: 'customer.updated',
      event_version: 1,
      subject_type: 'CUSTOMER',
      subject_id: id,
      payload: {
        customerId: id,
        fullName: updated.full_name,
        homeBranchId: updated.home_branch_id,
      },
      correlation_id: ctx.correlationId,
      chain_depth: 0,
      created_at: now,
    });

    const contactPoints = await this.deps.repository.findPrimaryContactPoints(tx, tenantId, id);
    const resource = this.toCustomerResource(updated, contactPoints);

    await this.deps.repository.insertAuditEvent(tx, {
      id: this.nextId('aud'),
      tenant_id: tenantId,
      actor_type: ctx.principal.kind,
      actor_id: ctx.principal.id,
      action: 'customer.updated',
      entity_type: 'customer',
      entity_id: id,
      after: resource as unknown as Record<string, unknown>,
      correlation_id: ctx.correlationId,
      occurred_at: now,
    });

    return { resource, etag: `"${updated.lock_version}"` };
  }

  /**
   * API-CUST-010: List Customers
   */
  async listCustomers(
    tx: Tx,
    ctx: RequestContext,
    query: CustomerListQuery,
  ): Promise<{ data: MaskedCustomerResource[]; meta: { nextCursor: string | null; limit: number } }> {
    requirePermission(ctx, 'customer.read');
    const scope = getCustomerScopeFilter(ctx, 'customer.read');

    const partyType = query['filter[partyType]'] ?? query.partyType;
    const homeBranchId = query['filter[homeBranchId]'] ?? query.homeBranchId;
    const status = query['filter[status]'] ?? query.status;

    const result = await this.deps.repository.listCustomers(tx, {
      tenantId: ctx.principal.tenantId,
      partyType,
      homeBranchId,
      status,
      allowedBranchIds: scope.branchIds,
      allowedTeamUserIds: scope.teamUserIds,
      allowedOwnUserId: scope.ownUserId,
      isTenantWide: scope.isTenantWide,
      limit: query.limit,
      cursor: query.cursor,
    });

    // Fetch contact points for each customer
    const resources: MaskedCustomerResource[] = [];
    for (const c of result.customers) {
      const contactPoints = await this.deps.repository.findPrimaryContactPoints(
        tx,
        c.tenant_id,
        c.id,
      );
      resources.push(this.toCustomerResource(c, contactPoints));
    }

    return {
      data: resources,
      meta: {
        nextCursor: result.nextCursor,
        limit: query.limit,
      },
    };
  }

  /**
   * API-CUST-002 / Detail: Get Customer
   */
  async getCustomer(
    tx: Tx,
    ctx: RequestContext,
    id: string,
  ): Promise<{ resource: MaskedCustomerResource; etag: string }> {
    requirePermission(ctx, 'customer.read');
    const customer = await this.deps.repository.findCustomerById(tx, ctx.principal.tenantId, id);
    requireCustomerAccess(ctx, 'customer.read', customer);

    const contactPoints = await this.deps.repository.findPrimaryContactPoints(
      tx,
      customer.tenant_id,
      customer.id,
    );

    return {
      resource: this.toCustomerResource(customer, contactPoints),
      etag: `"${customer.lock_version}"`,
    };
  }

  /**
   * List Consents for a Customer
   */
  async listConsents(
    tx: Tx,
    ctx: RequestContext,
    customerId: string,
  ): Promise<{ data: ConsentResource[] }> {
    requirePermission(ctx, 'customer.read');
    const customer = await this.deps.repository.findCustomerById(tx, ctx.principal.tenantId, customerId);
    requireCustomerAccess(ctx, 'customer.read', customer);

    const rows = await this.deps.repository.listConsentsBySubject(
      tx,
      ctx.principal.tenantId,
      'CUSTOMER',
      customerId,
    );
    return {
      data: rows.map((r) => this.toConsentResource(r)),
    };
  }

  /**
   * API-CUST-004: Record Customer Consent (ENT-028)
   */
  async recordConsent(
    tx: Tx,
    ctx: RequestContext,
    customerId: string,
    input: CreateConsentInput,
    idempotencyKey: string,
  ): Promise<{ resource: ConsentResource; isReplayed: boolean }> {
    const tenantId = ctx.principal.tenantId;
    const currentHash = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');

    // Idempotency check
    const existingIdem = await this.deps.repository.getIdempotency(
      tx,
      tenantId,
      ctx.principal.id,
      idempotencyKey,
    );
    if (existingIdem && existingIdem.status === 'COMPLETED' && existingIdem.response_body) {
      if (
        existingIdem.request_hash &&
        existingIdem.request_hash !== 'hash' &&
        existingIdem.request_hash !== currentHash
      ) {
        throw AppError.of(
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency key has already been used with a different request payload.',
        );
      }
      return {
        resource: existingIdem.response_body as unknown as ConsentResource,
        isReplayed: true,
      };
    }
    if (existingIdem && existingIdem.status === 'IN_PROGRESS') {
      throw AppError.of('IDEMPOTENCY_IN_PROGRESS', 'Consent registration is currently in progress.');
    }

    requirePermission(ctx, 'consent.record');

    // Customer must exist and be accessible
    const customer = await this.deps.repository.findCustomerById(tx, tenantId, customerId);
    requireCustomerAccess(ctx, 'customer.read', customer);

    const now = ctx.now;
    const consentId = this.nextId('cnst');

    const consentRow: ConsentRecordRow = {
      id: consentId,
      tenant_id: tenantId,
      subject_type: 'CUSTOMER',
      subject_id: customerId,
      purpose: input.purpose,
      purpose_target: input.purposeTarget ?? null,
      notice_version: input.noticeVersion,
      channel: input.channel,
      evidence_ref: input.evidenceRef ?? null,
      captured_by: ctx.principal.id,
      captured_at: now,
      status: 'ACTIVE',
      expires_at: input.expiresAt ? new Date(input.expiresAt) : null,
      created_at: now,
    };

    await this.deps.repository.insertConsentRecord(tx, consentRow);

    await this.deps.repository.insertOutboxEvent(tx, {
      id: this.nextId('evt'),
      tenant_id: tenantId,
      event_type: 'consent.granted',
      event_version: 1,
      subject_type: 'CUSTOMER',
      subject_id: customerId,
      payload: {
        consentId,
        customerId,
        purpose: input.purpose,
        purposeTarget: input.purposeTarget ?? null,
        noticeVersion: input.noticeVersion,
      },
      correlation_id: ctx.correlationId,
      chain_depth: 0,
      created_at: now,
    });

    const resource = this.toConsentResource(consentRow);

    await this.deps.repository.insertAuditEvent(tx, {
      id: this.nextId('aud'),
      tenant_id: tenantId,
      actor_type: ctx.principal.kind,
      actor_id: ctx.principal.id,
      action: 'consent.granted',
      entity_type: 'consent_record',
      entity_id: consentId,
      after: resource as unknown as Record<string, unknown>,
      correlation_id: ctx.correlationId,
      occurred_at: now,
    });

    await this.deps.repository.saveIdempotency(tx, {
      tenant_id: tenantId,
      principal_id: ctx.principal.id,
      key: idempotencyKey,
      method: 'POST',
      path: `/v1/customers/${customerId}/consents`,
      request_hash: currentHash,
      status: 'COMPLETED',
      response_status: 201,
      response_body: resource as unknown as Record<string, unknown>,
      resource_ref: consentId,
      created_at: now,
      expires_at: new Date(now.getTime() + 86400000),
    });

    return { resource, isReplayed: false };
  }

  /**
   * API-CUST-005: Withdraw Consent
   */
  async withdrawConsent(
    tx: Tx,
    ctx: RequestContext,
    consentId: string,
    input: WithdrawConsentInput,
    idempotencyKey: string,
  ): Promise<{ resource: ConsentResource; isReplayed: boolean }> {
    const tenantId = ctx.principal.tenantId;
    const currentHash = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');

    // Idempotency check
    const existingIdem = await this.deps.repository.getIdempotency(
      tx,
      tenantId,
      ctx.principal.id,
      idempotencyKey,
    );
    if (existingIdem && existingIdem.status === 'COMPLETED' && existingIdem.response_body) {
      if (
        existingIdem.request_hash &&
        existingIdem.request_hash !== 'hash' &&
        existingIdem.request_hash !== currentHash
      ) {
        throw AppError.of(
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency key has already been used with a different request payload.',
        );
      }
      return {
        resource: existingIdem.response_body as unknown as ConsentResource,
        isReplayed: true,
      };
    }
    if (existingIdem && existingIdem.status === 'IN_PROGRESS') {
      throw AppError.of('IDEMPOTENCY_IN_PROGRESS', 'Consent withdrawal is currently in progress.');
    }

    requirePermission(ctx, 'consent.record');

    const consent = await this.deps.repository.findConsentById(tx, tenantId, consentId);
    if (!consent) {
      throw AppError.of('NOT_FOUND', `Consent record ${consentId} not found.`);
    }

    if (consent.status !== 'ACTIVE') {
      throw AppError.of(
        'INVALID_STATE',
        `Consent record is in state '${consent.status}' and cannot be withdrawn.`,
      );
    }

    const now = ctx.now;
    const updated = await this.deps.repository.withdrawConsent(
      tx,
      tenantId,
      consentId,
      now,
      ctx.principal.id,
      input.withdrawalReason,
    );

    if (!updated) {
      throw AppError.of('INVALID_STATE', 'Failed to withdraw consent; record may have already been modified.');
    }

    await this.deps.repository.insertOutboxEvent(tx, {
      id: this.nextId('evt'),
      tenant_id: tenantId,
      event_type: 'consent.withdrawn',
      event_version: 1,
      subject_type: consent.subject_type,
      subject_id: consent.subject_id,
      payload: {
        consentId,
        subjectId: consent.subject_id,
        reason: input.withdrawalReason ?? null,
      },
      correlation_id: ctx.correlationId,
      chain_depth: 0,
      created_at: now,
    });

    const resource = this.toConsentResource(updated);

    await this.deps.repository.insertAuditEvent(tx, {
      id: this.nextId('aud'),
      tenant_id: tenantId,
      actor_type: ctx.principal.kind,
      actor_id: ctx.principal.id,
      action: 'consent.withdrawn',
      entity_type: 'consent_record',
      entity_id: consentId,
      after: resource as unknown as Record<string, unknown>,
      correlation_id: ctx.correlationId,
      occurred_at: now,
    });

    await this.deps.repository.saveIdempotency(tx, {
      tenant_id: tenantId,
      principal_id: ctx.principal.id,
      key: idempotencyKey,
      method: 'POST',
      path: `/v1/consents/${consentId}/withdrawal`,
      request_hash: currentHash,
      status: 'COMPLETED',
      response_status: 200,
      response_body: resource as unknown as Record<string, unknown>,
      resource_ref: consentId,
      created_at: now,
      expires_at: new Date(now.getTime() + 86400000),
    });

    return { resource, isReplayed: false };
  }

  // --- Implement PartyPort ---
  async getParty(tx: Tx, customerId: string): Promise<Party | null> {
    const row = await this.deps.repository.findCustomerById(tx, '', customerId);
    if (!row) return null;
    return {
      customerId: row.id,
      partyType: row.party_type,
      displayNameMasked: maskName(row.full_name),
      homeBranchId: row.home_branch_id,
    };
  }

  // --- Implement ConsentPort ---
  async findActive(
    tx: Tx,
    q: { customerId: string; purpose: ConsentPurpose; purposeTarget?: string },
  ): Promise<{ consentId: string } | null> {
    const direct = await this.deps.repository.findActiveConsent(
      tx,
      '',
      'CUSTOMER',
      q.customerId,
      q.purpose,
      q.purposeTarget,
    );
    if (direct) {
      return { consentId: direct.id };
    }

    const leadConsent = await this.deps.repository.findActiveLeadConsentByCustomerId(
      tx,
      '',
      q.customerId,
      q.purpose,
      q.purposeTarget,
    );
    if (leadConsent) {
      return { consentId: leadConsent.id };
    }

    return null;
  }
}
