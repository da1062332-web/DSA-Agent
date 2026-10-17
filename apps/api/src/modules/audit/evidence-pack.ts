// apps/api/src/modules/audit/evidence-pack.ts — Module 37: Audit (MOD-AUD)
// Asynchronous evidence-pack generator, bundling audit events and BRE decision records.
import { createHash } from 'node:crypto';
import type {
  TxRunner,
  RequestContext,
  CreateEvidencePackRequest,
  AuditEvent,
  AuditChainVerificationResponse,
} from '@dsa/contracts';
import { searchAuditEvents, findDecisionRecordById, updateEvidencePackStatus } from './repository';
import { verifyTenantAuditChain } from './verifier';
import { canonicalStringify } from './canonical';

export async function processEvidencePackAsync(
  runner: TxRunner,
  ctx: RequestContext,
  packId: string,
  filters: CreateEvidencePackRequest,
): Promise<void> {
  const tenantId = ctx.principal.tenantId;

  try {
    // 1. Mark as PROCESSING
    await runner.withTenantTx(ctx, async (tx) => {
      await updateEvidencePackStatus(tx, packId, tenantId, 'PROCESSING', {});
    });

    // 2. Fetch all matching audit events (up to maximum 10,000 for evidence export)
    const auditEvents: AuditEvent[] = await runner.withTenantTx(ctx, async (tx) => {
      const searchRes = await searchAuditEvents(tx, tenantId, {
        actorId: filters.actorId,
        action: filters.action,
        entityType: filters.entityType,
        entityId: filters.entityId,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        limit: 200,
      });
      return searchRes.data;
    });

    // 3. Resolve referenced decision records if requested
    const decisionRecords: Record<string, unknown>[] = [];
    if (filters.includeDecisionRecords) {
      const decisionIds = Array.from(
        new Set(
          auditEvents
            .map((e: AuditEvent) => e.decisionRecordId)
            .filter((id): id is string => typeof id === 'string' && Boolean(id)),
        ),
      );

      await runner.withTenantTx(ctx, async (tx) => {
        for (const drId of decisionIds) {
          const dr = await findDecisionRecordById(tx, tenantId, drId);
          if (dr) decisionRecords.push(dr);
        }
      });
    }

    // 4. Verify chain integrity status for the exported tenant
    const chainVerification: AuditChainVerificationResponse = await runner.withTenantTx(ctx, async (tx) => {
      return verifyTenantAuditChain(tx, tenantId);
    });

    // 5. Assemble evidence bundle
    const bundle = {
      manifest: {
        evidencePackId: packId,
        tenantId,
        requestedBy: ctx.principal.id,
        generatedAt: new Date().toISOString(),
        filters,
        auditEventCount: auditEvents.length,
        decisionRecordCount: decisionRecords.length,
        chainIntegrity: {
          status: chainVerification.status,
          sealedEvents: chainVerification.sealedEvents,
          totalEvents: chainVerification.totalEvents,
          verifiedAt: chainVerification.verifiedAt,
        },
      },
      auditEvents,
      decisionRecords,
    };

    const canonicalBundleJson = canonicalStringify(bundle);
    const checksum = `sha256:${createHash('sha256').update(canonicalBundleJson).digest('hex')}`;
    const filePath = `evidence-packs/${tenantId}/${packId}.json`;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7-day expiration

    // 6. Complete pack
    await runner.withTenantTx(ctx, async (tx) => {
      await updateEvidencePackStatus(tx, packId, tenantId, 'COMPLETED', {
        recordCount: auditEvents.length,
        checksum,
        filePath,
        completedAt: new Date(),
        expiresAt,
      });
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await runner
      .withTenantTx(ctx, async (tx) => {
        await updateEvidencePackStatus(tx, packId, tenantId, 'FAILED', {
          errorMessage: errorMsg,
          completedAt: new Date(),
        });
      })
      .catch(() => {});
  }
}
