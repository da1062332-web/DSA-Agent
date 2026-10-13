// AuditPort writer (Contracts §4.1, Doc 12 §5.2) — owner: Dev 1 — TASK-105.
// Written in the caller's transaction, so the audit row commits or rolls back with the state change.
// Callers pass masked before/after values only (never raw mobile, email, PAN or tokens).
import type { AuditPort, IdGenerator } from '@dsa/contracts';
import { sql } from 'kysely';

export function createAuditPort(ids: IdGenerator): AuditPort {
  return {
    async record(tx, ctx, e) {
      const id = ids.next('aud');
      const p = ctx.principal;
      await sql`
        insert into audit_event (id, tenant_id, actor_type, actor_id, action, entity_type, entity_id,
          permission_used, approval_ref, reason, decision_record_id, before, after, external_side_effect,
          correlation_id, ip, user_agent)
        values (${id}, ${p.tenantId}, ${p.kind}, ${p.id}, ${e.action}, ${e.entityType}, ${e.entityId},
          ${e.permissionUsed ?? null}, ${e.approvalRef ?? null}, ${e.reason ?? null}, ${e.decisionRecordId ?? null},
          ${e.before ? JSON.stringify(e.before) : null}::jsonb, ${e.after ? JSON.stringify(e.after) : null}::jsonb,
          ${e.externalSideEffect ?? false}, ${ctx.correlationId}, ${ctx.ip ?? null}::inet, ${ctx.userAgent ?? null})`.execute(
        tx,
      );
      return id;
    },
  };
}
