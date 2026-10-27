// apps/api/src/modules/origination/lender-cases/router.ts — owner: Dev 4 (MOD-LCS Lender Cases)
import {
  AppError,
  BuildPackageInputSchema,
  CreateLenderCaseInputSchema,
  RecordLenderQueryInputSchema,
  RecordQueryResponseInputSchema,
  SubmitLenderCaseInputSchema,
  UpdateLenderCaseStatusInputSchema,
  type RequestContext,
} from '@dsa/contracts';
import { Router, type Request, type Response } from 'express';
import type { ZodError } from 'zod';
import type { ApiDeps } from '../../types';
import { SqlLenderCaseRepository, type LenderCaseRepository } from './repository';
import { LenderCaseService } from './service';

function getRequestContext(req: Request): RequestContext {
  if (!req.ctx || !req.ctx.principal) {
    throw AppError.of('UNAUTHENTICATED', 'No request authentication context.');
  }
  return req.ctx;
}

function extractIdempotencyKey(req: Request): string | null {
  const raw = req.header('Idempotency-Key');
  if (!raw) return null;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(raw)) {
    throw AppError.of('VALIDATION_ERROR', 'A valid Idempotency-Key header is required', [
      { field: 'Idempotency-Key', issue: 'REQUIRED_OR_INVALID_FORMAT' },
    ]);
  }
  return raw;
}

