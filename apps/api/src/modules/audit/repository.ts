// apps/api/src/modules/audit/repository.ts — Module 37: Audit (MOD-AUD)
import { sql } from 'kysely';
import type { Tx, AuditSearchQuery, CreateEvidencePackRequest } from '@dsa/contracts';
import { decodeCursor, encodeCursor } from '../../http/request';
import type { AuditEventRow, EvidencePackRow } from './types';
import { toAuditEvent } from './types';
import { redactSensitivePayload } from '@dsa/kernel';

export interface AuditSearchResult {
  data: ReturnType<typeof toAuditEvent>[];
  meta: {
    nextCursor: string | null;
    limit: number;
  };
}

export async function searchAuditEvents(
  tx: Tx,
  tenantId: string,
  query: AuditSearchQuery,
): Promise<AuditSearchResult> {
  const limit = Math.min(query.limit ?? 50, 200);

  // Parse cursor if provided
  let cursorCondition = sql``;
  if (query.cursor) {
    const decoded = decodeCursor(query.cursor);
    if (decoded) {
      cursorCondition = sql`AND (occurred_at < ${decoded.k}::timestamptz OR (occurred_at = ${decoded.k}::timestamptz AND id < ${decoded.id}))`;
    }
  }

  const actorTypeCond = query.actorType ? sql`AND actor_type = ${query.actorType}` : sql``;
  const actorIdCond = query.actorId ? sql`AND actor_id = ${query.actorId}` : sql``;
  const actionCond = query.action ? sql`AND action = ${query.action}` : sql``;
  const entityTypeCond = query.entityType ? sql`AND entity_type = ${query.entityType}` : sql``;
  const entityIdCond = query.entityId ? sql`AND entity_id = ${query.entityId}` : sql``;
  const dateFromCond = query.dateFrom ? sql`AND occurred_at >= ${query.dateFrom}::timestamptz` : sql``;
  const dateToCond = query.dateTo ? sql`AND occurred_at <= ${query.dateTo}::timestamptz` : sql``;
  const correlationCond = query.correlationId ? sql`AND correlation_id = ${query.correlationId}` : sql``;
  const decisionCond = query.decisionRecordId
    ? sql`AND decision_record_id = ${query.decisionRecordId}`
    : sql``;

  // Fetch limit + 1 to check if there are more results
  const fetchLimit = limit + 1;

  const result = await sql<AuditEventRow>`
    SELECT * FROM app.audit_event
    WHERE tenant_id = ${tenantId}
    ${cursorCondition}
    ${actorTypeCond}
    ${actorIdCond}
    ${actionCond}
    ${entityTypeCond}
    ${entityIdCond}
    ${dateFromCond}
    ${dateToCond}
    ${correlationCond}
    ${decisionCond}
    ORDER BY occurred_at DESC, id DESC
    LIMIT ${fetchLimit}
  `.execute(tx);

  const rows = result.rows;
  const hasMore = rows.length > limit;
  const dataRows = hasMore ? rows.slice(0, limit) : rows;

  const mappedData = dataRows.map((r) => {
    const item = toAuditEvent(r);
    return {
      ...item,
      before: item.before ? (redactSensitivePayload(item.before) as Record<string, unknown>) : null,
      after: item.after ? (redactSensitivePayload(item.after) as Record<string, unknown>) : null,
    };
  });

  let nextCursor: string | null = null;
  if (hasMore && dataRows.length > 0) {
    const last = dataRows[dataRows.length - 1]!;
    const lastOccurred =
      last.occurred_at instanceof Date
        ? last.occurred_at.toISOString()
        : new Date(last.occurred_at).toISOString();
    nextCursor = encodeCursor(lastOccurred, last.id);
  }

  return {
    data: mappedData,
    meta: {
      nextCursor,
      limit,
    },
  };
}

export async function findAuditEventById(
  tx: Tx,
  tenantId: string,
  auditId: string,
): Promise<ReturnType<typeof toAuditEvent> | null> {
  const res = await sql<AuditEventRow>`
    SELECT * FROM app.audit_event
    WHERE tenant_id = ${tenantId} AND id = ${auditId}
    LIMIT 1
  `.execute(tx);

  if (!res.rows[0]) return null;
  const item = toAuditEvent(res.rows[0]);
  return {
    ...item,
    before: item.before ? (redactSensitivePayload(item.before) as Record<string, unknown>) : null,
    after: item.after ? (redactSensitivePayload(item.after) as Record<string, unknown>) : null,
  };
}

export async function findDecisionRecordById(
  tx: Tx,
  tenantId: string,
  decisionRecordId: string,
): Promise<Record<string, unknown> | null> {
  const res = await sql<Record<string, unknown>>`
    SELECT * FROM app.decision_record
    WHERE tenant_id = ${tenantId} AND id = ${decisionRecordId}
    LIMIT 1
  `.execute(tx);

  return res.rows[0] ?? null;
}

export async function createEvidencePackRow(
  tx: Tx,
  id: string,
  tenantId: string,
  requestedBy: string,
  filters: CreateEvidencePackRequest,
): Promise<EvidencePackRow> {
  const res = await sql<EvidencePackRow>`
    INSERT INTO app.evidence_pack (id, tenant_id, requested_by, status, filters)
    VALUES (${id}, ${tenantId}, ${requestedBy}, 'PENDING', ${JSON.stringify(filters)}::jsonb)
    RETURNING *
  `.execute(tx);

  return res.rows[0]!;
}

export async function updateEvidencePackStatus(
  tx: Tx,
  id: string,
  tenantId: string,
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED',
  update: {
    recordCount?: number;
    checksum?: string;
    filePath?: string;
    errorMessage?: string;
    completedAt?: Date;
    expiresAt?: Date;
  },
): Promise<void> {
  await sql`
    UPDATE app.evidence_pack
    SET status = ${status},
        record_count = COALESCE(${update.recordCount ?? null}, record_count),
        checksum = COALESCE(${update.checksum ?? null}, checksum),
        file_path = COALESCE(${update.filePath ?? null}, file_path),
        error_message = COALESCE(${update.errorMessage ?? null}, error_message),
        completed_at = COALESCE(${update.completedAt ? update.completedAt.toISOString() : null}::timestamptz, completed_at),
        expires_at = COALESCE(${update.expiresAt ? update.expiresAt.toISOString() : null}::timestamptz, expires_at)
    WHERE id = ${id} AND tenant_id = ${tenantId}
  `.execute(tx);
}

export async function findEvidencePackById(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<EvidencePackRow | null> {
  const res = await sql<EvidencePackRow>`
    SELECT * FROM app.evidence_pack
    WHERE tenant_id = ${tenantId} AND id = ${id}
    LIMIT 1
  `.execute(tx);

  return res.rows[0] ?? null;
}

export async function listEvidencePacks(tx: Tx, tenantId: string, limit = 50): Promise<EvidencePackRow[]> {
  const res = await sql<EvidencePackRow>`
    SELECT * FROM app.evidence_pack
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `.execute(tx);

  return res.rows;
}
