// apps/api/src/modules/verification/router.ts — owner: Developer 2 (Module 19: Verification)
import {
  AppError,
  ChecklistAttestationRequestSchema,
  CompleteVerificationRequestSchema,
  CreateVerificationRequestSchema,
  UpdateVerificationRequestSchema,
  VerificationListQuerySchema,
  type PermissionCode,
  type RequestContext,
} from '@dsa/contracts';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { monotonicFactory } from 'ulid';
import type { ApiDeps } from '../types';
import {
  completeVerification,
  createVerification,
  getVerificationById,
  listVerifications,
  reviewChecklistItem,
  updateVerification,
} from './db';

const nextUlid = monotonicFactory();

function getContext(req: Request): RequestContext {
  if (!req.ctx || !req.ctx.principal) {
    throw AppError.of('UNAUTHENTICATED', 'Missing or invalid access token.');
  }
  return req.ctx;
}

function requirePermission(ctx: RequestContext, code: PermissionCode): void {
  const { principal } = ctx;
  if (principal.kind === 'SERVICE') return;
  const hasGrant = principal.grants.some((g) => g.code === code);
  if (!hasGrant) {
    throw AppError.of('FORBIDDEN', `Permission denied: ${code} required.`);
  }
}

function parseIfMatch(req: Request): number {
  const header = req.header('If-Match');
  if (!header) {
    throw AppError.of('VALIDATION_ERROR', 'If-Match header is required for updates.', [
      { field: 'If-Match', issue: 'REQUIRED' },
    ]);
  }
  const clean = header.replace(/^"|"$/g, '').trim();
  const ver = parseInt(clean, 10);
  if (isNaN(ver)) {
    throw AppError.of('VALIDATION_ERROR', 'Invalid If-Match version.', [
      { field: 'If-Match', issue: 'INVALID' },
    ]);
  }
  return ver;
}

function extractId(req: Request): string {
  const id = req.params.id;
  if (!id || typeof id !== 'string') {
    throw AppError.of('VALIDATION_ERROR', 'Verification id is required.');
  }
  return id;
}

export function createRouter(deps: ApiDeps): Router {
  const router = Router();

  /**
   * GET /verifications
   * List verification cases with filtering and pagination
   */
  router.get('/verifications', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'verification.read');

      const query = VerificationListQuerySchema.parse(req.query);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return listVerifications(tx, ctx, query);
      });

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /verifications/:id
   * Get verification case details
   */
  router.get('/verifications/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'verification.read');

      const id = extractId(req);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return getVerificationById(tx, ctx, id);
      });

      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /verifications
   * Initiate a new verification request
   */
  router.post('/verifications', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'verification.create');

      const body = CreateVerificationRequestSchema.parse(req.body);
      const id = `vrf_${nextUlid()}`;

      const created = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return createVerification(tx, ctx, id, body);
      });

      res.setHeader('ETag', `"${created.lockVersion}"`);
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  /**
   * PATCH /verifications/:id
   * Update verification details (schedule, assignee, notes) with optimistic concurrency
   */
  router.patch('/verifications/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'verification.update');

      const id = extractId(req);
      const ifMatch = parseIfMatch(req);
      const body = UpdateVerificationRequestSchema.parse(req.body);

      const updated = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return updateVerification(tx, ctx, id, ifMatch, body);
      });

      res.setHeader('ETag', `"${updated.lockVersion}"`);
      res.status(200).json(updated);
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /verifications/:id/complete
   * Complete verification assessment (positive/negative outcome)
   */
  router.post('/verifications/:id/complete', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'verification.complete');

      const id = extractId(req);

      let ifMatch: number | null = null;
      if (req.header('If-Match')) {
        ifMatch = parseIfMatch(req);
      }

      const body = CompleteVerificationRequestSchema.parse(req.body);

      const completed = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return completeVerification(tx, ctx, id, ifMatch, body);
      });

      res.setHeader('ETag', `"${completed.lockVersion}"`);
      res.status(200).json(completed);
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /verifications/:id/checklist-review
   * Review and attest a document checklist item
   */
  router.post('/verifications/:id/checklist-review', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'document.review');

      const id = extractId(req);

      const body = ChecklistAttestationRequestSchema.parse(req.body);

      const reviewed = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return reviewChecklistItem(tx, ctx, id, body);
      });

      res.status(200).json(reviewed);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
