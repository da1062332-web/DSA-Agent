// apps/api/src/modules/crm/leads/repository.ts — owner: Dev 5 (ENT-020 persistence)
import { AppError, type Tx } from '@dsa/contracts';
import { sql } from 'kysely';
import type { ApplicantType, DuplicateFlag, LeadPriority, LeadState, ProductCategory } from './types';

export interface LeadRow {
  id: string;
  /** M-074: set with state ARCHIVED (T-LEAD-07), cleared on restore. */
  archived_at?: Date | null;
  /** M-074: the surviving lead once this one is MERGED (API-LEAD-009). */
  merged_into_id?: string | null;
  tenant_id: string;
  branch_id: string;
  full_name: string;
  mobile_e164: string;
  mobile_hash: Buffer;
  email: string | null;
  email_hash: Buffer | null;
  product_category: ProductCategory;
  indicative_amount: string | null;
  amount_currency: string;
  pincode: string | null;
  source: string;
  sub_source: string | null;
  campaign: string | null;
  utm: Record<string, unknown> | null;
  connector_id: string | null;
  referred_at: Date | null;
  state: LeadState;
  disqualification_reason: string | null;
  qual_applicant_type: ApplicantType | null;
  qual_requested_amount: string | null;
  qual_tenure_months: number | null;
  qual_purpose_code: string | null;
  owner_user_id: string | null;
  owner_queue_id: string | null;
  priority: LeadPriority;
  customer_id: string | null;
  application_id: string | null;
  duplicate_flag: DuplicateFlag;
  duplicate_candidate_ids: string[];
  last_duplicate_decision_id: string | null;
  last_routing_decision_id: string | null;
  contact_attempts: number;
  tags: string[];
  next_follow_up_at: Date | null;
  lock_version: number;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
}

export interface ConsentRecordRow {
  id: string;
  tenant_id: string;
  subject_type: 'LEAD' | 'CUSTOMER';
  subject_id: string;
  purpose: string;
  purpose_target: string | null;
  notice_version: string;
  channel: string;
  evidence_ref: string | null;
  captured_by: string;
  captured_at: Date;
  status: 'ACTIVE' | 'WITHDRAWN' | 'EXPIRED';
  withdrawn_at?: Date | null;
  withdrawn_by?: string | null;
  withdrawal_reason?: string | null;
  expires_at?: Date | null;
  created_at?: Date;
}

export interface LeadStatusHistoryRow {
  id: string;
  tenant_id: string;
  lead_id: string;
  from_state: string | null;
  to_state: string;
  transition_code: string;
  reason_code?: string | null;
  actor: string;
  activity_id?: string | null;
  decision_record_id?: string | null;
  occurred_at?: Date;
}

export interface LeadAssignmentRow {
  id: string;
  tenant_id: string;
  lead_id: string;
  from_user_id: string | null;
  from_queue_id: string | null;
  to_user_id: string | null;
  to_queue_id: string | null;
  reason_code: string;
  actor: string;
  decision_record_id?: string | null;
  assigned_at?: Date;
}

export interface CustomerRow {
  id: string;
  tenant_id: string;
  party_type: 'INDIVIDUAL' | 'ENTITY';
  full_name: string;
  home_branch_id: string;
  status: 'ACTIVE' | 'MERGED';
  lock_version: number;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
}

export interface CustomerContactPointRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  kind: 'MOBILE' | 'EMAIL';
  value: string;
  value_hash: Buffer;
  is_primary: boolean;
  verified_at?: Date | null;
  created_at: Date;
  created_by: string;
}

export interface OutboxEventRow {
  id: string;
  tenant_id: string;
  event_type: string;
  event_version: number;
  subject_type: string;
  subject_id: string;
  payload: Record<string, unknown>;
  correlation_id: string;
  chain_depth: number;
  created_at: Date;
}

export interface AuditEventRow {
  id: string;
  tenant_id: string;
  actor_type: 'USER' | 'SERVICE';
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  after: Record<string, unknown>;
  correlation_id: string;
  occurred_at: Date;
}

export interface IdempotencyRow {
  tenant_id: string;
  principal_id: string;
  key: string;
  method: string;
  path: string;
  request_hash: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  response_status: number | null;
  response_body: Record<string, unknown> | null;
  resource_ref?: string | null;
  created_at: Date;
  expires_at: Date;
}

