// packages/kernel/src/audit/audit.ts — owner: Dev 1 — TASK-105 / Module 37 (MOD-AUD)
// Written in the caller's transaction, so the audit row commits or rolls back with the state change.
import type { AuditPort, IdGenerator } from '@dsa/contracts';
import { sql } from 'kysely';

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|access_token|refresh_token|auth|authorization|api_key|apikey|private_key|otp|pin|cvv|pan|aadhaar|account_number|card_number)/i;

const SENSITIVE_VALUE_PATTERNS = [
  /^[A-Z]{5}[0-9]{4}[A-Z]$/, // PAN
  /^\d{12}$/, // Aadhaar
  /^Bearer\s+/i, // Authorization header/token
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, // JWT
];

/**
 * Redacts credentials, tokens, secrets, OTPs and sensitive identity patterns
 * from audit payloads before persistence.
 */
export function redactSensitivePayload(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') {
    for (const pat of SENSITIVE_VALUE_PATTERNS) {
      if (pat.test(val.trim())) return '[REDACTED]';
    }
    return val;
  }
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  if (Array.isArray(val)) {
    return val.map(redactSensitivePayload);
  }
  if (typeof val === 'object') {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        res[k] = '[REDACTED]';
      } else {
        res[k] = redactSensitivePayload(v);
      }
    }
    return res;
  }
  return val;
}

export function createAuditPort(ids: IdGenerator): AuditPort {
  return {
    async record(tx, ctx, e) {
      const id = ids.next('aud');
      const p = ctx.principal;
      const actorType = p?.kind === 'SERVICE' ? 'SERVICE' : 'USER';
      const actorId = p?.id ?? 'system';
      const tenantId = p?.tenantId ?? 'system';

      const sanitizedBefore = e.before ? redactSensitivePayload(e.before) : null;
      const sanitizedAfter = e.after ? redactSensitivePayload(e.after) : null;

      await sql`
        insert into audit_event (id, tenant_id, actor_type, actor_id, action, entity_type, entity_id,
          permission_used, approval_ref, reason, decision_record_id, before, after, external_side_effect,
          correlation_id, ip, user_agent)
        values (${id}, ${tenantId}, ${actorType}, ${actorId}, ${e.action}, ${e.entityType}, ${e.entityId},
          ${e.permissionUsed ?? null}, ${e.approvalRef ?? null}, ${e.reason ?? null}, ${e.decisionRecordId ?? null},
          ${sanitizedBefore ? JSON.stringify(sanitizedBefore) : null}::jsonb,
          ${sanitizedAfter ? JSON.stringify(sanitizedAfter) : null}::jsonb,
          ${e.externalSideEffect ?? false}, ${ctx.correlationId}, ${ctx.ip ?? null}::inet, ${ctx.userAgent ?? null})`.execute(
        tx,
      );
      return id;
    },
  };
}
