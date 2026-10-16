// apps/api/src/modules/reconciliation/router.ts
import {
  AdjustmentApprovalInputSchema,
  AdjustmentProposalInputSchema,
  AppError,
  AutoIngestBankFeedInputSchema,
  BankReconcilePayoutInputSchema,
  CreateDisputeInputSchema,
  ImportLenderStatementInputSchema,
  ListExceptionsQuerySchema,
  ResolveExceptionInputSchema,
  UpdateDisputeInputSchema,
  type RequestContext,
  type Tx,
} from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import { Router, type Request, type Response } from 'express';
import type { ZodError } from 'zod';
import type { ApiDeps } from '../types';
import { ReconciliationService } from './reconciliation-service';
import { PgReconciliationRepository } from './repository';

function getRequestContext(req: Request): RequestContext {
  if (!req.ctx) {
    throw AppError.of('UNAUTHENTICATED', 'No request authentication context.');
  }
  return req.ctx;
}

function extractParam(param: string | string[] | undefined, name = 'id'): string {
  if (!param || typeof param !== 'string') {
    throw AppError.of('NOT_FOUND', `${name} not found`);
  }
  return param;
}

function extractIfMatch(req: Request): number {
  const raw = req.header('If-Match');
  if (!raw) {
    throw AppError.of('VALIDATION_ERROR', 'If-Match header is required for optimistic concurrency', [
      { field: 'If-Match', issue: 'REQUIRED' },
    ]);
  }
  const clean = raw.replace(/^"|"$/g, '');
  const version = parseInt(clean, 10);
  if (isNaN(version)) {
    throw AppError.of('VALIDATION_ERROR', 'If-Match must be an integer lock version');
  }
  return version;
}

function handleZodError(err: ZodError): never {
  const details = err.issues.map((i) => ({
    field: i.path.join('.'),
    issue: i.message,
  }));
  throw AppError.of('VALIDATION_ERROR', 'Request validation failed', details);
}

export function createRouter(deps: ApiDeps, serviceOverride?: ReconciliationService): Router {
  const router = Router();
  const repository = (deps as any).reconciliationRepository || new PgReconciliationRepository();
  const service =
    serviceOverride ||
    new ReconciliationService({
      repository,
      audit: deps.audit,
      outbox: deps.outboxPort,
    });

  // --- SUB-REC.01: LENDER STATEMENTS ---

  // API-REC-001: POST /v1/lender-statements
  router.post('/lender-statements', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const parsed = ImportLenderStatementInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const idemKey = req.header('idempotency-key');
      if (idemKey) {
        const cmd = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
          if (typeof (tx as any)?.execute === 'function') {
            return withIdempotency(
              tx,
              ctx,
              { key: idemKey, method: 'POST', path: req.originalUrl || '/v1/lender-statements', body: parsed.data },
              async () => {
                const result = await service.importLenderStatement(tx, ctx, parsed.data);
                return { status: 201, body: result };
              },
            );
          }
          const result = await service.importLenderStatement(tx, ctx, parsed.data);
          return { status: 201, body: result };
        });
        if (cmd.replayed) res.setHeader('Idempotent-Replayed', 'true');
        res.status(cmd.status).json(cmd.body);
        return;
      }

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.importLenderStatement(tx, ctx, parsed.data);
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // AUTOMATED BANK STATEMENT INGESTION (MT940 / CSV FEEDS) (MOD-REC / TASK-418)
  // POST /v1/reconciliation/auto-ingest & POST /v1/lender-statements/auto-ingest
  router.post(['/reconciliation/auto-ingest', '/lender-statements/auto-ingest'], async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const parsed = AutoIngestBankFeedInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.autoIngestBankFeed(tx, ctx, parsed.data);
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/lender-statements
  router.get('/lender-statements', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const lenderId = typeof req.query.lenderId === 'string' ? req.query.lenderId : undefined;
      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.listLenderStatements(tx, ctx, lenderId);
      });
      res.status(200).json({ items: result });
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/lender-statements/:id
  router.get('/lender-statements/:id', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id);
      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.getLenderStatement(tx, ctx, id);
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // SUB-REC.02: POST /v1/lender-statements/:id/match
  router.post('/lender-statements/:id/match', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id);
      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.runCommissionMatching(tx, ctx, id);
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // --- SUB-REC.03: EXCEPTIONS & ADJUSTMENTS ---

  // API-REC-002: GET /v1/reconciliation-exceptions
  router.get('/reconciliation-exceptions', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const parsed = ListExceptionsQuerySchema.safeParse(req.query);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.listExceptions(tx, ctx, parsed.data);
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-REC-003: POST /v1/reconciliation-exceptions/:id/resolution
  router.post('/reconciliation-exceptions/:id/resolution', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id);
      const parsed = ResolveExceptionInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.resolveException(tx, ctx, id, parsed.data);
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-REC-004: POST /v1/adjustments
  router.post('/adjustments', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const parsed = AdjustmentProposalInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.proposeAdjustment(tx, ctx, parsed.data);
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-REC-005: POST /v1/adjustments/:id/approval
  router.post('/adjustments/:id/approval', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id);
      const parsed = AdjustmentApprovalInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.approveAdjustment(tx, ctx, id, parsed.data);
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/adjustments
  router.get('/adjustments', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.listAdjustments(tx, ctx);
      });
      res.status(200).json({ items: result });
    } catch (err) {
      next(err);
    }
  });

  // --- SUB-REC.04: DISPUTES ---

  // API-REC-006: POST /v1/disputes
  router.post('/disputes', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const parsed = CreateDisputeInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const idemKey = req.header('idempotency-key');
      if (idemKey) {
        const cmd = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
          if (typeof (tx as any)?.execute === 'function') {
            return withIdempotency(
              tx,
              ctx,
              { key: idemKey, method: 'POST', path: req.originalUrl || '/v1/disputes', body: parsed.data },
              async () => {
                const result = await service.createDispute(tx, ctx, parsed.data);
                return { status: 201, body: result };
              },
            );
          }
          const result = await service.createDispute(tx, ctx, parsed.data);
          return { status: 201, body: result };
        });
        res.setHeader('ETag', `"${cmd.body.lockVersion}"`);
        if (cmd.replayed) res.setHeader('Idempotent-Replayed', 'true');
        res.status(cmd.status).json(cmd.body);
        return;
      }

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.createDispute(tx, ctx, parsed.data);
      });
      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-REC-007: PATCH /v1/disputes/:id
  router.patch('/disputes/:id', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id);
      const ifMatch = extractIfMatch(req);
      const parsed = UpdateDisputeInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const payableIdsToRelease = Array.isArray(req.body.payableIdsToRelease)
        ? req.body.payableIdsToRelease
        : undefined;

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.updateDispute(tx, ctx, id, ifMatch, parsed.data, payableIdsToRelease);
      });
      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/disputes
  router.get('/disputes', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const partyType = typeof req.query.partyType === 'string' ? req.query.partyType : undefined;

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.listDisputes(tx, ctx, { status, partyType });
      });
      res.status(200).json({ items: result });
    } catch (err) {
      next(err);
    }
  });

  // --- SUB-REC.05: BANK PAYOUT SETTLEMENT RECONCILIATION ---

  // POST /v1/reconciliation/payouts/:id/bank-reconcile
  router.post('/reconciliation/payouts/:id/bank-reconcile', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id);
      const parsed = BankReconcilePayoutInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.reconcilePayoutWithBank(tx, ctx, id, parsed.data);
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
