// apps/api/src/modules/crm/customers/repository.ts — owner: Dev 5 (ENT-025, ENT-026, ENT-028 persistence)
import { AppError, type ConsentPurpose, type Tx } from '@dsa/contracts';
import { sql } from 'kysely';
import type { CustomerRow, CustomerStatus, PartyType } from './types';
export type { CustomerRow };

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

export interface ConsentRecordRow {
  id: string;
  tenant_id: string;
  subject_type: 'LEAD' | 'CUSTOMER';
  subject_id: string;
  purpose: ConsentPurpose;
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

export interface IdempotencyRow {
  tenant_id: string;
  principal_id: string;
  key: string;
  method: string;
  path: string;
  request_hash: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  response_status?: number | null;
  response_body?: Record<string, unknown> | null;
  resource_ref?: string | null;
  created_at: Date;
  expires_at: Date;
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
  causation_id?: string | null;
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
  after?: Record<string, unknown> | null;
  correlation_id: string;
  occurred_at: Date;
}

export interface CustomerListParams {
  tenantId: string;
  partyType?: PartyType;
  homeBranchId?: string;
  status?: CustomerStatus;
  allowedBranchIds?: string[];
  allowedTeamUserIds?: string[];
  allowedOwnUserId?: string | null;
  isTenantWide?: boolean;
  limit: number;
  cursor?: string;
}

export interface CustomerRepository {
  insertCustomer(tx: Tx, row: CustomerRow): Promise<void>;
  updateCustomer(
    tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<Pick<CustomerRow, 'full_name' | 'home_branch_id' | 'status' | 'updated_by'>>,
  ): Promise<CustomerRow | null>;
  findCustomerById(tx: Tx, tenantId: string, id: string): Promise<CustomerRow | null>;
  findCustomerByIdForUpdate(tx: Tx, tenantId: string, id: string): Promise<CustomerRow | null>;
  listCustomers(
    tx: Tx,
    params: CustomerListParams,
  ): Promise<{ customers: CustomerRow[]; nextCursor: string | null }>;

  insertContactPoint(tx: Tx, row: CustomerContactPointRow): Promise<void>;
  findPrimaryContactPoints(
    tx: Tx,
    tenantId: string,
    customerId: string,
  ): Promise<{ mobile?: string | null; email?: string | null }>;

  insertConsentRecord(tx: Tx, row: ConsentRecordRow): Promise<void>;
  findConsentById(tx: Tx, tenantId: string, id: string): Promise<ConsentRecordRow | null>;
  findActiveConsent(
    tx: Tx,
    tenantId: string,
    subjectType: 'CUSTOMER' | 'LEAD',
    subjectId: string,
    purpose: ConsentPurpose,
    purposeTarget?: string | null,
  ): Promise<ConsentRecordRow | null>;
  findActiveLeadConsentByCustomerId(
    tx: Tx,
    tenantId: string,
    customerId: string,
    purpose: ConsentPurpose,
    purposeTarget?: string | null,
  ): Promise<ConsentRecordRow | null>;
  listConsentsBySubject(
    tx: Tx,
    tenantId: string,
    subjectType: 'CUSTOMER' | 'LEAD',
    subjectId: string,
  ): Promise<ConsentRecordRow[]>;
  withdrawConsent(
    tx: Tx,
    tenantId: string,
    id: string,
    withdrawnAt: Date,
    withdrawnBy: string,
    reason?: string | null,
  ): Promise<ConsentRecordRow | null>;

  getIdempotency(tx: Tx, tenantId: string, principalId: string, key: string): Promise<IdempotencyRow | null>;
  saveIdempotency(tx: Tx, row: IdempotencyRow): Promise<void>;

  insertOutboxEvent(tx: Tx, event: OutboxEventRow): Promise<void>;
  insertAuditEvent(tx: Tx, event: AuditEventRow): Promise<void>;
}

export class SqlCustomerRepository implements CustomerRepository {
  async insertCustomer(tx: Tx, row: CustomerRow): Promise<void> {
    await sql`
      INSERT INTO customer (
        id, tenant_id, party_type, full_name, home_branch_id, status,
        lock_version, created_at, created_by, updated_at, updated_by
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.party_type}, ${row.full_name},
        ${row.home_branch_id}, ${row.status}, ${row.lock_version},
        ${row.created_at}, ${row.created_by}, ${row.updated_at}, ${row.updated_by}
      )
    `.execute(tx);
  }

