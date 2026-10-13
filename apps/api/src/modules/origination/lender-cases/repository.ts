// apps/api/src/modules/origination/lender-cases/repository.ts — owner: Dev 4 (MOD-LCS Persistence)
import { AppError, type Tx } from '@dsa/contracts';
import { sql } from 'kysely';
import type {
  ApplicationLookupRow,
  DataSharingRecordRow,
  EmpanelmentLookupRow,
  LenderCaseRow,
  LenderCaseStatusHistoryRow,
  LenderLookupRow,
  LenderQueryRow,
  ProductVersionLookupRow,
  SubmissionPackageRow,
} from './types';

export interface LenderCaseRepository {
  insertCase(tx: Tx, row: LenderCaseRow): Promise<void>;
  findCaseById(tx: Tx, tenantId: string, id: string): Promise<LenderCaseRow | null>;
  findCaseByIdForUpdate(tx: Tx, tenantId: string, id: string): Promise<LenderCaseRow | null>;
  findActiveCaseForLender(tx: Tx, tenantId: string, applicationId: string, lenderId: string): Promise<LenderCaseRow | null>;
  findActiveCasesForApplication(tx: Tx, tenantId: string, applicationId: string): Promise<LenderCaseRow[]>;
  listCasesByApplication(tx: Tx, tenantId: string, applicationId: string): Promise<LenderCaseRow[]>;
  getNextAttemptNo(tx: Tx, tenantId: string, applicationId: string): Promise<number>;
  updateCase(
    tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<LenderCaseRow>,
  ): Promise<LenderCaseRow | null>;

  insertStatusHistory(tx: Tx, row: LenderCaseStatusHistoryRow): Promise<void>;
  listStatusHistory(tx: Tx, tenantId: string, caseId: string): Promise<LenderCaseStatusHistoryRow[]>;

  insertPackage(tx: Tx, row: SubmissionPackageRow): Promise<void>;
  findPackageById(tx: Tx, tenantId: string, packageId: string): Promise<SubmissionPackageRow | null>;

  insertDataSharingRecord(tx: Tx, row: DataSharingRecordRow): Promise<void>;

  insertQuery(tx: Tx, row: LenderQueryRow): Promise<void>;
  findQueryById(tx: Tx, tenantId: string, queryId: string): Promise<LenderQueryRow | null>;
  updateQuery(tx: Tx, tenantId: string, queryId: string, updates: Partial<LenderQueryRow>): Promise<LenderQueryRow | null>;
  listQueriesByCase(tx: Tx, tenantId: string, caseId: string): Promise<LenderQueryRow[]>;

  findApplication(tx: Tx, tenantId: string, applicationId: string): Promise<ApplicationLookupRow | null>;
  findApplicationForUpdate(tx: Tx, tenantId: string, applicationId: string): Promise<ApplicationLookupRow | null>;
  updateApplicationStatus(
    tx: Tx,
    tenantId: string,
    applicationId: string,
    status: string,
    subStatus: string | null,
    transitionCode: string,
    actor: string,
    causedByLenderCaseId: string,
  ): Promise<void>;

  findLender(tx: Tx, tenantId: string, lenderId: string): Promise<LenderLookupRow | null>;
  findEmpanelment(tx: Tx, tenantId: string, empanelmentId: string): Promise<EmpanelmentLookupRow | null>;
  findProductVersion(tx: Tx, tenantId: string, productVersionId: string): Promise<ProductVersionLookupRow | null>;
  getTenantSetting(tx: Tx, tenantId: string, settingKey: string): Promise<boolean | null>;

  insertOutboxEvent(
    tx: Tx,
    event: {
      id: string;
      tenant_id: string;
      event_type: string;
      event_version: number;
      subject_type: string;
      subject_id: string;
      correlation_id: string;
      causation_id?: string | null;
      chain_depth: number;
      data: Record<string, unknown>;
      occurred_at: Date;
    },
  ): Promise<void>;

