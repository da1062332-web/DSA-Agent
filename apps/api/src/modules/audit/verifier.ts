// apps/api/src/modules/audit/verifier.ts — Module 37: Audit (MOD-AUD)
// Audit chain verifier: checks prev_hash links, recomputes SHA-256 hashes, detects tampering & gaps.
import { sql } from 'kysely';
import type { Tx, AuditChainVerificationResponse } from '@dsa/contracts';
import { computeEventHash, GENESIS_PREV_HASH } from './canonical';
import type { AuditEventRow } from './types';

export async function verifyTenantAuditChain(
  tx: Tx,
  tenantId: string,
): Promise<AuditChainVerificationResponse> {
  const allEventsRes = await sql<AuditEventRow>`
    SELECT * FROM app.audit_event
    WHERE tenant_id = ${tenantId}
    ORDER BY seq ASC, occurred_at ASC, id ASC
  `.execute(tx);

  const totalEvents = allEventsRes.rows.length;
  if (totalEvents === 0) {
    return {
      status: 'EMPTY',
      tenantId,
      totalEvents: 0,
      sealedEvents: 0,
      unsealedEvents: 0,
      verifiedRange: null,
      verifiedAt: new Date().toISOString(),
      details: 'No audit events found for tenant.',
    };
  }

  let sealedCount = 0;
  let unsealedCount = 0;
  let expectedPrevHash = GENESIS_PREV_HASH;
  let genesisHash: string | null = null;
  let latestHash: string | null = null;
  let firstSeq: number | null = null;
  let lastSeq: number | null = null;

  const tampered: Array<{ seq: number; id: string; reason: string }> = [];
  let brokenChain = false;

  for (let i = 0; i < allEventsRes.rows.length; i++) {
    const row = allEventsRes.rows[i]!;
    const seq = Number(row.seq);

    if (row.hash === null) {
      unsealedCount++;
      continue;
    }

    sealedCount++;
    if (firstSeq === null) {
      firstSeq = seq;
    } else if (lastSeq !== null && seq <= lastSeq) {
      brokenChain = true;
      tampered.push({
        seq,
        id: row.id,
        reason: `Sequence order violation: sequence ${seq} is not greater than preceding ${lastSeq}`,
      });
    } else if (lastSeq !== null && seq !== lastSeq + 1) {
      brokenChain = true;
      tampered.push({
        seq,
        id: row.id,
        reason: `Sequence gap detected: expected ${lastSeq + 1}, found ${seq}`,
      });
    }

    lastSeq = seq;
    if (genesisHash === null) genesisHash = row.hash;
    latestHash = row.hash;

    // Check prev_hash continuity
    if (row.prev_hash !== expectedPrevHash) {
      brokenChain = true;
      tampered.push({
        seq,
        id: row.id,
        reason: `Previous hash mismatch: expected ${expectedPrevHash}, found ${row.prev_hash}`,
      });
    }

    // Recompute event hash from canonical representation
    const occurredAtIso =
      row.occurred_at instanceof Date
        ? row.occurred_at.toISOString()
        : new Date(row.occurred_at).toISOString();

    const canonicalData = {
      id: row.id,
      tenantId: row.tenant_id,
      seq,
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

    const recomputedHash = computeEventHash(row.prev_hash ?? GENESIS_PREV_HASH, canonicalData);
    if (recomputedHash !== row.hash) {
      tampered.push({
        seq,
        id: row.id,
        reason: `Hash mismatch: recomputed ${recomputedHash}, stored ${row.hash}`,
      });
    }

    expectedPrevHash = row.hash;
  }

  let status: AuditChainVerificationResponse['status'] = 'VERIFIED';
  let details = `Successfully verified ${sealedCount} sealed events in hash chain.`;

  if (tampered.length > 0) {
    status = brokenChain ? 'BROKEN_CHAIN' : 'TAMPERED';
    details = `Detected ${tampered.length} verification anomalies in chain.`;
  } else if (unsealedCount > 0) {
    status = 'INCOMPLETE';
    details = `Chain has ${unsealedCount} unsealed events pending daily/manual sealing job. ${sealedCount} sealed events verified.`;
  }

  return {
    status,
    tenantId,
    totalEvents,
    sealedEvents: sealedCount,
    unsealedEvents: unsealedCount,
    verifiedRange:
      sealedCount > 0
        ? {
            fromSeq: firstSeq,
            toSeq: lastSeq,
            genesisHash,
            latestHash,
          }
        : null,
    tamperedEvents: tampered.length > 0 ? tampered : undefined,
    verifiedAt: new Date().toISOString(),
    details,
  };
}