export interface ListLeadsParams {
  tenantId: string;
  state?: string;
  ownerUserId?: string;
  branchId?: string;
  allowedBranchIds?: string[];
  allowedTeamUserIds?: string[];
  allowedOwnUserId?: string | null;
  allowedQueueIds?: string[];
  isTenantWide?: boolean;
  limit: number;
  cursor?: string;
}

export interface LeadRepository {
  insertLead(tx: Tx, lead: LeadRow): Promise<void>;
  findLeadById(tx: Tx, tenantId: string, id: string): Promise<LeadRow | null>;
  findLeadByIdForUpdate(tx: Tx, tenantId: string, id: string): Promise<LeadRow | null>;
  findLeadsByMobileHash(tx: Tx, tenantId: string, mobileHash: Buffer): Promise<LeadRow[]>;
  listLeads(tx: Tx, params: ListLeadsParams): Promise<{ leads: LeadRow[]; nextCursor: string | null }>;
  updateLead(
    tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<LeadRow>,
  ): Promise<LeadRow | null>;
  insertConsentRecord(tx: Tx, consent: ConsentRecordRow): Promise<void>;
  listConsentsBySubject(
    tx: Tx,
    tenantId: string,
    subjectType: 'CUSTOMER' | 'LEAD',
    subjectId: string,
  ): Promise<ConsentRecordRow[]>;
  insertLeadStatusHistory(tx: Tx, history: LeadStatusHistoryRow): Promise<void>;
  insertLeadAssignment(tx: Tx, assignment: LeadAssignmentRow): Promise<void>;
  insertCustomer(tx: Tx, customer: CustomerRow): Promise<void>;
  findCustomerById(tx: Tx, tenantId: string, id: string): Promise<CustomerRow | null>;
  insertCustomerContactPoint(tx: Tx, cp: CustomerContactPointRow): Promise<void>;
  insertOutboxEvent(tx: Tx, event: OutboxEventRow): Promise<void>;
  insertAuditEvent(tx: Tx, audit: AuditEventRow): Promise<void>;
  getIdempotency(tx: Tx, tenantId: string, principalId: string, key: string): Promise<IdempotencyRow | null>;
  saveIdempotency(tx: Tx, row: IdempotencyRow): Promise<void>;
  /** SUB-LEAD.04: queue duplicate pairs for review (M-074). Optional: the in-memory test repository has no queue. */
  insertDuplicateReviews?(tx: Tx, rows: DuplicateReviewRow[]): Promise<void>;
}

export interface DuplicateReviewRow {
  id: string;
  tenant_id: string;
  left_id: string;
  right_id: string;
  classification: 'POSSIBLE' | 'EXACT' | 'ATTRIBUTION_CONFLICT';
  decision_record_id: string | null;
  created_by: string;
}

/** Real SQL implementation of LeadRepository using Kysely SQL against PostgreSQL. */
export class SqlLeadRepository implements LeadRepository {
  async insertDuplicateReviews(tx: Tx, rows: DuplicateReviewRow[]): Promise<void> {
    for (const r of rows) {
      // One open review per pair, whichever lead came first; a pair already queued is left as it is.
      const pairHash = [r.left_id, r.right_id].sort().join(':');
      await sql`
        INSERT INTO duplicate_review (id, tenant_id, left_id, right_id, classification, pair_hash, decision_record_id,
                                      created_by, updated_by)
        VALUES (${r.id}, ${r.tenant_id}, ${r.left_id}, ${r.right_id}, ${r.classification}, ${pairHash},
                ${r.decision_record_id}, ${r.created_by}, ${r.created_by})
        ON CONFLICT (tenant_id, pair_hash) WHERE status = 'OPEN' DO NOTHING
      `.execute(tx);
    }
  }

