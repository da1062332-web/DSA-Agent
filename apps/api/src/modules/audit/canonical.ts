// apps/api/src/modules/audit/canonical.ts — Module 37: Audit (MOD-AUD)
// Canonical serialization and cryptographic hash chain functions.
import { createHash } from 'node:crypto';

export const GENESIS_PREV_HASH = '0'.repeat(64);

/**
 * Deterministically serializes any JS object/primitive to a canonical string:
 * - Object keys sorted lexicographically
 * - Undefined values stripped from objects
 * - Arrays preserve order
 * - Deterministic formatting without whitespace
 */
export function canonicalStringify(val: unknown): string {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean' || typeof val === 'number') return JSON.stringify(val);
  if (typeof val === 'string') return JSON.stringify(val);
  if (val instanceof Date) return JSON.stringify(val.toISOString());

  if (Array.isArray(val)) {
    return '[' + val.map((item) => canonicalStringify(item)).join(',') + ']';
  }

  if (typeof val === 'object') {
    const keys = Object.keys(val as Record<string, unknown>).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const v = (val as Record<string, unknown>)[key];
      if (v !== undefined) {
        parts.push(`${JSON.stringify(key)}:${canonicalStringify(v)}`);
      }
    }
    return '{' + parts.join(',') + '}';
  }

  return JSON.stringify(val);
}

export interface CanonicalAuditEventData {
  id: string;
  tenantId: string;
  seq: number;
  occurredAt: string;
  actorType: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  permissionUsed: string | null;
  approvalRef: string | null;
  reason: string | null;
  decisionRecordId: string | null;
  before: unknown;
  after: unknown;
  externalSideEffect: boolean;
  correlationId: string;
}

/**
 * Serializes the canonical fields of an audit event.
 */
export function serializeCanonicalEvent(e: CanonicalAuditEventData): string {
  const canonicalObj = {
    action: e.action,
    actorId: e.actorId,
    actorType: e.actorType,
    after: e.after ?? null,
    approvalRef: e.approvalRef ?? null,
    before: e.before ?? null,
    correlationId: e.correlationId,
    decisionRecordId: e.decisionRecordId ?? null,
    entityId: e.entityId ?? null,
    entityType: e.entityType,
    externalSideEffect: Boolean(e.externalSideEffect),
    id: e.id,
    occurredAt: typeof e.occurredAt === 'string' ? e.occurredAt : new Date(e.occurredAt).toISOString(),
    permissionUsed: e.permissionUsed ?? null,
    reason: e.reason ?? null,
    seq: Number(e.seq),
    tenantId: e.tenantId,
  };
  return canonicalStringify(canonicalObj);
}

/**
 * Computes hash = SHA-256(prev_hash || canonical_event)
 */
export function computeEventHash(prevHash: string, event: CanonicalAuditEventData): string {
  const canonicalBytes = serializeCanonicalEvent(event);
  const input = `${prevHash || GENESIS_PREV_HASH}${canonicalBytes}`;
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
