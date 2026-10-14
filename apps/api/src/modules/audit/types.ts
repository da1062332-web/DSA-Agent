// apps/api/src/modules/audit/types.ts — Module 37: Audit (MOD-AUD)
import type { AuditEvent } from '@dsa/contracts';

export interface AuditEventRow {
  id: string;
  tenant_id: string;
  seq: number | string;
  occurred_at: Date | string;
  actor_type: 'USER' | 'SERVICE';
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  permission_used: string | null;
  approval_ref: string | null;
  reason: string | null;
  decision_record_id: string | null;
  before: unknown;
  after: unknown;
  external_side_effect: boolean;
  correlation_id: string;
  ip: string | null;
  user_agent: string | null;
  prev_hash: string | null;
  hash: string | null;
}

export function toAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    seq: Number(row.seq),
    occurredAt:
      row.occurred_at instanceof Date
        ? row.occurred_at.toISOString()
        : new Date(row.occurred_at).toISOString(),
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    permissionUsed: row.permission_used,
    approvalRef: row.approval_ref,
    reason: row.reason,
    decisionRecordId: row.decision_record_id,
    before: (row.before as Record<string, unknown>) ?? null,
    after: (row.after as Record<string, unknown>) ?? null,
    externalSideEffect: Boolean(row.external_side_effect),
    correlationId: row.correlation_id,
    ip: row.ip,
    userAgent: row.user_agent,
    prevHash: row.prev_hash,
    hash: row.hash,
  };
}

export interface EvidencePackRow {
  id: string;
  tenant_id: string;
  requested_by: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  filters: unknown;
  record_count: number | null;
  checksum: string | null;
  file_path: string | null;
  error_message: string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
  expires_at: Date | string | null;
}