  async insertLead(tx: Tx, lead: LeadRow): Promise<void> {
    await sql`
      INSERT INTO lead (
        id, tenant_id, branch_id, full_name, mobile_e164, mobile_hash, email, email_hash,
        product_category, indicative_amount, amount_currency, pincode, source, sub_source,
        campaign, utm, connector_id, state, owner_user_id, owner_queue_id, priority,
        duplicate_flag, duplicate_candidate_ids, last_duplicate_decision_id, last_routing_decision_id,
        contact_attempts, tags, lock_version, created_at, created_by, updated_at, updated_by
      ) VALUES (
        ${lead.id}, ${lead.tenant_id}, ${lead.branch_id}, ${lead.full_name}, ${lead.mobile_e164},
        ${lead.mobile_hash}, ${lead.email}, ${lead.email_hash}, ${lead.product_category},
        ${lead.indicative_amount}, ${lead.amount_currency}, ${lead.pincode}, ${lead.source},
        ${lead.sub_source}, ${lead.campaign}, ${lead.utm ? JSON.stringify(lead.utm) : null}::jsonb,
        ${lead.connector_id}, ${lead.state}, ${lead.owner_user_id}, ${lead.owner_queue_id},
        ${lead.priority}, ${lead.duplicate_flag}, ${lead.duplicate_candidate_ids},
        ${lead.last_duplicate_decision_id}, ${lead.last_routing_decision_id},
        ${lead.contact_attempts}, ${lead.tags}, ${lead.lock_version}, ${lead.created_at},
        ${lead.created_by}, ${lead.updated_at}, ${lead.updated_by}
      )
    `.execute(tx);
  }

