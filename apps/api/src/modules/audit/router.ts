// apps/api/src/modules/audit/router.ts — Module 37: Audit (MOD-AUD, DOM-N)
// APIs: API-AUD-001 (audit search) · API-AUD-002 (cursor pagination) · API-AUD-003 (chain verification) · Evidence Packs
import { Router, type Request, type Response } from 'express';
import {
  AppError,
  AuditSearchQuery,
  CreateEvidencePackRequest,
  type EvidencePackResponse,
} from '@dsa/contracts';
import { requireCtx } from '../../http/request';
import type { ApiDeps } from '../types';
import {
  searchAuditEvents,
  findAuditEventById,
  findDecisionRecordById,
  createEvidencePackRow,
  findEvidencePackById,
  listEvidencePacks,
} from './repository';
import { sealTenantAuditChain } from './sealer';
import { verifyTenantAuditChain } from './verifier';
import { processEvidencePackAsync } from './evidence-pack';

export function createRouter(deps: ApiDeps): Router {
  const router = Router();

  // ==========================================================================
  // API-AUD-001 & API-AUD-002: Audit Search with Cursor Pagination
  // ==========================================================================
  router.get('/audit-events', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'audit.read');

    const query = AuditSearchQuery.parse(req.query);

    const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return searchAuditEvents(tx, ctx.principal.tenantId, query);
    });

    res.json(result);
  });

  // ==========================================================================
  // GET /v1/audit-events/:id: Retrieve single audit event
  // ==========================================================================
  router.get('/audit-events/:id', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'audit.read');

    const auditId = req.params.id;
    if (!auditId || typeof auditId !== 'string') {
      throw AppError.of('NOT_FOUND', 'Audit event not found.');
    }
    const event = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return findAuditEventById(tx, ctx.principal.tenantId, auditId);
    });

    if (!event) {
      throw AppError.of('NOT_FOUND', 'Audit event not found.');
    }

    res.json(event);
  });

  // ==========================================================================
  // GET /v1/audit-events/:id/decision-record: Look up linked MOD-BRE decision record
  // ==========================================================================
  router.get('/audit-events/:id/decision-record', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'audit.read');

    const auditId = req.params.id;
    if (!auditId || typeof auditId !== 'string') {
      throw AppError.of('NOT_FOUND', 'Audit event not found.');
    }
    const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const event = await findAuditEventById(tx, ctx.principal.tenantId, auditId);
      if (!event) {
        throw AppError.of('NOT_FOUND', 'Audit event not found.');
      }
      if (!event.decisionRecordId) {
        throw AppError.of('NOT_FOUND', 'No decision record linked to this audit event.');
      }
      const dr = await findDecisionRecordById(tx, ctx.principal.tenantId, event.decisionRecordId);
      if (!dr) {
        throw AppError.of('NOT_FOUND', 'Linked decision record not found.');
      }
      return dr;
    });

    res.json(result);
  });

  // ==========================================================================
  // API-AUD-003: Audit Chain Verification
  // ==========================================================================
  router.get('/audit-chain/verification', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'audit.read');

    const verification = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return verifyTenantAuditChain(tx, ctx.principal.tenantId);
    });

    res.json(verification);
  });

  // ==========================================================================
  // Chain Sealer: Seals unsealed audit events into the cryptographic hash chain
  // ==========================================================================
  router.post('/audit-chain/seal', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'audit.read');

    const sealResult = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return sealTenantAuditChain(tx, ctx.principal.tenantId);
    });

    res.json(sealResult);
  });

  // ==========================================================================
  // Evidence Packs: Request Evidence Export (TASK-408 / SUB-AUD.03 C)
  // ==========================================================================
  router.post('/evidence-packs', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'audit.export_evidence');

    const body = CreateEvidencePackRequest.parse(req.body);
    const packId = deps.ids.next('evp');

    const pack = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const row = await createEvidencePackRow(tx, packId, ctx.principal.tenantId, ctx.principal.id, body);

      // Record audit event for evidence export request in the same transaction
      await deps.audit.record(tx, ctx, {
        action: 'audit.evidence_exported',
        entityType: 'evidence_pack',
        entityId: packId,
        permissionUsed: 'audit.export_evidence',
        after: {
          filters: body,
          status: 'PENDING',
        },
      });

      return row;
    });

    // Execute evidence-pack generation job asynchronously
    void processEvidencePackAsync(deps.txRunner, ctx, packId, body);

    const response: EvidencePackResponse = {
      id: pack.id,
      tenantId: pack.tenant_id,
      requestedBy: pack.requested_by,
      status: pack.status,
      filters: (pack.filters as Record<string, unknown>) ?? {},
      recordCount: pack.record_count,
      checksum: pack.checksum,
      fileUrl: pack.file_path ? `/v1/evidence-packs/${pack.id}/download` : null,
      createdAt:
        pack.created_at instanceof Date
          ? pack.created_at.toISOString()
          : new Date(pack.created_at).toISOString(),
      completedAt: pack.completed_at ? new Date(pack.completed_at).toISOString() : null,
      expiresAt: pack.expires_at ? new Date(pack.expires_at).toISOString() : null,
      errorMessage: pack.error_message,
    };

    res.status(202).json(response);
  });

  // ==========================================================================
  // Evidence Packs: Get Evidence Pack Status / Details
  // ==========================================================================
  router.get('/evidence-packs/:id', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'audit.export_evidence');

    const packId = req.params.id;
    if (!packId || typeof packId !== 'string') {
      throw AppError.of('NOT_FOUND', 'Evidence pack not found.');
    }

    const pack = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return findEvidencePackById(tx, ctx.principal.tenantId, packId);
    });

    if (!pack) {
      throw AppError.of('NOT_FOUND', 'Evidence pack not found.');
    }

    const response: EvidencePackResponse = {
      id: pack.id,
      tenantId: pack.tenant_id,
      requestedBy: pack.requested_by,
      status: pack.status,
      filters: (pack.filters as Record<string, unknown>) ?? {},
      recordCount: pack.record_count,
      checksum: pack.checksum,
      fileUrl: pack.file_path ? `/v1/evidence-packs/${pack.id}/download` : null,
      createdAt:
        pack.created_at instanceof Date
          ? pack.created_at.toISOString()
          : new Date(pack.created_at).toISOString(),
      completedAt: pack.completed_at ? new Date(pack.completed_at).toISOString() : null,
      expiresAt: pack.expires_at ? new Date(pack.expires_at).toISOString() : null,
      errorMessage: pack.error_message,
    };

    res.json(response);
  });

  // ==========================================================================
  // Evidence Packs: Download Pack (Authorization & Tenant Scoping Enforced)
  // ==========================================================================
  router.get('/evidence-packs/:id/download', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'audit.export_evidence');

    const packId = req.params.id;
    if (!packId || typeof packId !== 'string') {
      throw AppError.of('NOT_FOUND', 'Evidence pack not found.');
    }
    const pack = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const p = await findEvidencePackById(tx, ctx.principal.tenantId, packId);
      if (!p) {
        throw AppError.of('NOT_FOUND', 'Evidence pack not found.');
      }
      if (p.status !== 'COMPLETED') {
        throw AppError.of('INVALID_STATE', `Evidence pack is not ready for download (status: ${p.status}).`);
      }
      if (p.expires_at && new Date(p.expires_at).getTime() < Date.now()) {
        throw AppError.of('INVALID_STATE', 'Evidence pack download link has expired.');
      }

      // Record download audit event
      await deps.audit.record(tx, ctx, {
        action: 'audit.evidence_downloaded',
        entityType: 'evidence_pack',
        entityId: packId,
        permissionUsed: 'audit.export_evidence',
        after: {
          checksum: p.checksum,
          recordCount: p.record_count,
        },
      });

      return p;
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="evidence-pack-${pack.id}.json"`);
    if (pack.checksum) res.setHeader('X-Checksum', pack.checksum);

    res.json({
      evidencePackId: pack.id,
      tenantId: pack.tenant_id,
      requestedBy: pack.requested_by,
      recordCount: pack.record_count,
      checksum: pack.checksum,
      completedAt: pack.completed_at,
    });
  });

  // ==========================================================================
  // Evidence Packs: List Evidence Packs for Tenant
  // ==========================================================================
  router.get('/evidence-packs', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'audit.export_evidence');

    const rows = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return listEvidencePacks(tx, ctx.principal.tenantId);
    });

    const data: EvidencePackResponse[] = rows.map((pack) => ({
      id: pack.id,
      tenantId: pack.tenant_id,
      requestedBy: pack.requested_by,
      status: pack.status,
      filters: (pack.filters as Record<string, unknown>) ?? {},
      recordCount: pack.record_count,
      checksum: pack.checksum,
      fileUrl: pack.file_path ? `/v1/evidence-packs/${pack.id}/download` : null,
      createdAt:
        pack.created_at instanceof Date
          ? pack.created_at.toISOString()
          : new Date(pack.created_at).toISOString(),
      completedAt: pack.completed_at ? new Date(pack.completed_at).toISOString() : null,
      expiresAt: pack.expires_at ? new Date(pack.expires_at).toISOString() : null,
      errorMessage: pack.error_message,
    }));

    res.json({
      data,
      meta: {
        limit: rows.length,
        nextCursor: null,
      },
    });
  });

  return router;
}