function parseETag(etagHeader?: string | null): number | null {
  if (!etagHeader) return null;
  const cleaned = etagHeader.replace(/^W\//, '').replace(/^"|"$/g, '');
  const parts = cleaned.split(':');
  if (parts.length === 2) {
    const v = parseInt(parts[1]!, 10);
    if (!isNaN(v)) return v;
  }
  const v = parseInt(cleaned, 10);
  if (!isNaN(v)) return v;
  throw AppError.of('VERSION_CONFLICT', 'Malformed ETag / If-Match header value');
}

function handleZodError(err: ZodError): never {
  const details = err.issues.map((i) => ({
    field: i.path.join('.'),
    issue: i.message,
  }));
  throw AppError.of('VALIDATION_ERROR', 'Request validation failed', details);
}

function getParamId(req: Request, name: string = 'id'): string {
  const raw = req.params[name];
  const val = Array.isArray(raw) ? raw[0] : raw;
  if (!val || typeof val !== 'string') {
    throw AppError.of('NOT_FOUND', `Missing required parameter '${name}'`);
  }
  return val;
}

export function createRouter(deps: ApiDeps): Router {
  const router = Router();

  const repository: LenderCaseRepository =
    ((deps as any).lenderCaseRepository as LenderCaseRepository | undefined) ?? new SqlLenderCaseRepository();

  const service = new LenderCaseService({
    repository,
    consentPort: deps.consentPort,
    applicationPort: deps.applicationPort,
    taskPort: deps.taskPort,
  });

  /**
   * API-LCS-001: Create Lender Case
   * POST /applications/:id/lender-cases
   */
  router.post('/applications/:id/lender-cases', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const applicationId = getParamId(req);

    const idempotencyKey = extractIdempotencyKey(req);

    const parseResult = CreateLenderCaseInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      handleZodError(parseResult.error);
    }

    const resource = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return service.createCase(tx, ctx, applicationId, parseResult.data, idempotencyKey);
    });

    res.setHeader('ETag', `"${resource.lockVersion}"`);
    res.status(201).json(resource);
  });

  /**
   * List Lender Cases for Application
   * GET /applications/:id/lender-cases
   */
  router.get('/applications/:id/lender-cases', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const applicationId = getParamId(req);

    const cases = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return service.listCases(tx, ctx, applicationId);
    });

    res.status(200).json({ data: cases });
  });

  /**
   * List All Lender Cases (Tenant Scope)
   * GET /lender-cases
   */
  router.get('/lender-cases', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const { status, lenderId, applicationId, limit, cursor } = req.query;

    const pageSize = limit === undefined ? undefined : Number(limit);
    if (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200)) {
      throw AppError.of('VALIDATION_ERROR', 'limit must be a whole number from 1 to 200', [
        { field: 'limit', issue: 'OUT_OF_RANGE' },
      ]);
    }

    const page = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return service.listAllCases(tx, ctx, {
        status: typeof status === 'string' ? status : undefined,
        lenderId: typeof lenderId === 'string' ? lenderId : undefined,
        applicationId: typeof applicationId === 'string' ? applicationId : undefined,
        limit: pageSize,
        cursor: typeof cursor === 'string' ? cursor : undefined,
      });
    });

    res.status(200).json(page);
  });

  /**
   * API-LCS-002: Retrieve Lender Case
   * GET /lender-cases/:id
   */
  router.get('/lender-cases/:id', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const id = getParamId(req);

    const resource = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return service.getCase(tx, ctx, id);
    });

    res.setHeader('ETag', `"${resource.lockVersion}"`);
    res.status(200).json(resource);
  });

  /**
   * Query history for a lender case, with the answer to each query where one was recorded
   * GET /lender-cases/:id/queries
   */
  router.get('/lender-cases/:id/queries', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const id = getParamId(req);

    const queries = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return service.listQueries(tx, ctx, id);
    });

    res.status(200).json({ data: queries });
  });

  /**
   * Status history for a lender case, oldest first
   * GET /lender-cases/:id/history
   */
  router.get('/lender-cases/:id/history', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const id = getParamId(req);

    const history = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return service.listStatusHistory(tx, ctx, id);
    });

    res.status(200).json({ data: history });
  });

  /**
   * The submission package the case was built and frozen with
   * GET /lender-cases/:id/package
   */
  router.get('/lender-cases/:id/package', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const id = getParamId(req);

    const pkg = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return service.getPackage(tx, ctx, id);
    });

    res.status(200).json(pkg);
  });

  /**
   * API-LCS-003: Build or Preview Package
   * POST /lender-cases/:id/package
   */
  router.post('/lender-cases/:id/package', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const id = getParamId(req);

    const ifMatch = parseETag(req.header('If-Match'));

    const parseResult = BuildPackageInputSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      handleZodError(parseResult.error);
    }

    const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return service.buildPackage(tx, ctx, id, parseResult.data, ifMatch);
    });

    res.setHeader('ETag', `"${result.case.lockVersion}"`);
    res.status(200).json(result);
  });

  /**
   * API-LCS-004: Submit Lender Case
   * POST /lender-cases/:id/submission
   */
  router.post('/lender-cases/:id/submission', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const id = getParamId(req);

    const idempotencyKey = extractIdempotencyKey(req);
    const ifMatch = parseETag(req.header('If-Match'));

    const parseResult = SubmitLenderCaseInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      handleZodError(parseResult.error);
    }

    const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return service.submitCase(tx, ctx, id, parseResult.data, ifMatch, idempotencyKey);
    });

    res.status(200).json(result);
  });

  /**
   * API-LCS-005: Record Status Update
   * POST /lender-cases/:id/status-updates
   */
  router.post('/lender-cases/:id/status-updates', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const id = getParamId(req);

    const rawIfMatch = req.header('If-Match');
    if (!rawIfMatch) {
      throw AppError.of('VALIDATION_ERROR', 'If-Match header is required for status updates', [
        { field: 'If-Match', issue: 'REQUIRED' },
      ]);
    }
    const ifMatch = parseETag(rawIfMatch);

    const parseResult = UpdateLenderCaseStatusInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      handleZodError(parseResult.error);
    }

    const updatedResource = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return service.updateStatus(tx, ctx, id, parseResult.data, ifMatch);
    });

    res.setHeader('ETag', `"${updatedResource.lockVersion}"`);
    res.status(200).json(updatedResource);
  });

  /**
   * API-LCS-006: Record Lender Query
   * POST /lender-cases/:id/queries
   */
  router.post('/lender-cases/:id/queries', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const id = getParamId(req);

    const ifMatch = parseETag(req.header('If-Match'));

    const parseResult = RecordLenderQueryInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      handleZodError(parseResult.error);
    }

    const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return service.recordQuery(tx, ctx, id, parseResult.data, ifMatch);
    });

    res.setHeader('ETag', `"${result.case.lockVersion}"`);
    res.status(201).json(result);
  });

  /**
   * API-LCS-007: Record Query Response
   * POST /lender-queries/:id/responses
   */
  router.post('/lender-queries/:id/responses', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const queryId = getParamId(req);

    const parseResult = RecordQueryResponseInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      handleZodError(parseResult.error);
    }

    const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return service.recordQueryResponse(tx, ctx, queryId, parseResult.data);
    });

    res.setHeader('ETag', `"${result.case.lockVersion}"`);
    res.status(200).json(result);
  });

  return router;
}