  async findLeadById(tx: Tx, tenantId: string, id: string): Promise<LeadRow | null> {
    const result = await sql<LeadRow>`
      SELECT * FROM lead WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return result.rows[0] ?? null;
  }

  async findLeadByIdForUpdate(tx: Tx, tenantId: string, id: string): Promise<LeadRow | null> {
    const result = await sql<LeadRow>`
      SELECT * FROM lead WHERE tenant_id = ${tenantId} AND id = ${id} FOR UPDATE
    `.execute(tx);
    return result.rows[0] ?? null;
  }

  async findLeadsByMobileHash(tx: Tx, tenantId: string, mobileHash: Buffer): Promise<LeadRow[]> {
    const result = await sql<LeadRow>`
      SELECT * FROM lead
      WHERE tenant_id = ${tenantId} AND mobile_hash = ${mobileHash}
      ORDER BY created_at DESC
      LIMIT 10
    `.execute(tx);
    return result.rows;
  }

  async listLeads(tx: Tx, params: ListLeadsParams): Promise<{ leads: LeadRow[]; nextCursor: string | null }> {
    // Decoding cursor
    let cursorCreatedAt: string | null = null;
    let cursorId: string | null = null;
    if (params.cursor) {
      let decoded: { k?: unknown; id?: unknown } | null = null;
      try {
        decoded = JSON.parse(Buffer.from(params.cursor, 'base64url').toString('utf8'));
      } catch {
        decoded = null;
      }
      if (!decoded || typeof decoded.k !== 'string' || typeof decoded.id !== 'string') {
        // A malformed cursor is the caller's mistake: 422, never a silent restart at page one.
        throw AppError.of('VALIDATION_ERROR', 'Invalid pagination cursor', [
          { field: 'cursor', issue: 'INVALID_CURSOR' },
        ]);
      }
      cursorCreatedAt = decoded.k;
      cursorId = decoded.id;
    }

    const stateFilter = params.state ? params.state.split(',') : null;
    const fetchLimit = params.limit + 1;

    // Use parameterized query with dynamic scope conditions
    const query = sql<LeadRow>`
      SELECT * FROM lead
      WHERE tenant_id = ${params.tenantId}
      ${stateFilter ? sql`AND state = ANY(${stateFilter})` : sql``}
      ${params.ownerUserId ? sql`AND owner_user_id = ${params.ownerUserId}` : sql``}
      ${params.branchId ? sql`AND branch_id = ${params.branchId}` : sql``}
      ${
        !params.isTenantWide
          ? sql`AND (
              ${params.allowedBranchIds && params.allowedBranchIds.length > 0 ? sql`branch_id = ANY(${params.allowedBranchIds})` : sql`false`}
              OR ${params.allowedTeamUserIds && params.allowedTeamUserIds.length > 0 ? sql`owner_user_id = ANY(${params.allowedTeamUserIds})` : sql`false`}
              OR ${params.allowedOwnUserId ? sql`owner_user_id = ${params.allowedOwnUserId}` : sql`false`}
              OR ${params.allowedQueueIds && params.allowedQueueIds.length > 0 ? sql`owner_queue_id = ANY(${params.allowedQueueIds})` : sql`false`}
            )`
          : sql``
      }
      ${
        cursorCreatedAt && cursorId
          ? sql`AND (created_at, id) < (${new Date(cursorCreatedAt)}, ${cursorId})`
          : sql``
      }
      ORDER BY created_at DESC, id DESC
      LIMIT ${fetchLimit}
    `;

    const result = await query.execute(tx);
    const rows = result.rows;
    const hasMore = rows.length > params.limit;
    const leads = hasMore ? rows.slice(0, params.limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore && leads.length > 0) {
      const last = leads[leads.length - 1]!;
      nextCursor = Buffer.from(
        JSON.stringify({ k: new Date(last.created_at).toISOString(), id: last.id }),
      ).toString('base64url');
    }

    return { leads, nextCursor };
  }

  async updateLead(
    tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<LeadRow>,
  ): Promise<LeadRow | null> {
    const existing = await this.findLeadByIdForUpdate(tx, tenantId, id);
    if (!existing) return null;
    if (existing.lock_version !== expectedLockVersion) {
      return null;
    }

    const nextLockVersion = existing.lock_version + 1;
    const now = new Date();

    await sql`
      UPDATE lead SET
        full_name = ${updates.full_name !== undefined ? updates.full_name : existing.full_name},
        email = ${updates.email !== undefined ? updates.email : existing.email},
        email_hash = ${updates.email_hash !== undefined ? updates.email_hash : existing.email_hash},
        indicative_amount = ${updates.indicative_amount !== undefined ? updates.indicative_amount : existing.indicative_amount},
        pincode = ${updates.pincode !== undefined ? updates.pincode : existing.pincode},
        priority = ${updates.priority !== undefined ? updates.priority : existing.priority},
        state = ${updates.state !== undefined ? updates.state : existing.state},
        disqualification_reason = ${updates.disqualification_reason !== undefined ? updates.disqualification_reason : existing.disqualification_reason},
        qual_applicant_type = ${updates.qual_applicant_type !== undefined ? updates.qual_applicant_type : existing.qual_applicant_type},
        qual_requested_amount = ${updates.qual_requested_amount !== undefined ? updates.qual_requested_amount : existing.qual_requested_amount},
        qual_tenure_months = ${updates.qual_tenure_months !== undefined ? updates.qual_tenure_months : existing.qual_tenure_months},
        qual_purpose_code = ${updates.qual_purpose_code !== undefined ? updates.qual_purpose_code : existing.qual_purpose_code},
        owner_user_id = ${updates.owner_user_id !== undefined ? updates.owner_user_id : existing.owner_user_id},
        owner_queue_id = ${updates.owner_queue_id !== undefined ? updates.owner_queue_id : existing.owner_queue_id},
        customer_id = ${updates.customer_id !== undefined ? updates.customer_id : existing.customer_id},
        application_id = ${updates.application_id !== undefined ? updates.application_id : existing.application_id},
        duplicate_flag = ${updates.duplicate_flag !== undefined ? updates.duplicate_flag : existing.duplicate_flag},
        duplicate_candidate_ids = ${updates.duplicate_candidate_ids !== undefined ? updates.duplicate_candidate_ids : existing.duplicate_candidate_ids},
        contact_attempts = ${updates.contact_attempts !== undefined ? updates.contact_attempts : existing.contact_attempts},
        tags = ${updates.tags !== undefined ? updates.tags : existing.tags},
        next_follow_up_at = ${updates.next_follow_up_at !== undefined ? updates.next_follow_up_at : existing.next_follow_up_at},
        archived_at = ${updates.archived_at !== undefined ? updates.archived_at : (existing.archived_at ?? null)},
        merged_into_id = ${updates.merged_into_id !== undefined ? updates.merged_into_id : (existing.merged_into_id ?? null)},
        lock_version = ${nextLockVersion},
        updated_at = ${now},
        updated_by = ${updates.updated_by ?? existing.updated_by}
      WHERE tenant_id = ${tenantId} AND id = ${id} AND lock_version = ${expectedLockVersion}
    `.execute(tx);

    return this.findLeadById(tx, tenantId, id);
  }

  async insertConsentRecord(tx: Tx, consent: ConsentRecordRow): Promise<void> {
    await sql`
      INSERT INTO consent_record (
        id, tenant_id, subject_type, subject_id, purpose, purpose_target,
        notice_version, channel, evidence_ref, captured_by, captured_at, status, created_at
      ) VALUES (
        ${consent.id}, ${consent.tenant_id}, ${consent.subject_type}, ${consent.subject_id},
        ${consent.purpose}, ${consent.purpose_target}, ${consent.notice_version},
        ${consent.channel}, ${consent.evidence_ref}, ${consent.captured_by},
        ${consent.captured_at}, ${consent.status}, ${consent.created_at ?? new Date()}
      )
    `.execute(tx);
  }

  async listConsentsBySubject(
    tx: Tx,
    tenantId: string,
    subjectType: 'CUSTOMER' | 'LEAD',
    subjectId: string,
  ): Promise<ConsentRecordRow[]> {
    const result = await sql<ConsentRecordRow>`
      SELECT * FROM consent_record
      WHERE tenant_id = ${tenantId}
        AND subject_type = ${subjectType}
        AND subject_id = ${subjectId}
      ORDER BY created_at DESC, id DESC
    `.execute(tx);
    return result.rows;
  }

  async insertLeadStatusHistory(tx: Tx, history: LeadStatusHistoryRow): Promise<void> {
    await sql`
      INSERT INTO lead_status_history (
        id, tenant_id, lead_id, from_state, to_state, transition_code,
        reason_code, actor, activity_id, decision_record_id, occurred_at
      ) VALUES (
        ${history.id}, ${history.tenant_id}, ${history.lead_id}, ${history.from_state},
        ${history.to_state}, ${history.transition_code}, ${history.reason_code ?? null},
        ${history.actor}, ${history.activity_id ?? null}, ${history.decision_record_id ?? null},
        ${history.occurred_at ?? new Date()}
      )
    `.execute(tx);
  }

  async insertLeadAssignment(tx: Tx, assignment: LeadAssignmentRow): Promise<void> {
    await sql`
      INSERT INTO lead_assignment (
        id, tenant_id, lead_id, from_user_id, from_queue_id, to_user_id,
        to_queue_id, reason_code, actor, decision_record_id, assigned_at
      ) VALUES (
        ${assignment.id}, ${assignment.tenant_id}, ${assignment.lead_id},
        ${assignment.from_user_id}, ${assignment.from_queue_id}, ${assignment.to_user_id},
        ${assignment.to_queue_id}, ${assignment.reason_code}, ${assignment.actor},
        ${assignment.decision_record_id ?? null}, ${assignment.assigned_at ?? new Date()}
      )
    `.execute(tx);
  }

  async insertCustomer(tx: Tx, customer: CustomerRow): Promise<void> {
    await sql`
      INSERT INTO customer (
        id, tenant_id, party_type, full_name, home_branch_id, status, lock_version,
        created_at, created_by, updated_at, updated_by
      ) VALUES (
        ${customer.id}, ${customer.tenant_id}, ${customer.party_type}, ${customer.full_name},
        ${customer.home_branch_id}, ${customer.status}, ${customer.lock_version},
        ${customer.created_at}, ${customer.created_by}, ${customer.updated_at}, ${customer.updated_by}
      )
    `.execute(tx);
  }

  async findCustomerById(tx: Tx, tenantId: string, id: string): Promise<CustomerRow | null> {
    const result = await sql<CustomerRow>`
      SELECT * FROM customer WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return result.rows[0] ?? null;
  }