  async updateCustomer(
    tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<Pick<CustomerRow, 'full_name' | 'home_branch_id' | 'status' | 'updated_by'>>,
  ): Promise<CustomerRow | null> {
    const result = await sql<CustomerRow>`
      UPDATE customer
      SET
        full_name = COALESCE(${updates.full_name ?? null}, full_name),
        home_branch_id = COALESCE(${updates.home_branch_id ?? null}, home_branch_id),
        status = COALESCE(${updates.status ?? null}, status),
        updated_by = ${updates.updated_by ?? 'system'},
        lock_version = lock_version + 1,
        updated_at = now()
      WHERE tenant_id = ${tenantId}
        AND id = ${id}
        AND lock_version = ${expectedLockVersion}
      RETURNING *
    `.execute(tx);

    return result.rows[0] ?? null;
  }

  async findCustomerById(tx: Tx, tenantId: string, id: string): Promise<CustomerRow | null> {
    if (!tenantId || tenantId.trim() === '') {
      throw AppError.of('TENANT_CONTEXT_MISSING', 'Tenant context is missing or invalid');
    }
    const result = await sql<CustomerRow>`
      SELECT * FROM customer
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return result.rows[0] ?? null;
  }

  async findCustomerByIdForUpdate(tx: Tx, tenantId: string, id: string): Promise<CustomerRow | null> {
    if (!tenantId || tenantId.trim() === '') {
      throw AppError.of('TENANT_CONTEXT_MISSING', 'Tenant context is missing or invalid');
    }
    const result = await sql<CustomerRow>`
      SELECT * FROM customer
      WHERE tenant_id = ${tenantId} AND id = ${id}
      FOR UPDATE
    `.execute(tx);
    return result.rows[0] ?? null;
  }

  async listCustomers(
    tx: Tx,
    params: CustomerListParams,
  ): Promise<{ customers: CustomerRow[]; nextCursor: string | null }> {
    const limit = params.limit;
    const fetchLimit = limit + 1;

    let cursorDate: Date | null = null;
    let cursorId: string | null = null;
    if (params.cursor) {
      try {
        const decoded = Buffer.from(params.cursor, 'base64url').toString('utf8');
        const [d, cid] = decoded.split('|');
        if (d && cid && !isNaN(new Date(d).getTime())) {
          cursorDate = new Date(d);
          cursorId = cid;
        } else {
          throw new Error('Invalid cursor');
        }
      } catch {
        throw AppError.of('VALIDATION_ERROR', 'Invalid pagination cursor', [
          { field: 'cursor', issue: 'INVALID_CURSOR' },
        ]);
      }
    }

    const result = await sql<CustomerRow>`
      SELECT * FROM customer
      WHERE tenant_id = ${params.tenantId}
        ${params.partyType ? sql`AND party_type = ${params.partyType}` : sql``}
        ${params.homeBranchId ? sql`AND home_branch_id = ${params.homeBranchId}` : sql``}
        ${params.status ? sql`AND status = ${params.status}` : sql``}
        ${
          !params.isTenantWide
            ? sql`AND (
                ${params.allowedBranchIds && params.allowedBranchIds.length > 0 ? sql`home_branch_id = ANY(${params.allowedBranchIds})` : sql`false`}
                OR ${params.allowedOwnUserId ? sql`created_by = ${params.allowedOwnUserId}` : sql`false`}
                OR ${params.allowedTeamUserIds && params.allowedTeamUserIds.length > 0 ? sql`created_by = ANY(${params.allowedTeamUserIds})` : sql`false`}
              )`
            : sql``
        }
        ${cursorDate && cursorId ? sql`AND (created_at, id) < (${cursorDate}, ${cursorId})` : sql``}
      ORDER BY created_at DESC, id DESC
      LIMIT ${fetchLimit}
    `.execute(tx);

    const rows = result.rows;
    let nextCursor: string | null = null;

    if (rows.length > limit) {
      const nextItem = rows[limit - 1];
      if (nextItem) {
        nextCursor = Buffer.from(`${nextItem.created_at.toISOString()}|${nextItem.id}`).toString('base64url');
      }
      rows.pop();
    }

    return { customers: rows, nextCursor };
  }

  async insertContactPoint(tx: Tx, row: CustomerContactPointRow): Promise<void> {
    await sql`
      INSERT INTO customer_contact_point (
        id, tenant_id, customer_id, kind, value, value_hash, is_primary, verified_at, created_at, created_by
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.customer_id}, ${row.kind}, ${row.value},
        ${row.value_hash}, ${row.is_primary}, ${row.verified_at ?? null}, ${row.created_at}, ${row.created_by}
      )
    `.execute(tx);
  }

  async findPrimaryContactPoints(
    tx: Tx,
    tenantId: string,
    customerId: string,
  ): Promise<{ mobile?: string | null; email?: string | null }> {
    if (!tenantId || tenantId.trim() === '') {
      throw AppError.of('TENANT_CONTEXT_MISSING', 'Tenant context is missing or invalid');
    }
    const result = await sql<CustomerContactPointRow>`
      SELECT * FROM customer_contact_point
      WHERE tenant_id = ${tenantId}
        AND customer_id = ${customerId}
        AND is_primary = true
    `.execute(tx);

    let mobile: string | null = null;
    let email: string | null = null;
    for (const cp of result.rows) {
      if (cp.kind === 'MOBILE') mobile = cp.value;
      if (cp.kind === 'EMAIL') email = cp.value;
    }
    return { mobile, email };
  }

  async insertConsentRecord(tx: Tx, row: ConsentRecordRow): Promise<void> {
    await sql`
      INSERT INTO consent_record (
        id, tenant_id, subject_type, subject_id, purpose, purpose_target,
        notice_version, channel, evidence_ref, captured_by, captured_at,
        status, withdrawn_at, withdrawn_by, withdrawal_reason, expires_at, created_at
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.subject_type}, ${row.subject_id},
        ${row.purpose}, ${row.purpose_target ?? null}, ${row.notice_version},
        ${row.channel}, ${row.evidence_ref ?? null}, ${row.captured_by},
        ${row.captured_at}, ${row.status}, ${row.withdrawn_at ?? null},
        ${row.withdrawn_by ?? null}, ${row.withdrawal_reason ?? null},
        ${row.expires_at ?? null}, ${row.created_at ?? new Date()}
      )
    `.execute(tx);
  }

  async findConsentById(tx: Tx, tenantId: string, id: string): Promise<ConsentRecordRow | null> {
    if (!tenantId || tenantId.trim() === '') {
      throw AppError.of('TENANT_CONTEXT_MISSING', 'Tenant context is missing or invalid');
    }
    const result = await sql<ConsentRecordRow>`
      SELECT * FROM consent_record
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return result.rows[0] ?? null;
  }

  async findActiveConsent(
    tx: Tx,
    tenantId: string,
    subjectType: 'CUSTOMER' | 'LEAD',
    subjectId: string,
    purpose: ConsentPurpose,
    purposeTarget?: string | null,
  ): Promise<ConsentRecordRow | null> {
    if (!tenantId || tenantId.trim() === '') {
      throw AppError.of('TENANT_CONTEXT_MISSING', 'Tenant context is missing or invalid');
    }
    const result = await sql<ConsentRecordRow>`
      SELECT * FROM consent_record
      WHERE tenant_id = ${tenantId}
        AND subject_type = ${subjectType}
        AND (subject_id = ${subjectId}
             -- M-074: consents of customers merged into this one keep counting.
             OR (subject_type = 'CUSTOMER'
                 AND subject_id IN (SELECT id FROM customer WHERE merged_into_id = ${subjectId})))
        AND purpose = ${purpose}
        AND status = 'ACTIVE'
        AND (expires_at IS NULL OR expires_at > now())
        ${purposeTarget ? sql`AND purpose_target = ${purposeTarget}` : sql``}
      ORDER BY captured_at DESC
      LIMIT 1
    `.execute(tx);
    return result.rows[0] ?? null;
  }

  async findActiveLeadConsentByCustomerId(
    tx: Tx,
    tenantId: string,
    customerId: string,
    purpose: ConsentPurpose,
    purposeTarget?: string | null,
  ): Promise<ConsentRecordRow | null> {
    if (!tenantId || tenantId.trim() === '') {
      throw AppError.of('TENANT_CONTEXT_MISSING', 'Tenant context is missing or invalid');
    }
    const result = await sql<ConsentRecordRow>`
      SELECT c.* FROM consent_record c
      JOIN lead l ON l.id = c.subject_id AND l.tenant_id = c.tenant_id
      WHERE c.tenant_id = ${tenantId}
        AND c.subject_type = 'LEAD'
        AND l.customer_id = ${customerId}
        AND c.purpose = ${purpose}
        AND c.status = 'ACTIVE'
        AND (c.expires_at IS NULL OR c.expires_at > now())
        ${purposeTarget ? sql`AND c.purpose_target = ${purposeTarget}` : sql``}
      ORDER BY c.captured_at DESC
      LIMIT 1
    `.execute(tx);
    return result.rows[0] ?? null;
  }

  async listConsentsBySubject(
    tx: Tx,
    tenantId: string,
    subjectType: 'CUSTOMER' | 'LEAD',
    subjectId: string,
  ): Promise<ConsentRecordRow[]> {
    if (!tenantId || tenantId.trim() === '') {
      throw AppError.of('TENANT_CONTEXT_MISSING', 'Tenant context is missing or invalid');
    }
    const result = await sql<ConsentRecordRow>`
      SELECT * FROM consent_record
      WHERE tenant_id = ${tenantId}
        AND subject_type = ${subjectType}
        AND subject_id = ${subjectId}
      ORDER BY created_at DESC, id DESC
    `.execute(tx);
    return result.rows;
  }

  async withdrawConsent(
    tx: Tx,
    tenantId: string,
    id: string,
    withdrawnAt: Date,
    withdrawnBy: string,
    reason?: string | null,
  ): Promise<ConsentRecordRow | null> {
    if (!tenantId || tenantId.trim() === '') {
      throw AppError.of('TENANT_CONTEXT_MISSING', 'Tenant context is missing or invalid');
    }
    const result = await sql<ConsentRecordRow>`
      UPDATE consent_record
      SET
        status = 'WITHDRAWN',
        withdrawn_at = ${withdrawnAt},
        withdrawn_by = ${withdrawnBy},
        withdrawal_reason = ${reason ?? null}
      WHERE tenant_id = ${tenantId}
        AND id = ${id}
        AND status = 'ACTIVE'
      RETURNING *
    `.execute(tx);

    return result.rows[0] ?? null;
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
        ${row.tenant_id}, ${row.principal_id}, ${row.key}, ${row.method},
        ${row.path}, ${row.request_hash}, ${row.status}, ${row.response_status ?? null},
        ${row.response_body ? JSON.stringify(row.response_body) : null}::jsonb,
        ${row.resource_ref ?? null}, ${row.created_at}, ${row.expires_at}
      )
      ON CONFLICT (tenant_id, principal_id, key) DO UPDATE
      SET
        status = EXCLUDED.status,
        response_status = EXCLUDED.response_status,
        response_body = EXCLUDED.response_body,
        resource_ref = EXCLUDED.resource_ref,
        request_hash = EXCLUDED.request_hash
    `.execute(tx);
  }

  async insertOutboxEvent(tx: Tx, event: OutboxEventRow): Promise<void> {
    await sql`
      INSERT INTO outbox_event (
        id, tenant_id, event_type, event_version, subject_type, subject_id,
        payload, correlation_id, causation_id, chain_depth, created_at
      ) VALUES (
        ${event.id}, ${event.tenant_id}, ${event.event_type}, ${event.event_version},
        ${event.subject_type}, ${event.subject_id}, ${JSON.stringify(event.payload)}::jsonb,
        ${event.correlation_id}, ${event.causation_id ?? null}, ${event.chain_depth}, ${event.created_at}
      )
    `.execute(tx);
  }

  async insertAuditEvent(tx: Tx, event: AuditEventRow): Promise<void> {
    await sql`
      INSERT INTO audit_event (
        id, tenant_id, actor_type, actor_id, action, entity_type, entity_id,
        after, correlation_id, occurred_at
      ) VALUES (
        ${event.id}, ${event.tenant_id}, ${event.actor_type}, ${event.actor_id},
        ${event.action}, ${event.entity_type}, ${event.entity_id},
        ${event.after ? JSON.stringify(event.after) : null}::jsonb,
        ${event.correlation_id}, ${event.occurred_at}
      )
    `.execute(tx);
  }
}

export class InMemoryCustomerRepository implements CustomerRepository {
  readonly customers = new Map<string, CustomerRow>();
  readonly contactPoints = new Map<string, CustomerContactPointRow>();
  readonly consentRecords = new Map<string, ConsentRecordRow>();
  readonly idempotency = new Map<string, IdempotencyRow>();
  readonly outboxEvents: OutboxEventRow[] = [];
  readonly auditEvents: AuditEventRow[] = [];

  async insertCustomer(_tx: Tx, row: CustomerRow): Promise<void> {
    this.customers.set(`${row.tenant_id}:${row.id}`, { ...row });
  }

  async updateCustomer(
    _tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<Pick<CustomerRow, 'full_name' | 'home_branch_id' | 'status' | 'updated_by'>>,
  ): Promise<CustomerRow | null> {
    const key = `${tenantId}:${id}`;
    const existing = this.customers.get(key);
    if (!existing || existing.lock_version !== expectedLockVersion) {
      return null;
    }

    const updated: CustomerRow = {
      ...existing,
      full_name: updates.full_name ?? existing.full_name,
      home_branch_id: updates.home_branch_id ?? existing.home_branch_id,
      status: updates.status ?? existing.status,
      updated_by: updates.updated_by ?? existing.updated_by,
      lock_version: existing.lock_version + 1,
      updated_at: new Date(),
    };
    this.customers.set(key, updated);
    return updated;
  }

  async findCustomerById(_tx: Tx, tenantId: string, id: string): Promise<CustomerRow | null> {
    if (!tenantId || tenantId.trim() === '') {
      return null;
    }
    return this.customers.get(`${tenantId}:${id}`) ?? null;
  }

  async findCustomerByIdForUpdate(tx: Tx, tenantId: string, id: string): Promise<CustomerRow | null> {
    return this.findCustomerById(tx, tenantId, id);
  }

  async listCustomers(
    _tx: Tx,
    params: CustomerListParams,
  ): Promise<{ customers: CustomerRow[]; nextCursor: string | null }> {
    let list = Array.from(this.customers.values()).filter((c) => c.tenant_id === params.tenantId);

    if (params.partyType) {
      list = list.filter((c) => c.party_type === params.partyType);
    }
    if (params.homeBranchId) {
      list = list.filter((c) => c.home_branch_id === params.homeBranchId);
    }
    if (params.status) {
      list = list.filter((c) => c.status === params.status);
    }

    if (!params.isTenantWide) {
      list = list.filter((c) => {
        if (params.allowedBranchIds && params.allowedBranchIds.includes(c.home_branch_id)) {
          return true;
        }
        if (params.allowedOwnUserId && c.created_by === params.allowedOwnUserId) {
          return true;
        }
        if (params.allowedTeamUserIds && params.allowedTeamUserIds.includes(c.created_by)) {
          return true;
        }
        return false;
      });
    }

    // Sort descending by created_at, then id
    list.sort((a, b) => {
      const cmp = b.created_at.getTime() - a.created_at.getTime();
      if (cmp !== 0) return cmp;
      return b.id.localeCompare(a.id);
    });

    if (params.cursor) {
      try {
        const decoded = Buffer.from(params.cursor, 'base64url').toString('utf8');
        const [d, cid] = decoded.split('|');
        if (d && cid && !isNaN(new Date(d).getTime())) {
          const cursorTime = new Date(d).getTime();
          list = list.filter((c) => {
            const t = c.created_at.getTime();
            if (t < cursorTime) return true;
            if (t === cursorTime && c.id.localeCompare(cid) < 0) return true;
            return false;
          });
        } else {
          throw new Error('Invalid cursor');
        }
      } catch {
        throw AppError.of('VALIDATION_ERROR', 'Invalid pagination cursor', [
          { field: 'cursor', issue: 'INVALID_CURSOR' },
        ]);
      }
    }

    let nextCursor: string | null = null;
    if (list.length > params.limit) {
      const nextItem = list[params.limit - 1];
      if (nextItem) {
        nextCursor = Buffer.from(`${nextItem.created_at.toISOString()}|${nextItem.id}`).toString('base64url');
      }
      list = list.slice(0, params.limit);
    }

    return { customers: list, nextCursor };
  }

  async insertContactPoint(_tx: Tx, row: CustomerContactPointRow): Promise<void> {
    this.contactPoints.set(`${row.tenant_id}:${row.id}`, { ...row });
  }

  async findPrimaryContactPoints(
    _tx: Tx,
    tenantId: string,
    customerId: string,
  ): Promise<{ mobile?: string | null; email?: string | null }> {
    if (!tenantId || tenantId.trim() === '') {
      return { mobile: null, email: null };
    }
    let mobile: string | null = null;
    let email: string | null = null;

    for (const cp of this.contactPoints.values()) {
      if (cp.tenant_id === tenantId && cp.customer_id === customerId && cp.is_primary) {
        if (cp.kind === 'MOBILE') mobile = cp.value;
        if (cp.kind === 'EMAIL') email = cp.value;
      }
    }
    return { mobile, email };
  }

  async insertConsentRecord(_tx: Tx, row: ConsentRecordRow): Promise<void> {
    this.consentRecords.set(`${row.tenant_id}:${row.id}`, { ...row });
  }

  async findConsentById(_tx: Tx, tenantId: string, id: string): Promise<ConsentRecordRow | null> {
    if (!tenantId || tenantId.trim() === '') {
      return null;
    }
    return this.consentRecords.get(`${tenantId}:${id}`) ?? null;
  }

  async findActiveConsent(
    _tx: Tx,
    tenantId: string,
    subjectType: 'CUSTOMER' | 'LEAD',
    subjectId: string,
    purpose: ConsentPurpose,
    purposeTarget?: string | null,
  ): Promise<ConsentRecordRow | null> {
    if (!tenantId || tenantId.trim() === '') {
      return null;
    }
    for (const cr of this.consentRecords.values()) {
      if (
        cr.tenant_id === tenantId &&
        cr.subject_type === subjectType &&
        cr.subject_id === subjectId &&
        cr.purpose === purpose &&
        cr.status === 'ACTIVE'
      ) {
        if (purposeTarget === undefined || purposeTarget === null || cr.purpose_target === purposeTarget) {
          return cr;
        }
      }
    }
    return null;
  }

  async findActiveLeadConsentByCustomerId(
    _tx: Tx,
    tenantId: string,
    customerId: string,
    purpose: ConsentPurpose,
    purposeTarget?: string | null,
  ): Promise<ConsentRecordRow | null> {
    if (!tenantId || tenantId.trim() === '') {
      return null;
    }
    for (const cr of this.consentRecords.values()) {
      if (
        cr.tenant_id === tenantId &&
        cr.subject_type === 'LEAD' &&
        cr.purpose === purpose &&
        cr.status === 'ACTIVE'
      ) {
        if (purposeTarget === undefined || purposeTarget === null || cr.purpose_target === purposeTarget) {
          return cr;
        }
      }
    }
    return null;
  }

  async listConsentsBySubject(
    _tx: Tx,
    tenantId: string,
    subjectType: 'CUSTOMER' | 'LEAD',
    subjectId: string,
  ): Promise<ConsentRecordRow[]> {
    if (!tenantId || tenantId.trim() === '') {
      return [];
    }
    return Array.from(this.consentRecords.values())
      .filter((c) => c.tenant_id === tenantId && c.subject_type === subjectType && c.subject_id === subjectId)
      .sort((a, b) => b.captured_at.getTime() - a.captured_at.getTime());
  }

  async withdrawConsent(
    _tx: Tx,
    tenantId: string,
    id: string,
    withdrawnAt: Date,
    withdrawnBy: string,
    reason?: string | null,
  ): Promise<ConsentRecordRow | null> {
    if (!tenantId || tenantId.trim() === '') {
      return null;
    }
    const key = `${tenantId}:${id}`;
    const existing = this.consentRecords.get(key);
    if (!existing || existing.status !== 'ACTIVE') {
      return null;
    }

    const updated: ConsentRecordRow = {
      ...existing,
      status: 'WITHDRAWN',
      withdrawn_at: withdrawnAt,
      withdrawn_by: withdrawnBy,
      withdrawal_reason: reason ?? null,
    };
    this.consentRecords.set(key, updated);
    return updated;
  }

  async getIdempotency(
    _tx: Tx,
    tenantId: string,
    principalId: string,
    key: string,
  ): Promise<IdempotencyRow | null> {
    return this.idempotency.get(`${tenantId}:${principalId}:${key}`) ?? null;
  }

  async saveIdempotency(_tx: Tx, row: IdempotencyRow): Promise<void> {
    this.idempotency.set(`${row.tenant_id}:${row.principal_id}:${row.key}`, { ...row });
  }

  async insertOutboxEvent(_tx: Tx, event: OutboxEventRow): Promise<void> {
    this.outboxEvents.push({ ...event });
  }

  async insertAuditEvent(_tx: Tx, event: AuditEventRow): Promise<void> {
    this.auditEvents.push({ ...event });
  }
}
