// apps/api/src/modules/crm/leads/lead-service.ts — owner: Dev 5 (MOD-04 Leads)
import {
  AppError,
  type ApplicationPort,
  type AuditPort,
  type DecisionPort,
  type IdGenerator,
  type OutboxPort,
  type RequestContext,
  type TaskPort,
  type Tx,
  type UserDirectoryPort,
} from '@dsa/contracts';
import { ulid } from 'ulid';
import { requestHash } from '@dsa/kernel';
import { getScopeFilter, requireLeadAccess, requirePermission } from './authz-helper';
import {
  assertNoS3Data,
  computeEmailHash,
  computeMobileHash,
  maskEmail,
  maskMobile,
  normalizeEmail,
  normalizeMobile,
  validatePincode,
} from './normalizer';
import type { LeadRepository, LeadRow } from './repository';
import { validateLeadTransition } from './state-machine';

function parseLockVersion(ifMatch: string): number {
  const cleaned = ifMatch.replace(/^W\//, '').replace(/^"|"$/g, '');
  const v = parseInt(cleaned, 10);
  if (isNaN(v)) {
    throw AppError.of('VERSION_CONFLICT', 'Malformed ETag / If-Match header value');
  }
  return v;
}
import type {
  AssignLeadInput,
  ConvertLeadInput,
  CreateLeadInput,
  LeadConversionResult,
  LeadListQuery,
  LeadTransitionInput,
  MaskedLeadResource,
  UpdateLeadInput,
} from './types';

export interface LeadServiceDeps {
  repository: LeadRepository;
  decisionPort?: DecisionPort;
  applicationPort?: ApplicationPort;
  taskPort?: TaskPort;
  userDirectoryPort?: UserDirectoryPort;
  auditPort?: AuditPort;
  outboxPort?: OutboxPort;
  idGenerator?: IdGenerator;
}

export class LeadService {
  constructor(private readonly deps: LeadServiceDeps) {}

  private nextId(prefix: string): string {
    return `${prefix}_${ulid()}`;
  }

  private toResource(lead: LeadRow): MaskedLeadResource {
    return {
      id: lead.id,
      tenantId: lead.tenant_id,
      branchId: lead.branch_id,
      fullName: lead.full_name,
      mobileMasked: maskMobile(lead.mobile_e164),
      emailMasked: maskEmail(lead.email),
      productCategory: lead.product_category,
      indicativeAmount: lead.indicative_amount
        ? { amount: lead.indicative_amount, currency: lead.amount_currency }
        : null,
      pincode: lead.pincode,
      source: lead.source,
      subSource: lead.sub_source,
      campaign: lead.campaign,
      utm: lead.utm,
      connectorId: lead.connector_id,
      state: lead.state,
      ownerUserId: lead.owner_user_id,
      ownerQueueId: lead.owner_queue_id,
      priority: lead.priority,
      customerId: lead.customer_id,
      applicationId: lead.application_id,
      duplicateFlag: lead.duplicate_flag,
      duplicateCandidateIds: lead.duplicate_candidate_ids ?? [],
      contactAttempts: lead.contact_attempts,
      tags: lead.tags ?? [],
      nextFollowUpAt: lead.next_follow_up_at ? new Date(lead.next_follow_up_at).toISOString() : null,
      qualApplicantType: lead.qual_applicant_type,
      qualRequestedAmount: lead.qual_requested_amount
        ? { amount: lead.qual_requested_amount, currency: lead.amount_currency }
        : null,
      qualTenureMonths: lead.qual_tenure_months,
      qualPurposeCode: lead.qual_purpose_code,
      disqualificationReason: (lead.disqualification_reason as MaskedLeadResource['disqualificationReason']) ?? null,
      lockVersion: lead.lock_version,
      createdAt: new Date(lead.created_at).toISOString(),
      updatedAt: new Date(lead.updated_at).toISOString(),
    };
  }

  /**
   * API-LEAD-001: Create Lead
   */
  async createLead(
    tx: Tx,
    ctx: RequestContext,
    input: CreateLeadInput,
    idempotencyKey: string,
  ): Promise<{ resource: MaskedLeadResource; etag: string; isReplayed: boolean }> {
    const tenantId = ctx.principal.tenantId;
    const hash = requestHash({
      key: idempotencyKey,
      method: 'POST',
      path: '/v1/leads',
      body: input,
    });

    // Idempotency replay check
    const existingIdem = await this.deps.repository.getIdempotency(
      tx,
      tenantId,
      ctx.principal.id,
      idempotencyKey,
    );
    if (existingIdem && existingIdem.status === 'COMPLETED' && existingIdem.response_body) {
      if (existingIdem.request_hash && existingIdem.request_hash !== hash) {
        throw AppError.of('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was used for a different request.');
      }
      return {
        resource: existingIdem.response_body as unknown as MaskedLeadResource,
        etag: `"${existingIdem.response_body.lockVersion ?? 0}"`,
        isReplayed: true,
      };
    }
    if (existingIdem && existingIdem.status === 'IN_PROGRESS') {
      throw AppError.of('IDEMPOTENCY_IN_PROGRESS', 'A request with this idempotency key is in progress.');
    }

    // Permission check
    requirePermission(ctx, 'lead.create');

    // Scope check: if caller has BRANCH scope only, branchId must be permitted
    const branchGrants = ctx.principal.grants.filter((g) => g.code === 'lead.create' && g.scope === 'BRANCH');
    if (branchGrants.length > 0) {
      const allowedBranches = new Set<string>();
      for (const g of branchGrants) {
        for (const b of g.branchIds) allowedBranches.add(b);
      }
      if (ctx.principal.primaryBranchId) allowedBranches.add(ctx.principal.primaryBranchId);
      if (!allowedBranches.has(input.branchId)) {
        throw AppError.of('FORBIDDEN', `Cannot create lead in branch ${input.branchId}`);
      }
    }

    // Normalizations & validations
    const mobileE164 = normalizeMobile(input.mobile);
    const mobileHash = computeMobileHash(tenantId, mobileE164);
    const emailNorm = normalizeEmail(input.email);
    const emailHash = emailNorm ? computeEmailHash(tenantId, emailNorm) : null;
    const pincode = validatePincode(input.pincode);

    // Free text S3 protection
    assertNoS3Data(input.fullName, 'fullName');
    assertNoS3Data(input.subSource, 'subSource');
    assertNoS3Data(input.campaign, 'campaign');

    // Duplicate detection
    const existingMatches = await this.deps.repository.findLeadsByMobileHash(tx, tenantId, mobileHash);
    let duplicateFlag: MaskedLeadResource['duplicateFlag'] = 'NONE';
    const duplicateCandidateIds: string[] = [];

    if (this.deps.decisionPort) {
      try {
        const decision = await this.deps.decisionPort.decide(tx, ctx, {
          decisionKey: 'DK-lead.duplicate',
          scope: { branchId: input.branchId },
          subject: { type: 'LEAD', id: 'new' },
          facts: {
            pair: {
              same_mobile: existingMatches.length > 0,
              same_email: false,
              name_similarity: '1.0',
              days_since_existing_created: 0,
              same_branch: existingMatches.some((m) => m.branch_id === input.branchId),
            },
            existing: {
              type: 'LEAD',
              state: existingMatches[0]?.state ?? 'NEW',
              is_open: existingMatches.some((m) =>
                ['NEW', 'CONTACT_ATTEMPTED', 'IN_PROGRESS', 'QUALIFIED'].includes(m.state),
              ),
            },
          },
          evaluationTime: ctx.now.toISOString(),
          idempotencyKey: `lead_dup:${idempotencyKey}`,
        });
        if (decision.outputs?.classification) {
          duplicateFlag = decision.outputs.classification;
          for (const m of existingMatches) duplicateCandidateIds.push(m.id);
        }
      } catch {
        // Fallback duplicate evaluation
      }
    }

    if (duplicateFlag === 'NONE' && existingMatches.length > 0) {
      const openMatch = existingMatches.find((m) =>
        ['NEW', 'CONTACT_ATTEMPTED', 'IN_PROGRESS', 'QUALIFIED'].includes(m.state),
      );
      if (openMatch) {
        duplicateFlag = openMatch.branch_id === input.branchId ? 'EXACT' : 'POSSIBLE';
        for (const m of existingMatches) duplicateCandidateIds.push(m.id);
      }
    }

    // Owner determination (BR-DOM-003: owner required)
    let ownerUserId: string | null = null;
    let ownerQueueId: string | null = null;

    // Check if user has OWN scope grant exclusively
    const isOwnOnly = ctx.principal.grants.every(
      (g) => g.code !== 'lead.create' || g.scope === 'OWN',
    );
    if (isOwnOnly) {
      ownerUserId = ctx.principal.id;
    } else if (this.deps.userDirectoryPort) {
      try {
        const branchQueue = await this.deps.userDirectoryPort.findBranchQueue(
          tx,
          input.branchId,
          'INTAKE',
        );
        if (branchQueue?.queueId) {
          ownerQueueId = branchQueue.queueId;
          const rrPick = await this.deps.userDirectoryPort.pickRoundRobin(tx, branchQueue.queueId);
          if (rrPick?.userId) {
            ownerUserId = rrPick.userId;
            ownerQueueId = null;
          }
        }
      } catch {
        ownerUserId = ctx.principal.id;
      }
    }

    // Default fallback to ensure owner_present constraint
    if (!ownerUserId && !ownerQueueId) {
      ownerUserId = ctx.principal.id;
    }

    const leadId = this.nextId('lead');
    const now = ctx.now;

    const leadRow: LeadRow = {
      id: leadId,
      tenant_id: tenantId,
      branch_id: input.branchId,
      full_name: input.fullName.trim(),
      mobile_e164: mobileE164,
      mobile_hash: mobileHash,
      email: emailNorm,
      email_hash: emailHash,
      product_category: input.productCategory,
      indicative_amount: input.indicativeAmount?.amount ?? null,
      amount_currency: input.indicativeAmount?.currency ?? 'INR',
      pincode: pincode,
      source: input.source,
      sub_source: input.subSource ?? null,
      campaign: input.campaign ?? null,
      utm: input.utm ?? null,
      connector_id: input.connectorId ?? null,
      referred_at: input.connectorId ? now : null,
      state: 'NEW',
      disqualification_reason: null,
      qual_applicant_type: null,
      qual_requested_amount: null,
      qual_tenure_months: null,
      qual_purpose_code: null,
      owner_user_id: ownerUserId,
      owner_queue_id: ownerQueueId,
      priority: input.priority ?? 'MEDIUM',
      customer_id: null,
      application_id: null,
      duplicate_flag: duplicateFlag,
      duplicate_candidate_ids: duplicateCandidateIds,
      last_duplicate_decision_id: null,
      last_routing_decision_id: null,
      contact_attempts: 0,
      tags: input.tags ?? [],
      next_follow_up_at: null,
      lock_version: 0,
      created_at: now,
      created_by: ctx.principal.id,
      updated_at: now,
      updated_by: ctx.principal.id,
    };

    // 1. Insert Lead
    await this.deps.repository.insertLead(tx, leadRow);

    // 2. Insert Consent Record
    const consentId = this.nextId('cnst');
    await this.deps.repository.insertConsentRecord(tx, {
      id: consentId,
      tenant_id: tenantId,
      subject_type: 'LEAD',
      subject_id: leadId,
      purpose: input.consent.purpose,
      purpose_target: input.consent.purposeTarget ?? null,
      notice_version: input.consent.noticeVersion.toUpperCase(),
      channel: input.consent.channel,
      evidence_ref: input.consent.evidenceRef ?? null,
      captured_by: ctx.principal.id,
      captured_at: now,
      status: 'ACTIVE',
      created_at: now,
    });

    // 3. Insert Initial Lead Status History
    await this.deps.repository.insertLeadStatusHistory(tx, {
      id: this.nextId('lsh'),
      tenant_id: tenantId,
      lead_id: leadId,
      from_state: null,
      to_state: 'NEW',
      transition_code: 'CREATE',
      reason_code: null,
      actor: ctx.principal.id,
      occurred_at: now,
    });

    // 4. Outbox events
    await this.deps.repository.insertOutboxEvent(tx, {
      id: this.nextId('evt'),
      tenant_id: tenantId,
      event_type: 'lead.created',
      event_version: 1,
      subject_type: 'LEAD',
      subject_id: leadId,
      payload: {
        leadId,
        branchId: input.branchId,
        productCategory: input.productCategory,
        ownerUserId,
        ownerQueueId,
      },
      correlation_id: ctx.correlationId,
      chain_depth: 0,
      created_at: now,
    });

    await this.deps.repository.insertOutboxEvent(tx, {
      id: this.nextId('evt'),
      tenant_id: tenantId,
      event_type: 'consent.granted',
      event_version: 1,
      subject_type: 'LEAD',
      subject_id: leadId,
      payload: { consentId, purpose: input.consent.purpose },
      correlation_id: ctx.correlationId,
      chain_depth: 0,
      created_at: now,
    });

    if (duplicateFlag !== 'NONE') {
      await this.deps.repository.insertOutboxEvent(tx, {
        id: this.nextId('evt'),
        tenant_id: tenantId,
        event_type: 'lead.duplicate_flagged',
        event_version: 1,
        subject_type: 'LEAD',
        subject_id: leadId,
        payload: { leadId, duplicateFlag, candidateIds: duplicateCandidateIds },
        correlation_id: ctx.correlationId,
        chain_depth: 0,
        created_at: now,
      });
    }

    // 5. Audit event
    const resource = this.toResource(leadRow);
    await this.deps.repository.insertAuditEvent(tx, {
      id: this.nextId('aud'),
      tenant_id: tenantId,
      actor_type: ctx.principal.kind,
      actor_id: ctx.principal.id,
      action: 'lead.created',
      entity_type: 'lead',
      entity_id: leadId,
      after: resource as unknown as Record<string, unknown>,
      correlation_id: ctx.correlationId,
      occurred_at: now,
    });

    // 5b. First contact task generation (TASK-110 / Workflow A)
    if (this.deps.taskPort && (leadRow.owner_user_id || leadRow.owner_queue_id)) {
      try {
        await this.deps.taskPort.createTask(tx, ctx, {
          type: 'CALL',
          title: `First contact: ${leadRow.full_name}`,
          owner: leadRow.owner_user_id
            ? { userId: leadRow.owner_user_id }
            : { queueId: leadRow.owner_queue_id! },
          linked: {
            type: 'LEAD',
            id: leadId,
            branchId: leadRow.branch_id,
          },
          priority: 'MEDIUM',
          slaClass: 'CUSTOMER_FIRST_CONTACT',
          idempotencyKey: `lead_${leadId}:first-contact`,
        });
      } catch {
        // Non-blocking if task/SLA resolution unavailable in unit testing
      }
    }

    // 6. Save Idempotency
    await this.deps.repository.saveIdempotency(tx, {
      tenant_id: tenantId,
      principal_id: ctx.principal.id,
      key: idempotencyKey,
      method: 'POST',
      path: '/v1/leads',
      request_hash: hash,
      status: 'COMPLETED',
      response_status: 201,
      response_body: resource as unknown as Record<string, unknown>,
      resource_ref: leadId,
      created_at: now,
      expires_at: new Date(now.getTime() + 86400000),
    });

    return { resource, etag: '"0"', isReplayed: false };
  }

  /**
   * API-LEAD-002: List Leads
   */
  async listLeads(
    tx: Tx,
    ctx: RequestContext,
    query: LeadListQuery,
  ): Promise<{ data: MaskedLeadResource[]; meta: { nextCursor: string | null; limit: number } }> {
    requirePermission(ctx, 'lead.read');
    const scope = getScopeFilter(ctx, 'lead.read');

    const stateFilter = query['filter[state]'] ?? query.state;
    const ownerFilter = query['filter[ownerUserId]'] ?? query.ownerUserId;
    const branchFilter = query['filter[branchId]'] ?? query.branchId;

    const result = await this.deps.repository.listLeads(tx, {
      tenantId: ctx.principal.tenantId,
      state: stateFilter,
      ownerUserId: ownerFilter,
      branchId: branchFilter,
      allowedBranchIds: scope.branchIds,
      allowedTeamUserIds: scope.teamUserIds,
      allowedOwnUserId: scope.ownUserId,
      allowedQueueIds: scope.queueIds,
      isTenantWide: scope.isTenantWide,
      limit: query.limit,
      cursor: query.cursor,
    });

    return {
      data: result.leads.map((l) => this.toResource(l)),
      meta: {
        nextCursor: result.nextCursor,
        limit: query.limit,
      },
    };
  }

  /**
   * API-LEAD-003: Get Lead Detail
   */
  async getLead(
    tx: Tx,
    ctx: RequestContext,
    id: string,
  ): Promise<{ resource: MaskedLeadResource; etag: string }> {
    const lead = await this.deps.repository.findLeadById(tx, ctx.principal.tenantId, id);
    requireLeadAccess(ctx, 'lead.read', lead);

    return {
      resource: this.toResource(lead),
      etag: `"${lead.lock_version}"`,
    };
  }

  /**
   * API-LEAD-004: Update Lead (PATCH)
   */
  async updateLead(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    ifMatch: string,
    input: UpdateLeadInput,
  ): Promise<{ resource: MaskedLeadResource; etag: string }> {
    const lead = await this.deps.repository.findLeadByIdForUpdate(tx, ctx.principal.tenantId, id);
    requireLeadAccess(ctx, 'lead.update', lead);

    // ETag concurrency check
    const expectedLockVersion = parseLockVersion(ifMatch);
    if (expectedLockVersion !== lead.lock_version) {
      throw AppError.of('VERSION_CONFLICT', 'Resource has been modified (ETag mismatch).');
    }

    // Validations & S3 protection
    if (input.fullName !== undefined) assertNoS3Data(input.fullName, 'fullName');
    const emailNorm = input.email !== undefined ? normalizeEmail(input.email) : undefined;
    const emailHash = emailNorm ? computeEmailHash(ctx.principal.tenantId, emailNorm) : undefined;
    const pincode = input.pincode !== undefined ? validatePincode(input.pincode) : undefined;

    const updates: Partial<LeadRow> = {
      updated_by: ctx.principal.id,
    };
    if (input.fullName !== undefined) updates.full_name = input.fullName.trim();
    if (emailNorm !== undefined) {
      updates.email = emailNorm;
      updates.email_hash = emailHash;
    }
    if (input.indicativeAmount !== undefined) {
      updates.indicative_amount = input.indicativeAmount?.amount ?? null;
      if (input.indicativeAmount?.currency) updates.amount_currency = input.indicativeAmount.currency;
    }
    if (pincode !== undefined) updates.pincode = pincode;
    if (input.priority !== undefined) updates.priority = input.priority;
    if (input.tags !== undefined) updates.tags = input.tags;
    if (input.nextFollowUpAt !== undefined) {
      updates.next_follow_up_at = input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null;
    }
    if (input.qualApplicantType !== undefined) updates.qual_applicant_type = input.qualApplicantType;
    if (input.qualRequestedAmount !== undefined) {
      updates.qual_requested_amount = input.qualRequestedAmount?.amount ?? null;
    }
    if (input.qualTenureMonths !== undefined) updates.qual_tenure_months = input.qualTenureMonths;
    if (input.qualPurposeCode !== undefined) updates.qual_purpose_code = input.qualPurposeCode;

    const updated = await this.deps.repository.updateLead(
      tx,
      ctx.principal.tenantId,
      id,
      expectedLockVersion,
      updates,
    );
    if (!updated) {
      throw AppError.of('VERSION_CONFLICT', 'Failed to update lead due to concurrent modification.');
    }

    const resource = this.toResource(updated);
    await this.deps.repository.insertAuditEvent(tx, {
      id: this.nextId('aud'),
      tenant_id: ctx.principal.tenantId,
      actor_type: ctx.principal.kind,
      actor_id: ctx.principal.id,
      action: 'lead.updated',
      entity_type: 'lead',
      entity_id: id,
      after: resource as unknown as Record<string, unknown>,
      correlation_id: ctx.correlationId,
      occurred_at: ctx.now,
    });

    return { resource, etag: `"${updated.lock_version}"` };
  }

  /**
   * API-LEAD-005: State Transition
   */
  async transitionLead(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    ifMatch: string,
    idempotencyKey: string,
    input: LeadTransitionInput,
  ): Promise<{ resource: MaskedLeadResource; etag: string; isReplayed: boolean }> {
    const tenantId = ctx.principal.tenantId;
    const hash = requestHash({
      key: idempotencyKey,
      method: 'POST',
      path: `/v1/leads/${id}/transitions`,
      body: input,
    });

    // Idempotency check
    const existingIdem = await this.deps.repository.getIdempotency(
      tx,
      tenantId,
      ctx.principal.id,
      idempotencyKey,
    );
    if (existingIdem && existingIdem.status === 'COMPLETED' && existingIdem.response_body) {
      if (existingIdem.request_hash && existingIdem.request_hash !== hash) {
        throw AppError.of('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was used for a different request.');
      }
      return {
        resource: existingIdem.response_body as unknown as MaskedLeadResource,
        etag: `"${existingIdem.response_body.lockVersion}"`,
        isReplayed: true,
      };
    }
    if (existingIdem && existingIdem.status === 'IN_PROGRESS') {
      throw AppError.of('IDEMPOTENCY_IN_PROGRESS', 'Transition request is in progress.');
    }

    const lead = await this.deps.repository.findLeadByIdForUpdate(tx, tenantId, id);
    if (!lead) {
      throw AppError.of('NOT_FOUND', 'Lead not found');
    }

    // Validate transition & retrieve required permission
    const outcome = validateLeadTransition(lead, input);
    requireLeadAccess(ctx, outcome.requiredPermission, lead);

    // ETag concurrency check
    const expectedLockVersion = parseLockVersion(ifMatch);
    if (expectedLockVersion !== lead.lock_version) {
      throw AppError.of('VERSION_CONFLICT', 'Resource has been modified (ETag mismatch).');
    }

    const updated = await this.deps.repository.updateLead(
      tx,
      tenantId,
      id,
      expectedLockVersion,
      {
        ...outcome.updates,
        updated_by: ctx.principal.id,
      },
    );
    if (!updated) {
      throw AppError.of('VERSION_CONFLICT', 'Concurrent modification during transition.');
    }

    const now = ctx.now;

    // Append lead_status_history
    await this.deps.repository.insertLeadStatusHistory(tx, {
      id: this.nextId('lsh'),
      tenant_id: tenantId,
      lead_id: id,
      from_state: lead.state,
      to_state: outcome.targetState,
      transition_code: outcome.transitionCode,
      reason_code: input.reasonCode ?? input.disqualificationReason ?? null,
      actor: ctx.principal.id,
      occurred_at: now,
    });

    // Outbox event
    await this.deps.repository.insertOutboxEvent(tx, {
      id: this.nextId('evt'),
      tenant_id: tenantId,
      event_type: 'lead.state_changed',
      event_version: 1,
      subject_type: 'LEAD',
      subject_id: id,
      payload: {
        leadId: id,
        fromState: lead.state,
        toState: outcome.targetState,
        transitionCode: outcome.transitionCode,
      },
      correlation_id: ctx.correlationId,
      chain_depth: 0,
      created_at: now,
    });

    // Audit event
    const resource = this.toResource(updated);
    await this.deps.repository.insertAuditEvent(tx, {
      id: this.nextId('aud'),
      tenant_id: tenantId,
      actor_type: ctx.principal.kind,
      actor_id: ctx.principal.id,
      action: 'lead.state_changed',
      entity_type: 'lead',
      entity_id: id,
      after: resource as unknown as Record<string, unknown>,
      correlation_id: ctx.correlationId,
      occurred_at: now,
    });

    // Save idempotency
    await this.deps.repository.saveIdempotency(tx, {
      tenant_id: tenantId,
      principal_id: ctx.principal.id,
      key: idempotencyKey,
      method: 'POST',
      path: `/v1/leads/${id}/transitions`,
      request_hash: hash,
      status: 'COMPLETED',
      response_status: 200,
      response_body: resource as unknown as Record<string, unknown>,
      resource_ref: id,
      created_at: now,
      expires_at: new Date(now.getTime() + 86400000),
    });

    return { resource, etag: `"${updated.lock_version}"`, isReplayed: false };
  }

  /**
   * API-LEAD-006: Lead Assignment
   */
  async assignLead(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    ifMatch: string,
    idempotencyKey: string,
    input: AssignLeadInput,
  ): Promise<{ resource: MaskedLeadResource; etag: string; isReplayed: boolean }> {
    const tenantId = ctx.principal.tenantId;
    const hash = requestHash({
      key: idempotencyKey,
      method: 'POST',
      path: `/v1/leads/${id}/assignments`,
      body: input,
    });

    // Idempotency check
    const existingIdem = await this.deps.repository.getIdempotency(
      tx,
      tenantId,
      ctx.principal.id,
      idempotencyKey,
    );
    if (existingIdem && existingIdem.status === 'COMPLETED' && existingIdem.response_body) {
      if (existingIdem.request_hash && existingIdem.request_hash !== hash) {
        throw AppError.of('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was used for a different request.');
      }
      return {
        resource: existingIdem.response_body as unknown as MaskedLeadResource,
        etag: `"${existingIdem.response_body.lockVersion}"`,
        isReplayed: true,
      };
    }
    if (existingIdem && existingIdem.status === 'IN_PROGRESS') {
      throw AppError.of('IDEMPOTENCY_IN_PROGRESS', 'Assignment request is in progress.');
    }

    requirePermission(ctx, 'lead.assign');

    const lead = await this.deps.repository.findLeadByIdForUpdate(tx, tenantId, id);
    requireLeadAccess(ctx, 'lead.assign', lead);

    // ETag check
    const expectedLockVersion = parseLockVersion(ifMatch);
    if (expectedLockVersion !== lead.lock_version) {
      throw AppError.of('VERSION_CONFLICT', 'Resource has been modified (ETag mismatch).');
    }

    // Validate assignee if directory port exists
    if (input.toUserId && this.deps.userDirectoryPort) {
      const dirUser = await this.deps.userDirectoryPort.getUser(tx, input.toUserId);
      if (!dirUser || dirUser.status !== 'ACTIVE' || !dirUser.branchIds.includes(lead.branch_id)) {
        throw AppError.of('INVALID_ASSIGNEE', `User ${input.toUserId} cannot own leads in branch ${lead.branch_id}`);
      }
    }
    if (input.toQueueId && this.deps.userDirectoryPort) {
      const queue = await this.deps.userDirectoryPort.getQueue(tx, input.toQueueId);
      if (!queue || !queue.active) {
        throw AppError.of('INVALID_ASSIGNEE', `Queue ${input.toQueueId} is invalid or inactive`);
      }
    }

    const updated = await this.deps.repository.updateLead(
      tx,
      tenantId,
      id,
      expectedLockVersion,
      {
        owner_user_id: input.toUserId ?? null,
        owner_queue_id: input.toQueueId ?? null,
        updated_by: ctx.principal.id,
      },
    );
    if (!updated) {
      throw AppError.of('VERSION_CONFLICT', 'Concurrent modification during assignment.');
    }

    const now = ctx.now;

    // Append lead_assignment
    await this.deps.repository.insertLeadAssignment(tx, {
      id: this.nextId('asg'),
      tenant_id: tenantId,
      lead_id: id,
      from_user_id: lead.owner_user_id,
      from_queue_id: lead.owner_queue_id,
      to_user_id: input.toUserId ?? null,
      to_queue_id: input.toQueueId ?? null,
      reason_code: input.reasonCode,
      actor: ctx.principal.id,
      assigned_at: now,
    });

    const isReassignment = lead.owner_user_id !== null || lead.owner_queue_id !== null;
    await this.deps.repository.insertOutboxEvent(tx, {
      id: this.nextId('evt'),
      tenant_id: tenantId,
      event_type: isReassignment ? 'lead.reassigned' : 'lead.assigned',
      event_version: 1,
      subject_type: 'LEAD',
      subject_id: id,
      payload: {
        leadId: id,
        toUserId: input.toUserId,
        toQueueId: input.toQueueId,
      },
      correlation_id: ctx.correlationId,
      chain_depth: 0,
      created_at: now,
    });

    const resource = this.toResource(updated);
    await this.deps.repository.insertAuditEvent(tx, {
      id: this.nextId('aud'),
      tenant_id: tenantId,
      actor_type: ctx.principal.kind,
      actor_id: ctx.principal.id,
      action: isReassignment ? 'lead.reassigned' : 'lead.assigned',
      entity_type: 'lead',
      entity_id: id,
      after: resource as unknown as Record<string, unknown>,
      correlation_id: ctx.correlationId,
      occurred_at: now,
    });

    await this.deps.repository.saveIdempotency(tx, {
      tenant_id: tenantId,
      principal_id: ctx.principal.id,
      key: idempotencyKey,
      method: 'POST',
      path: `/v1/leads/${id}/assignments`,
      request_hash: hash,
      status: 'COMPLETED',
      response_status: 200,
      response_body: resource as unknown as Record<string, unknown>,
      resource_ref: id,
      created_at: now,
      expires_at: new Date(now.getTime() + 86400000),
    });

    return { resource, etag: `"${updated.lock_version}"`, isReplayed: false };
  }

  /**
   * API-LEAD-007: Atomic Lead Conversion (TASK-110)
   */
  async convertLead(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    ifMatch: string,
    idempotencyKey: string,
    input: ConvertLeadInput,
  ): Promise<{ result: LeadConversionResult; etag: string; isReplayed: boolean }> {
    const tenantId = ctx.principal.tenantId;
    const hash = requestHash({
      key: idempotencyKey,
      method: 'POST',
      path: `/v1/leads/${id}/conversion`,
      body: input,
    });

    // Idempotency check
    const existingIdem = await this.deps.repository.getIdempotency(
      tx,
      tenantId,
      ctx.principal.id,
      idempotencyKey,
    );
    if (existingIdem && existingIdem.status === 'COMPLETED' && existingIdem.response_body) {
      if (existingIdem.request_hash && existingIdem.request_hash !== hash) {
        throw AppError.of('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was used for a different request.');
      }
      return {
        result: existingIdem.response_body as unknown as LeadConversionResult,
        etag: `"${existingIdem.response_body.lockVersion ?? 1}"`,
        isReplayed: true,
      };
    }
    if (existingIdem && existingIdem.status === 'IN_PROGRESS') {
      throw AppError.of('IDEMPOTENCY_IN_PROGRESS', 'Conversion request is in progress.');
    }

    requirePermission(ctx, 'application.create');

    const lead = await this.deps.repository.findLeadByIdForUpdate(tx, tenantId, id);
    requireLeadAccess(ctx, 'application.create', lead);

    // ETag check
    const expectedLockVersion = parseLockVersion(ifMatch);
    if (expectedLockVersion !== lead.lock_version) {
      throw AppError.of('VERSION_CONFLICT', 'Resource has been modified (ETag mismatch).');
    }

    // Lead must be in QUALIFIED state
    if (lead.state !== 'QUALIFIED') {
      throw AppError.of(
        'INVALID_STATE',
        `Lead is in '${lead.state}' state and cannot be converted. Only QUALIFIED leads can be converted.`,
      );
    }

    if (!lead.qual_applicant_type || !lead.qual_requested_amount) {
      throw AppError.of(
        'VALIDATION_ERROR',
        'Lead is missing qualification fields required for conversion.',
      );
    }

    const now = ctx.now;
    let customerId = input.customerId;

    // 1. Customer resolution / creation
    if (customerId) {
      const existingCustomer = await this.deps.repository.findCustomerById(tx, tenantId, customerId);
      if (!existingCustomer) {
        throw AppError.of('NOT_FOUND', `Customer ${customerId} not found.`);
      }
    } else {
      customerId = this.nextId('cust');
      const partyType = lead.qual_applicant_type === 'NON_INDIVIDUAL' ? 'ENTITY' : 'INDIVIDUAL';

      await this.deps.repository.insertCustomer(tx, {
        id: customerId,
        tenant_id: tenantId,
        party_type: partyType,
        full_name: lead.full_name,
        home_branch_id: lead.branch_id,
        status: 'ACTIVE',
        lock_version: 0,
        created_at: now,
        created_by: ctx.principal.id,
        updated_at: now,
        updated_by: ctx.principal.id,
      });

      // Contact point: MOBILE
      await this.deps.repository.insertCustomerContactPoint(tx, {
        id: this.nextId('ccp'),
        tenant_id: tenantId,
        customer_id: customerId,
        kind: 'MOBILE',
        value: lead.mobile_e164,
        value_hash: lead.mobile_hash,
        is_primary: true,
        created_at: now,
        created_by: ctx.principal.id,
      });

      // Contact point: EMAIL (if available)
      if (lead.email && lead.email_hash) {
        await this.deps.repository.insertCustomerContactPoint(tx, {
          id: this.nextId('ccp'),
          tenant_id: tenantId,
          customer_id: customerId,
          kind: 'EMAIL',
          value: lead.email,
          value_hash: lead.email_hash,
          is_primary: true,
          created_at: now,
          created_by: ctx.principal.id,
        });
      }

      // Clone active lead consents to customer (DPDP compliance)
      const leadConsents = await this.deps.repository.listConsentsBySubject(tx, tenantId, 'LEAD', lead.id);
      for (const lc of leadConsents) {
        if (lc.status === 'ACTIVE') {
          await this.deps.repository.insertConsentRecord(tx, {
            id: this.nextId('cnst'),
            tenant_id: tenantId,
            subject_type: 'CUSTOMER',
            subject_id: customerId,
            purpose: lc.purpose,
            purpose_target: lc.purpose_target,
            notice_version: lc.notice_version,
            channel: lc.channel,
            evidence_ref: lc.evidence_ref,
            captured_by: lc.captured_by,
            captured_at: lc.captured_at,
            status: 'ACTIVE',
            withdrawn_at: null,
            withdrawn_by: null,
            withdrawal_reason: null,
            expires_at: lc.expires_at,
            created_at: now,
          });
        }
      }
    }

    // 2. Application creation
    let applicationId: string;
    const salesOwnerId = lead.owner_user_id ?? ctx.principal.id;
    const partyType = lead.qual_applicant_type === 'NON_INDIVIDUAL' ? 'ENTITY' : 'INDIVIDUAL';

    if (this.deps.applicationPort) {
      const appDraft = await this.deps.applicationPort.createDraftFromConversion(tx, ctx, {
        leadId: lead.id,
        customerId,
        branchId: lead.branch_id,
        partyType,
        productCategory: lead.product_category,
        requestedAmount: {
          amount: lead.qual_requested_amount,
          currency: lead.amount_currency,
        },
        tenureMonths: lead.qual_tenure_months ?? undefined,
        purposeCode: (lead.qual_purpose_code as 'PERSONAL_NEEDS' | 'OTHER') ?? undefined,
        applicantType: lead.qual_applicant_type,
        salesOwnerUserId: salesOwnerId,
      });
      applicationId = appDraft.applicationId;
    } else {
      applicationId = this.nextId('app');
      await this.deps.repository.insertLoanApplication(tx, {
        id: applicationId,
        tenant_id: tenantId,
        branch_id: lead.branch_id,
        customer_id: customerId,
        lead_id: lead.id,
        product_category: lead.product_category,
        requested_amount: lead.qual_requested_amount,
        currency: lead.amount_currency,
        tenure_months: lead.qual_tenure_months,
        purpose_code: lead.qual_purpose_code,
        applicant_type: lead.qual_applicant_type,
        status: 'DRAFT',
        sales_owner_id: salesOwnerId,
        lock_version: 0,
        created_at: now,
        created_by: ctx.principal.id,
        updated_at: now,
        updated_by: ctx.principal.id,
      });

      // Application Party (PRIMARY)
      await this.deps.repository.insertApplicationParty(tx, {
        id: this.nextId('pty'),
        tenant_id: tenantId,
        application_id: applicationId,
        customer_id: customerId,
        role: 'PRIMARY',
        party_type: partyType,
        created_at: now,
        created_by: ctx.principal.id,
      });

      // Application Status History
      await this.deps.repository.insertApplicationStatusHistory(tx, {
        id: this.nextId('ash'),
        tenant_id: tenantId,
        application_id: applicationId,
        from_status: null,
        to_status: 'DRAFT',
        transition_code: 'CREATE',
        reason_code: 'CONVERSION',
        actor: ctx.principal.id,
        occurred_at: now,
      });
    }

    // 3. Update Lead to CONVERTED
    const updatedLead = await this.deps.repository.updateLead(
      tx,
      tenantId,
      id,
      expectedLockVersion,
      {
        state: 'CONVERTED',
        customer_id: customerId,
        application_id: applicationId,
        updated_by: ctx.principal.id,
      },
    );
    if (!updatedLead) {
      throw AppError.of('VERSION_CONFLICT', 'Concurrent modification during lead conversion.');
    }

    // 4. Append lead_status_history
    await this.deps.repository.insertLeadStatusHistory(tx, {
      id: this.nextId('lsh'),
      tenant_id: tenantId,
      lead_id: id,
      from_state: 'QUALIFIED',
      to_state: 'CONVERTED',
      transition_code: 'T-LEAD-07',
      reason_code: 'CONVERTED_TO_APPLICATION',
      actor: ctx.principal.id,
      occurred_at: now,
    });

    // 5. Outbox events
    await this.deps.repository.insertOutboxEvent(tx, {
      id: this.nextId('evt'),
      tenant_id: tenantId,
      event_type: 'lead.converted',
      event_version: 1,
      subject_type: 'LEAD',
      subject_id: id,
      payload: {
        leadId: id,
        customerId,
        applicationId,
      },
      correlation_id: ctx.correlationId,
      chain_depth: 0,
      created_at: now,
    });

    await this.deps.repository.insertOutboxEvent(tx, {
      id: this.nextId('evt'),
      tenant_id: tenantId,
      event_type: 'application.created',
      event_version: 1,
      subject_type: 'LOAN_APPLICATION',
      subject_id: applicationId,
      payload: {
        applicationId,
        customerId,
        leadId: id,
      },
      correlation_id: ctx.correlationId,
      chain_depth: 0,
      created_at: now,
    });

    // 6. Audit event
    await this.deps.repository.insertAuditEvent(tx, {
      id: this.nextId('aud'),
      tenant_id: tenantId,
      actor_type: ctx.principal.kind,
      actor_id: ctx.principal.id,
      action: 'lead.converted',
      entity_type: 'lead',
      entity_id: id,
      after: {
        leadId: id,
        customerId,
        applicationId,
        state: 'CONVERTED',
      },
      correlation_id: ctx.correlationId,
      occurred_at: now,
    });

    const conversionResult: LeadConversionResult = {
      leadId: id,
      customerId,
      applicationId,
      status: 'CONVERTED',
    };

    // 7. Save Idempotency
    await this.deps.repository.saveIdempotency(tx, {
      tenant_id: tenantId,
      principal_id: ctx.principal.id,
      key: idempotencyKey,
      method: 'POST',
      path: `/v1/leads/${id}/conversion`,
      request_hash: hash,
      status: 'COMPLETED',
      response_status: 200,
      response_body: conversionResult as unknown as Record<string, unknown>,
      resource_ref: id,
      created_at: now,
      expires_at: new Date(now.getTime() + 86400000),
    });

    return {
      result: conversionResult,
      etag: `"${updatedLead.lock_version}"`,
      isReplayed: false,
    };
  }
}
