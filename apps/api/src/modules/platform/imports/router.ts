// apps/api/src/modules/platform/imports/router.ts — owner: Platform Squad (MOD-IMP, TASK-413)
import {
  AppError,
  CommitImportSchema,
  ConfigureMappingSchema,
  CreateImportSchema,
  RollbackImportSchema,
  SaveLenderMisMappingInputSchema,
} from '@dsa/contracts';
import { Router, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { requireCtx } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { ImportRepository } from './repository';
import { ImportService } from './service';
import { MisMappingRepository } from './mis-mapping-repository';

function handleZodError(err: ZodError): never {
  const details = err.issues.map((i) => ({
    field: i.path.join('.'),
    issue: i.code,
    message: i.message,
  }));
  throw AppError.of('VALIDATION_ERROR', 'Request validation failed.', details);
}

function getParam(req: Request, name: string): string {
  const val = req.params[name];
  if (!val || typeof val !== 'string') {
    throw AppError.of('VALIDATION_ERROR', `Missing required path parameter: ${name}`);
  }
  return val;
}

export function createRouter(deps: ApiDeps): Router {
  const router = Router();
  const repo = (deps.importRepository as ImportRepository) ?? new ImportRepository();
  // Injectable like importRepository, so the MIS paths can be exercised without a database.
  const misRepo = (deps.misMappingRepository as MisMappingRepository) ?? new MisMappingRepository();
  const service = new ImportService(deps, repo, undefined, misRepo);

  /**
   * POST /v1/imports: Upload file and create import batch
   */
  router.post('/imports', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);

    // Support Idempotency-Key
    const idempotencyKey = req.header('Idempotency-Key');

    let body;
    try {
      body = CreateImportSchema.parse(req.body);
    } catch (err: unknown) {
      if (err instanceof ZodError) return handleZodError(err);
      throw err;
    }

    const batch = await deps.txRunner.withTenantTx(ctx, (tx) => service.createImport(tx, ctx, body));

    if (idempotencyKey) {
      res.setHeader('Idempotent-Replayed', 'false');
    }
    res.status(201).json(batch);
  });

  /**
   * POST /v1/imports/:id/mapping: Configure column mapping and preview
   */
  router.post('/imports/:id/mapping', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const id = getParam(req, 'id');

    let body;
    try {
      body = ConfigureMappingSchema.parse(req.body);
    } catch (err: unknown) {
      if (err instanceof ZodError) return handleZodError(err);
      throw err;
    }

    const batch = await deps.txRunner.withTenantTx(ctx, (tx) => service.configureMapping(tx, ctx, id, body));

    res.status(200).json(batch);
  });

  /**
   * POST /v1/imports/:id/commit: Validate and import rows asynchronously
   */
  router.post('/imports/:id/commit', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const id = getParam(req, 'id');

    let body;
    try {
      body = CommitImportSchema.parse(req.body ?? {});
    } catch (err: unknown) {
      if (err instanceof ZodError) return handleZodError(err);
      throw err;
    }

    const batch = await deps.txRunner.withTenantTx(ctx, (tx) => service.commitImport(tx, ctx, id, body));

    res.status(200).json(batch);
  });

  /**
   * POST /v1/imports/:id/rollback: Roll back batch within 24 hours
   */
  router.post('/imports/:id/rollback', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const id = getParam(req, 'id');

    let body;
    try {
      body = RollbackImportSchema.parse(req.body ?? { reason: 'User requested rollback' });
    } catch (err: unknown) {
      if (err instanceof ZodError) return handleZodError(err);
      throw err;
    }

    const batch = await deps.txRunner.withTenantTx(ctx, (tx) => service.rollbackImport(tx, ctx, id, body));

    res.status(200).json(batch);
  });

  /**
   * GET /v1/imports/:id: Retrieve import batch details
   */
  router.get('/imports/:id', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const id = getParam(req, 'id');

    const batch = await deps.txRunner.withTenantTx(ctx, (tx) => service.getImportBatch(tx, ctx, id));

    res.status(200).json(batch);
  });

  /**
   * GET /v1/imports/:id/report: Download validation error report CSV
   */
  router.get('/imports/:id/report', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const id = getParam(req, 'id');

    const buffer = await deps.txRunner.withTenantTx(ctx, (tx) => service.getReport(tx, ctx, id));

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="import_${id}_errors.csv"`);
    res.status(200).send(buffer);
  });

  /**
   * P1-07: the lender's saved MIS mapping — which column holds what, how the bank words each stage, how it writes
   * dates. GET /v1/lenders/:lenderId/mis-mapping
   */
  router.get('/lenders/:lenderId/mis-mapping', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const lenderId = getParam(req, 'lenderId');

    const mapping = await deps.txRunner.withTenantTx(ctx, (tx) => service.getMisMapping(tx, ctx, lenderId));

    // 404 rather than an empty object: a lender with no mapping saved yet is a different thing from one whose
    // mapping is empty, and the editor opens differently for each.
    if (!mapping) {
      throw AppError.of('NOT_FOUND', `No MIS mapping saved for lender ${lenderId}.`);
    }
    res.setHeader('ETag', `"${mapping.lockVersion}"`);
    res.status(200).json(mapping);
  });

  /**
   * PUT /v1/lenders/:lenderId/mis-mapping — save or replace it. PUT, not PATCH: a mapping is replaced whole, and a
   * half-updated status map would silently stop matching the words it no longer lists.
   */
  router.put('/lenders/:lenderId/mis-mapping', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const lenderId = getParam(req, 'lenderId');

    const parsed = SaveLenderMisMappingInputSchema.safeParse(req.body);
    if (!parsed.success) handleZodError(parsed.error);

    const mapping = await deps.txRunner.withTenantTx(ctx, (tx) =>
      service.saveMisMapping(tx, ctx, lenderId, parsed.data),
    );

    res.setHeader('ETag', `"${mapping.lockVersion}"`);
    res.status(200).json(mapping);
  });

  /**
   * GET /v1/imports: List all import batches
   */
  router.get('/imports', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);

    const batches = await deps.txRunner.withTenantTx(ctx, (tx) => service.listBatches(tx, ctx));

    res.status(200).json({ data: batches });
  });

  return router;
}