  async insertCustomerContactPoint(tx: Tx, cp: CustomerContactPointRow): Promise<void> {
    await sql`
      INSERT INTO customer_contact_point (
        id, tenant_id, customer_id, kind, value, value_hash, is_primary,
        created_at, created_by
      ) VALUES (
        ${cp.id}, ${cp.tenant_id}, ${cp.customer_id}, ${cp.kind}, ${cp.value},
        ${cp.value_hash}, ${cp.is_primary}, ${cp.created_at}, ${cp.created_by}
      )
    `.execute(tx);
  }

  async insertOutboxEvent(tx: Tx, event: OutboxEventRow): Promise<void> {
    await sql`
      INSERT INTO outbox_event (
        id, tenant_id, event_type, event_version, subject_type, subject_id,
        payload, correlation_id, chain_depth, created_at
      ) VALUES (
        ${event.id}, ${event.tenant_id}, ${event.event_type}, ${event.event_version},
        ${event.subject_type}, ${event.subject_id}, ${JSON.stringify(event.payload)}::jsonb,
        ${event.correlation_id}, ${event.chain_depth}, ${event.created_at}
      )
    `.execute(tx);
  }

  async insertAuditEvent(tx: Tx, audit: AuditEventRow): Promise<void> {
    await sql`
      INSERT INTO audit_event (
        id, tenant_id, actor_type, actor_id, action, entity_type, entity_id,
        after, correlation_id, occurred_at
      ) VALUES (
        ${audit.id}, ${audit.tenant_id}, ${audit.actor_type}, ${audit.actor_id},
        ${audit.action}, ${audit.entity_type}, ${audit.entity_id},
        ${JSON.stringify(audit.after)}::jsonb, ${audit.correlation_id}, ${audit.occurred_at}
      )
    `.execute(tx);
  }