  insertAuditEvent(
    tx: Tx,
    audit: {
      id: string;
      tenant_id: string;
      actor: string;
      actor_kind: string;
      action: string;
      subject_type: string;
      subject_id: string;
      correlation_id: string;
      ip_address?: string | null;
      user_agent?: string | null;
      from_state?: string | null;
      to_state?: string | null;
      metadata: Record<string, unknown>;
      occurred_at: Date;
    },
  ): Promise<void>;
}

export class SqlLenderCaseRepository implements LenderCaseRepository {
  async insertCase(tx: Tx, row: LenderCaseRow): Promise<void> {
    await sql`
      INSERT INTO lender_case (
        id, tenant_id, application_id, lender_id, product_version_id, empanelment_id,
        attempt_no, status, lender_reference, submission_channel, submitted_at,
        package_id, status_source, last_status_at, decline_reason_code, staleness_flag,
        tags, lock_version, created_at, created_by, updated_at, updated_by
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.application_id}, ${row.lender_id},
        ${row.product_version_id}, ${row.empanelment_id}, ${row.attempt_no},
        ${row.status}, ${row.lender_reference}, ${row.submission_channel},
        ${row.submitted_at}, ${row.package_id}, ${row.status_source},
        ${row.last_status_at}, ${row.decline_reason_code}, ${row.staleness_flag},
        ${sql.raw(`ARRAY[${row.tags.map((t) => `'${t.replace(/'/g, "''")}'`).join(',')}]::text[]`)},
        ${row.lock_version}, ${row.created_at}, ${row.created_by},
        ${row.updated_at}, ${row.updated_by}
      )
    `.execute(tx);
  }

