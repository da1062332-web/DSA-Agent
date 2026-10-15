// apps/api/src/modules/audit/sealer.ts — Module 37: Audit (MOD-AUD)
// Concurrency-safe, idempotent audit hash-chain sealer.
import { sql } from 'kysely';
import type { Tx } from '@dsa/contracts';
import { computeEventHash, GENESIS_PREV_HASH } from './canonical';
import type { AuditEventRow } from './types';

export interface SealResult {
  tenantId: string;
  sealedCount: number;
  lastSequence: number | null;
  latestHash: string | null;
}

/**
 * Seals unsealed audit events for a given tenant inside a transaction.
 * Uses PostgreSQL advisory transaction locking to serialize concurrent sealers per tenant.
 */
export async function sealTenantAuditChain(tx: Tx, tenantId: string): Promise<SealResult> {
  // Acquire tenant-specific advisory transaction lock to guarantee strictly sequential sealing
  await sql`SELECT pg_advisory_xact_lock(hashtext('audit_chain_seal_' || ${tenantId}))`.execute(tx);

  // 1. Find the most recently sealed event for this tenant
  const lastSealedRes = await sql<AuditEventRow>`
    SELECT * FROM app.audit_event
    WHERE tenant_id = ${tenantId} AND hash IS NOT NULL
    ORDER BY seq DESC
    LIMIT 1
  `.execute(tx);

  let currentPrevHash = lastSealedRes.rows[0]?.hash ?? GENESIS_PREV_HASH;
  let lastSeq = lastSealedRes.rows[0] ? Number(lastSealedRes.rows[0].seq) : null;

  // 2. Fetch all unsealed events for this tenant ordered by seq
  const unsealedRes = await sql<AuditEventRow>`
    SELECT * FROM app.audit_event
    WHERE tenant_id = ${tenantId} AND hash IS NULL
    ORDER BY seq ASC, occurred_at ASC, id ASC
    FOR UPDATE
  `.execute(tx);

  if (unsealedRes.rows.length === 0) {
    return {
      tenantId,
      sealedCount: 0,
      lastSequence: lastSeq,
      latestHash: currentPrevHash === GENESIS_PREV_HASH ? null : currentPrevHash,
    };
  }

  let sealedCount = 0;
  for (const row of unsealedRes.rows) {
    const occurredAtIso =
      row.occurred_at instanceof Date
        ? row.occurred_at.toISOString()
        : new Date(row.occurred_at).toISOString();

    const canonicalData = {
      id: row.id,
      tenantId: row.tenant_id,
      seq: Number(row.seq),
      occurredAt: occurredAtIso,
      actorType: row.actor_type,
      actorId: row.actor_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      permissionUsed: row.permission_used,
      approvalRef: row.approval_ref,
      reason: row.reason,
      decisionRecordId: row.decision_record_id,
      before: row.before,
      after: row.after,
      externalSideEffect: Boolean(row.external_side_effect),
      correlationId: row.correlation_id,
    };

    const computedHash = computeEventHash(currentPrevHash, canonicalData);

    // Persist computed hash and prev_hash to the audit row
    await sql`
      UPDATE app.audit_event
      SET prev_hash = ${currentPrevHash}, hash = ${computedHash}
      WHERE id = ${row.id} AND tenant_id = ${tenantId}
    `.execute(tx);

    currentPrevHash = computedHash;
    lastSeq = Number(row.seq);
    sealedCount++;
  }

  return {
    tenantId,
    sealedCount,
    lastSequence: lastSeq,
    latestHash: currentPrevHash,
  };
}