  async getIdempotency(
    tx: Tx,
    tenantId: string,
    principalId: string,
    key: string,
  ): Promise<IdempotencyRow | null> {
    const result = await sql<IdempotencyRow>`
      SELECT * FROM idempotency_key
      WHERE tenant_id = ${tenantId} AND principal_id = ${principalId} AND key = ${key}
    `.execute(tx);
    return result.rows[0] ?? null;
  }

  async saveIdempotency(tx: Tx, row: IdempotencyRow): Promise<void> {
    await sql`
      INSERT INTO idempotency_key (
        tenant_id, principal_id, key, method, path, request_hash, status,
        response_status, response_body, resource_ref, created_at, expires_at
      ) VALUES (
        ${row.tenant_id}, ${row.principal_id}, ${row.key}, ${row.method}, ${row.path},
        ${row.request_hash}, ${row.status}, ${row.response_status},
        ${row.response_body ? JSON.stringify(row.response_body) : null}::jsonb,
        ${row.resource_ref ?? null}, ${row.created_at}, ${row.expires_at}
      )
      ON CONFLICT (tenant_id, principal_id, key) DO UPDATE SET
        status = EXCLUDED.status,
        response_status = EXCLUDED.response_status,
        response_body = EXCLUDED.response_body,
        resource_ref = EXCLUDED.resource_ref
    `.execute(tx);
  }
}

/** In-memory implementation of LeadRepository for tests and fast offline execution. */
export class InMemoryLeadRepository implements LeadRepository {
  readonly leads = new Map<string, LeadRow>();
  readonly consents = new Map<string, ConsentRecordRow>();
  readonly statusHistories: LeadStatusHistoryRow[] = [];
  readonly assignments: LeadAssignmentRow[] = [];
  readonly customers = new Map<string, CustomerRow>();
  readonly contactPoints = new Map<string, CustomerContactPointRow>();
  readonly outboxEvents: OutboxEventRow[] = [];
  readonly auditEvents: AuditEventRow[] = [];
  readonly idempotencyRecords = new Map<string, IdempotencyRow>();

  async insertLead(_tx: Tx, lead: LeadRow): Promise<void> {
    this.leads.set(lead.id, { ...lead });
  }

  async findLeadById(_tx: Tx, tenantId: string, id: string): Promise<LeadRow | null> {
    const l = this.leads.get(id);
    return l && l.tenant_id === tenantId ? { ...l } : null;
  }

  async findLeadByIdForUpdate(_tx: Tx, tenantId: string, id: string): Promise<LeadRow | null> {
    return this.findLeadById(_tx, tenantId, id);
  }

  async findLeadsByMobileHash(_tx: Tx, tenantId: string, mobileHash: Buffer): Promise<LeadRow[]> {
    const res: LeadRow[] = [];
    for (const l of this.leads.values()) {
      if (l.tenant_id === tenantId && Buffer.compare(l.mobile_hash, mobileHash) === 0) {
        res.push({ ...l });
      }
    }
    return res.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  }