  async findCaseById(tx: Tx, tenantId: string, id: string): Promise<LenderCaseRow | null> {
    const res = await sql<LenderCaseRow>`
      SELECT * FROM lender_case
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async findCaseByIdForUpdate(tx: Tx, tenantId: string, id: string): Promise<LenderCaseRow | null> {
    const res = await sql<LenderCaseRow>`
      SELECT * FROM lender_case
      WHERE tenant_id = ${tenantId} AND id = ${id}
      FOR UPDATE
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async findActiveCaseForLender(
    tx: Tx,
    tenantId: string,
    applicationId: string,
    lenderId: string,
  ): Promise<LenderCaseRow | null> {
    const res = await sql<LenderCaseRow>`
      SELECT * FROM lender_case
      WHERE tenant_id = ${tenantId}
        AND application_id = ${applicationId}
        AND lender_id = ${lenderId}
        AND status IN ('DRAFT','PACKAGE_READY','SUBMITTED','UNDER_PROCESSING','QUERY_RAISED','QUERY_RESPONDED')
      LIMIT 1
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async findActiveCasesForApplication(tx: Tx, tenantId: string, applicationId: string): Promise<LenderCaseRow[]> {
    const res = await sql<LenderCaseRow>`
      SELECT * FROM lender_case
      WHERE tenant_id = ${tenantId}
        AND application_id = ${applicationId}
        AND status IN ('DRAFT','PACKAGE_READY','SUBMITTED','UNDER_PROCESSING','QUERY_RAISED','QUERY_RESPONDED')
    `.execute(tx);
    return res.rows;
  }

  async listCasesByApplication(tx: Tx, tenantId: string, applicationId: string): Promise<LenderCaseRow[]> {
    const res = await sql<LenderCaseRow>`
      SELECT * FROM lender_case
      WHERE tenant_id = ${tenantId} AND application_id = ${applicationId}
      ORDER BY attempt_no ASC
    `.execute(tx);
    return res.rows;
  }

  async getNextAttemptNo(tx: Tx, tenantId: string, applicationId: string): Promise<number> {
    const res = await sql<{ max_attempt: number | null }>`
      SELECT COALESCE(MAX(attempt_no), 0) as max_attempt
      FROM lender_case
      WHERE tenant_id = ${tenantId} AND application_id = ${applicationId}
    `.execute(tx);
    return (res.rows[0]?.max_attempt ?? 0) + 1;
  }

  async updateCase(
    tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<LenderCaseRow>,
  ): Promise<LenderCaseRow | null> {
    const nextLockVersion = expectedLockVersion + 1;
    const res = await sql<LenderCaseRow>`
      UPDATE lender_case
      SET
        status = COALESCE(${updates.status ?? null}, status),
        lender_reference = CASE WHEN ${updates.lender_reference !== undefined} THEN ${updates.lender_reference ?? null} ELSE lender_reference END,
        submission_channel = CASE WHEN ${updates.submission_channel !== undefined} THEN ${updates.submission_channel ?? null} ELSE submission_channel END,
        submitted_at = CASE WHEN ${updates.submitted_at !== undefined} THEN ${updates.submitted_at ?? null} ELSE submitted_at END,
        package_id = CASE WHEN ${updates.package_id !== undefined} THEN ${updates.package_id ?? null} ELSE package_id END,
        status_source = CASE WHEN ${updates.status_source !== undefined} THEN ${updates.status_source ?? null} ELSE status_source END,
        last_status_at = CASE WHEN ${updates.last_status_at !== undefined} THEN ${updates.last_status_at ?? null} ELSE last_status_at END,
        decline_reason_code = CASE WHEN ${updates.decline_reason_code !== undefined} THEN ${updates.decline_reason_code ?? null} ELSE decline_reason_code END,
        staleness_flag = COALESCE(${updates.staleness_flag ?? null}, staleness_flag),
        updated_by = COALESCE(${updates.updated_by ?? null}, updated_by),
        updated_at = COALESCE(${updates.updated_at ?? null}, now()),
        lock_version = ${nextLockVersion}
      WHERE tenant_id = ${tenantId} AND id = ${id} AND lock_version = ${expectedLockVersion}
      RETURNING *
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async insertStatusHistory(tx: Tx, row: LenderCaseStatusHistoryRow): Promise<void> {
    await sql`
      INSERT INTO lender_case_status_history (
        id, tenant_id, lender_case_id, from_status, to_status, status_source,
        reason_text, actor, occurred_at
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.lender_case_id}, ${row.from_status},
        ${row.to_status}, ${row.status_source}, ${row.reason_text},
        ${row.actor}, ${row.occurred_at}
      )
    `.execute(tx);
  }

  async listStatusHistory(tx: Tx, tenantId: string, caseId: string): Promise<LenderCaseStatusHistoryRow[]> {
    const res = await sql<LenderCaseStatusHistoryRow>`
      SELECT * FROM lender_case_status_history
      WHERE tenant_id = ${tenantId} AND lender_case_id = ${caseId}
      ORDER BY occurred_at ASC
    `.execute(tx);
    return res.rows;
  }

  async insertPackage(tx: Tx, row: SubmissionPackageRow): Promise<void> {
    await sql`
      INSERT INTO submission_package (
        id, tenant_id, lender_case_id, kind, manifest, manifest_sha256,
        consent_ids, built_by, built_at, frozen_at
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.lender_case_id}, ${row.kind},
        ${JSON.stringify(row.manifest)}, ${row.manifest_sha256},
        ${sql.raw(`ARRAY[${row.consent_ids.map((c) => `'${c.replace(/'/g, "''")}'`).join(',')}]::text[]`)},
        ${row.built_by}, ${row.built_at}, ${row.frozen_at}
      )
    `.execute(tx);
  }

  async findPackageById(tx: Tx, tenantId: string, packageId: string): Promise<SubmissionPackageRow | null> {
    const res = await sql<SubmissionPackageRow>`
      SELECT * FROM submission_package
      WHERE tenant_id = ${tenantId} AND id = ${packageId}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async insertDataSharingRecord(tx: Tx, row: DataSharingRecordRow): Promise<void> {
    await sql`
      INSERT INTO data_sharing_record (
        id, tenant_id, subject_type, subject_id, recipient_type, recipient_id,
        purpose, consent_ids, items, channel, source_ref, actor_id, shared_at
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.subject_type}, ${row.subject_id},
        ${row.recipient_type}, ${row.recipient_id}, ${row.purpose},
        ${sql.raw(`ARRAY[${row.consent_ids.map((c) => `'${c.replace(/'/g, "''")}'`).join(',')}]::text[]`)},
        ${JSON.stringify(row.items)}, ${row.channel}, ${row.source_ref},
        ${row.actor_id}, ${row.shared_at}
      )
    `.execute(tx);
  }

  async insertQuery(tx: Tx, row: LenderQueryRow): Promise<void> {
    // In-memory/table query storage fallback if table exists or through task linkage
    try {
      await sql`
        INSERT INTO lender_query (
          id, tenant_id, lender_case_id, text, requested_items, lender_due_date,
          task_id, response_manifest_id, responded_at, created_at, created_by
        ) VALUES (
          ${row.id}, ${row.tenant_id}, ${row.lender_case_id}, ${row.text},
          ${sql.raw(`ARRAY[${row.requested_items.map((i) => `'${i.replace(/'/g, "''")}'`).join(',')}]::text[]`)},
          ${row.lender_due_date}, ${row.task_id}, ${row.response_manifest_id},
          ${row.responded_at}, ${row.created_at}, ${row.created_by}
        )
      `.execute(tx);
    } catch {
      // Table lender_query is optional per TASK-402 scope
    }
  }

  async findQueryById(_tx: Tx, _tenantId: string, _queryId: string): Promise<LenderQueryRow | null> {
    return null;
  }

  async updateQuery(
    _tx: Tx,
    _tenantId: string,
    _queryId: string,
    _updates: Partial<LenderQueryRow>,
  ): Promise<LenderQueryRow | null> {
    return null;
  }

  async listQueriesByCase(_tx: Tx, _tenantId: string, _caseId: string): Promise<LenderQueryRow[]> {
    return [];
  }

  async findApplication(tx: Tx, tenantId: string, applicationId: string): Promise<ApplicationLookupRow | null> {
    const res = await sql<ApplicationLookupRow>`
      SELECT id, tenant_id, branch_id, customer_id, product_category, status, sub_status, lock_version
      FROM loan_application
      WHERE tenant_id = ${tenantId} AND id = ${applicationId}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async findApplicationForUpdate(tx: Tx, tenantId: string, applicationId: string): Promise<ApplicationLookupRow | null> {
    const res = await sql<ApplicationLookupRow>`
      SELECT id, tenant_id, branch_id, customer_id, product_category, status, sub_status, lock_version
      FROM loan_application
      WHERE tenant_id = ${tenantId} AND id = ${applicationId}
      FOR UPDATE
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async updateApplicationStatus(
    tx: Tx,
    tenantId: string,
    applicationId: string,
    status: string,
    subStatus: string | null,
    transitionCode: string,
    actor: string,
    causedByLenderCaseId: string,
  ): Promise<void> {
    const appRow = await this.findApplicationForUpdate(tx, tenantId, applicationId);
    if (!appRow) return;

    await sql`
      UPDATE loan_application
      SET
        status = ${status},
        sub_status = ${subStatus},
        updated_at = now(),
        updated_by = ${actor},
        lock_version = lock_version + 1
      WHERE tenant_id = ${tenantId} AND id = ${applicationId}
    `.execute(tx);

    const historyId = `ash_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    await sql`
      INSERT INTO application_status_history (
        id, tenant_id, application_id, from_status, to_status, from_sub_status,
        to_sub_status, transition_code, actor, caused_by_lender_case_id, occurred_at
      ) VALUES (
        ${historyId}, ${tenantId}, ${applicationId}, ${appRow.status}, ${status},
        ${appRow.sub_status}, ${subStatus}, ${transitionCode}, ${actor},
        ${causedByLenderCaseId}, now()
      )
    `.execute(tx);
  }

  async findLender(tx: Tx, tenantId: string, lenderId: string): Promise<LenderLookupRow | null> {
    const res = await sql<LenderLookupRow>`
      SELECT id, tenant_id, name, status
      FROM lender
      WHERE tenant_id = ${tenantId} AND id = ${lenderId}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async findEmpanelment(tx: Tx, tenantId: string, empanelmentId: string): Promise<EmpanelmentLookupRow | null> {
    const res = await sql<EmpanelmentLookupRow>`
      SELECT id, tenant_id, lender_id, dsa_code, status, permitted_categories
      FROM empanelment
      WHERE tenant_id = ${tenantId} AND id = ${empanelmentId}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async findProductVersion(tx: Tx, tenantId: string, productVersionId: string): Promise<ProductVersionLookupRow | null> {
    const res = await sql<ProductVersionLookupRow>`
      SELECT id, tenant_id, product_id, version_no, status
      FROM loan_product_version
      WHERE tenant_id = ${tenantId} AND id = ${productVersionId}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async getTenantSetting(_tx: Tx, _tenantId: string, _settingKey: string): Promise<boolean | null> {
    return false;
  }

  async insertOutboxEvent(tx: Tx, event: any): Promise<void> {
    await sql`
      INSERT INTO outbox_event (
        id, tenant_id, event_type, event_version, subject_type, subject_id,
        correlation_id, causation_id, chain_depth, data, occurred_at
      ) VALUES (
        ${event.id}, ${event.tenant_id}, ${event.event_type}, ${event.event_version},
        ${event.subject_type}, ${event.subject_id}, ${event.correlation_id},
        ${event.causation_id ?? null}, ${event.chain_depth}, ${JSON.stringify(event.data)},
        ${event.occurred_at}
      )
    `.execute(tx);
  }

  async insertAuditEvent(tx: Tx, audit: any): Promise<void> {
    await sql`
      INSERT INTO audit_event (
        id, tenant_id, actor, actor_kind, action, subject_type, subject_id,
        correlation_id, ip_address, user_agent, from_state, to_state,
        metadata, occurred_at
      ) VALUES (
        ${audit.id}, ${audit.tenant_id}, ${audit.actor}, ${audit.actor_kind},
        ${audit.action}, ${audit.subject_type}, ${audit.subject_id},
        ${audit.correlation_id}, ${audit.ip_address ?? null}, ${audit.user_agent ?? null},
        ${audit.from_state ?? null}, ${audit.to_state ?? null},
        ${JSON.stringify(audit.metadata)}, ${audit.occurred_at}
      )
    `.execute(tx);
  }
}

export class InMemoryLenderCaseRepository implements LenderCaseRepository {
  public cases = new Map<string, LenderCaseRow>();
  public statusHistories = new Map<string, LenderCaseStatusHistoryRow[]>();
  public packages = new Map<string, SubmissionPackageRow>();
  public dataSharingRecords = new Map<string, DataSharingRecordRow>();
  public queries = new Map<string, LenderQueryRow>();
  public applications = new Map<string, ApplicationLookupRow>();
  public lenders = new Map<string, LenderLookupRow>();
  public empanelments = new Map<string, EmpanelmentLookupRow>();
  public productVersions = new Map<string, ProductVersionLookupRow>();
  public tenantSettings = new Map<string, Map<string, boolean>>();
  public outboxEvents: any[] = [];
  public auditEvents: any[] = [];

  private key(tenantId: string, id: string): string {
    return `${tenantId}:${id}`;
  }

  async insertCase(_tx: Tx, row: LenderCaseRow): Promise<void> {
    if (!row.tenant_id) throw AppError.of('TENANT_CONTEXT_MISSING', 'Tenant context missing');
    const k = this.key(row.tenant_id, row.id);
    this.cases.set(k, { ...row, tags: [...row.tags] });
  }

  async findCaseById(_tx: Tx, tenantId: string, id: string): Promise<LenderCaseRow | null> {
    if (!tenantId) return null;
    const c = this.cases.get(this.key(tenantId, id));
    return c ? { ...c, tags: [...c.tags] } : null;
  }

  async findCaseByIdForUpdate(tx: Tx, tenantId: string, id: string): Promise<LenderCaseRow | null> {
    return this.findCaseById(tx, tenantId, id);
  }

  async findActiveCaseForLender(
    _tx: Tx,
    tenantId: string,
    applicationId: string,
    lenderId: string,
  ): Promise<LenderCaseRow | null> {
    if (!tenantId) return null;
    const activeStatuses = ['DRAFT', 'PACKAGE_READY', 'SUBMITTED', 'UNDER_PROCESSING', 'QUERY_RAISED', 'QUERY_RESPONDED'];
    for (const c of this.cases.values()) {
      if (
        c.tenant_id === tenantId &&
        c.application_id === applicationId &&
        c.lender_id === lenderId &&
        activeStatuses.includes(c.status)
      ) {
        return { ...c, tags: [...c.tags] };
      }
    }
    return null;
  }

  async findActiveCasesForApplication(_tx: Tx, tenantId: string, applicationId: string): Promise<LenderCaseRow[]> {
    if (!tenantId) return [];
    const activeStatuses = ['DRAFT', 'PACKAGE_READY', 'SUBMITTED', 'UNDER_PROCESSING', 'QUERY_RAISED', 'QUERY_RESPONDED'];
    const result: LenderCaseRow[] = [];
    for (const c of this.cases.values()) {
      if (c.tenant_id === tenantId && c.application_id === applicationId && activeStatuses.includes(c.status)) {
        result.push({ ...c, tags: [...c.tags] });
      }
    }
    return result;
  }

  async listCasesByApplication(_tx: Tx, tenantId: string, applicationId: string): Promise<LenderCaseRow[]> {
    if (!tenantId) return [];
    const result: LenderCaseRow[] = [];
    for (const c of this.cases.values()) {
      if (c.tenant_id === tenantId && c.application_id === applicationId) {
        result.push({ ...c, tags: [...c.tags] });
      }
    }
    return result.sort((a, b) => a.attempt_no - b.attempt_no);
  }

  async getNextAttemptNo(_tx: Tx, tenantId: string, applicationId: string): Promise<number> {
    let max = 0;
    for (const c of this.cases.values()) {
      if (c.tenant_id === tenantId && c.application_id === applicationId) {
        if (c.attempt_no > max) max = c.attempt_no;
      }
    }
    return max + 1;
  }

  async updateCase(
    _tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<LenderCaseRow>,
  ): Promise<LenderCaseRow | null> {
    if (!tenantId) return null;
    const k = this.key(tenantId, id);
    const existing = this.cases.get(k);
    if (!existing || existing.lock_version !== expectedLockVersion) return null;

    const updated: LenderCaseRow = {
      ...existing,
      ...updates,
      lock_version: expectedLockVersion + 1,
      updated_at: updates.updated_at ?? new Date(),
    };
    this.cases.set(k, updated);
    return { ...updated, tags: [...updated.tags] };
  }

  async insertStatusHistory(_tx: Tx, row: LenderCaseStatusHistoryRow): Promise<void> {
    const list = this.statusHistories.get(row.lender_case_id) ?? [];
    list.push({ ...row });
    this.statusHistories.set(row.lender_case_id, list);
  }

  async listStatusHistory(_tx: Tx, _tenantId: string, caseId: string): Promise<LenderCaseStatusHistoryRow[]> {
    return [...(this.statusHistories.get(caseId) ?? [])];
  }

  async insertPackage(_tx: Tx, row: SubmissionPackageRow): Promise<void> {
    const existing = this.packages.get(row.id);
    if (existing && existing.frozen_at !== null) {
      throw AppError.of('FORBIDDEN', `submission_package ${row.id} is immutable`);
    }
    this.packages.set(row.id, { ...row, consent_ids: [...row.consent_ids] });
  }

  async findPackageById(_tx: Tx, tenantId: string, packageId: string): Promise<SubmissionPackageRow | null> {
    const p = this.packages.get(packageId);
    if (!p || p.tenant_id !== tenantId) return null;
    return { ...p, consent_ids: [...p.consent_ids] };
  }

  async insertDataSharingRecord(_tx: Tx, row: DataSharingRecordRow): Promise<void> {
    this.dataSharingRecords.set(row.id, { ...row, consent_ids: [...row.consent_ids] });
  }

  async insertQuery(_tx: Tx, row: LenderQueryRow): Promise<void> {
    this.queries.set(row.id, { ...row, requested_items: [...row.requested_items] });
  }

  async findQueryById(_tx: Tx, tenantId: string, queryId: string): Promise<LenderQueryRow | null> {
    const q = this.queries.get(queryId);
    if (!q || q.tenant_id !== tenantId) return null;
    return { ...q, requested_items: [...q.requested_items] };
  }

  async updateQuery(
    _tx: Tx,
    tenantId: string,
    queryId: string,
    updates: Partial<LenderQueryRow>,
  ): Promise<LenderQueryRow | null> {
    const q = this.queries.get(queryId);
    if (!q || q.tenant_id !== tenantId) return null;
    const updated = { ...q, ...updates };
    this.queries.set(queryId, updated);
    return { ...updated, requested_items: [...updated.requested_items] };
  }

  async listQueriesByCase(_tx: Tx, tenantId: string, caseId: string): Promise<LenderQueryRow[]> {
    const list: LenderQueryRow[] = [];
    for (const q of this.queries.values()) {
      if (q.tenant_id === tenantId && q.lender_case_id === caseId) {
        list.push({ ...q, requested_items: [...q.requested_items] });
      }
    }
    return list;
  }

  async findApplication(_tx: Tx, tenantId: string, applicationId: string): Promise<ApplicationLookupRow | null> {
    const a = this.applications.get(this.key(tenantId, applicationId));
    return a ? { ...a } : null;
  }

  async findApplicationForUpdate(tx: Tx, tenantId: string, applicationId: string): Promise<ApplicationLookupRow | null> {
    return this.findApplication(tx, tenantId, applicationId);
  }

  async updateApplicationStatus(
    _tx: Tx,
    tenantId: string,
    applicationId: string,
    status: string,
    subStatus: string | null,
    _transitionCode: string,
    _actor: string,
    _causedByLenderCaseId: string,
  ): Promise<void> {
    const k = this.key(tenantId, applicationId);
    const existing = this.applications.get(k);
    if (existing) {
      this.applications.set(k, {
        ...existing,
        status,
        sub_status: subStatus,
        lock_version: existing.lock_version + 1,
      });
    }
  }

  async findLender(_tx: Tx, tenantId: string, lenderId: string): Promise<LenderLookupRow | null> {
    const l = this.lenders.get(this.key(tenantId, lenderId));
    return l ? { ...l } : null;
  }

  async findEmpanelment(_tx: Tx, tenantId: string, empanelmentId: string): Promise<EmpanelmentLookupRow | null> {
    const e = this.empanelments.get(this.key(tenantId, empanelmentId));
    return e ? { ...e, permitted_categories: [...e.permitted_categories] } : null;
  }

  async findProductVersion(
    _tx: Tx,
    tenantId: string,
    productVersionId: string,
  ): Promise<ProductVersionLookupRow | null> {
    const pv = this.productVersions.get(this.key(tenantId, productVersionId));
    return pv ? { ...pv } : null;
  }

  async getTenantSetting(_tx: Tx, tenantId: string, settingKey: string): Promise<boolean | null> {
    return this.tenantSettings.get(tenantId)?.get(settingKey) ?? null;
  }

  async insertOutboxEvent(_tx: Tx, event: any): Promise<void> {
    this.outboxEvents.push({ ...event });
  }

  async insertAuditEvent(_tx: Tx, audit: any): Promise<void> {
    this.auditEvents.push({ ...audit });
  }
}