  async listLeads(
    _tx: Tx,
    params: ListLeadsParams,
  ): Promise<{ leads: LeadRow[]; nextCursor: string | null }> {
    let all = Array.from(this.leads.values()).filter((l) => l.tenant_id === params.tenantId);

    if (params.state) {
      const allowed = params.state.split(',');
      all = all.filter((l) => allowed.includes(l.state));
    }
    if (params.ownerUserId) {
      all = all.filter((l) => l.owner_user_id === params.ownerUserId);
    }
    if (params.branchId) {
      all = all.filter((l) => l.branch_id === params.branchId);
    }

    if (!params.isTenantWide) {
      all = all.filter((l) => {
        if (params.allowedBranchIds && params.allowedBranchIds.includes(l.branch_id)) return true;
        if (
          params.allowedTeamUserIds &&
          l.owner_user_id &&
          params.allowedTeamUserIds.includes(l.owner_user_id)
        )
          return true;
        if (params.allowedOwnUserId && l.owner_user_id === params.allowedOwnUserId) return true;
        if (params.allowedQueueIds && l.owner_queue_id && params.allowedQueueIds.includes(l.owner_queue_id))
          return true;
        return false;
      });
    }

    all.sort((a, b) => {
      const diff = b.created_at.getTime() - a.created_at.getTime();
      return diff !== 0 ? diff : b.id.localeCompare(a.id);
    });

    if (params.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(params.cursor, 'base64url').toString('utf8'));
        const cursorTime = new Date(decoded.k).getTime();
        const cursorId = decoded.id;
        const idx = all.findIndex((l) => {
          const lTime = l.created_at.getTime();
          return lTime < cursorTime || (lTime === cursorTime && l.id < cursorId);
        });
        all = idx >= 0 ? all.slice(idx) : [];
      } catch {
        // ignore invalid cursor
      }
    }

    const hasMore = all.length > params.limit;
    const leads = hasMore ? all.slice(0, params.limit) : all;

    let nextCursor: string | null = null;
    if (hasMore && leads.length > 0) {
      const last = leads[leads.length - 1]!;
      nextCursor = Buffer.from(JSON.stringify({ k: last.created_at.toISOString(), id: last.id })).toString(
        'base64url',
      );
    }

    return { leads, nextCursor };
  }

  async updateLead(
    _tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<LeadRow>,
  ): Promise<LeadRow | null> {
    const existing = this.leads.get(id);
    if (!existing || existing.tenant_id !== tenantId) return null;
    if (existing.lock_version !== expectedLockVersion) return null;

    const updated: LeadRow = {
      ...existing,
      ...updates,
      lock_version: existing.lock_version + 1,
      updated_at: new Date(),
    };
    this.leads.set(id, updated);
    return { ...updated };
  }

  async insertConsentRecord(_tx: Tx, consent: ConsentRecordRow): Promise<void> {
    this.consents.set(consent.id, { ...consent });
  }

  async listConsentsBySubject(
    _tx: Tx,
    tenantId: string,
    subjectType: 'CUSTOMER' | 'LEAD',
    subjectId: string,
  ): Promise<ConsentRecordRow[]> {
    return Array.from(this.consents.values())
      .filter((c) => c.tenant_id === tenantId && c.subject_type === subjectType && c.subject_id === subjectId)
      .sort((a, b) => b.captured_at.getTime() - a.captured_at.getTime());
  }

  async insertLeadStatusHistory(_tx: Tx, history: LeadStatusHistoryRow): Promise<void> {
    this.statusHistories.push({ ...history });
  }

  async insertLeadAssignment(_tx: Tx, assignment: LeadAssignmentRow): Promise<void> {
    this.assignments.push({ ...assignment });
  }

  async insertCustomer(_tx: Tx, customer: CustomerRow): Promise<void> {
    this.customers.set(customer.id, { ...customer });
  }

  async findCustomerById(_tx: Tx, tenantId: string, id: string): Promise<CustomerRow | null> {
    const c = this.customers.get(id);
    return c && c.tenant_id === tenantId ? { ...c } : null;
  }

  async insertCustomerContactPoint(_tx: Tx, cp: CustomerContactPointRow): Promise<void> {
    this.contactPoints.set(cp.id, { ...cp });
  }

  async insertOutboxEvent(_tx: Tx, event: OutboxEventRow): Promise<void> {
    this.outboxEvents.push({ ...event });
  }

  async insertAuditEvent(_tx: Tx, audit: AuditEventRow): Promise<void> {
    this.auditEvents.push({ ...audit });
  }

  async getIdempotency(
    _tx: Tx,
    tenantId: string,
    principalId: string,
    key: string,
  ): Promise<IdempotencyRow | null> {
    return this.idempotencyRecords.get(`${tenantId}:${principalId}:${key}`) ?? null;
  }

  async saveIdempotency(_tx: Tx, row: IdempotencyRow): Promise<void> {
    this.idempotencyRecords.set(`${row.tenant_id}:${row.principal_id}:${row.key}`, { ...row });
  }
}
