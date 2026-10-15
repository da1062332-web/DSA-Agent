// apps/api/src/modules/finance/router.ts — owner: Developer 5 (Bhushan) (MOD-COM / MOD-PAY / Module 30)
import {
  AppError,
  ApproveCommissionPlanInputSchema,
  ApproveRecalculationProposalInputSchema,
  CalculateCommissionInputSchema,
  CancelPayoutRequestInputSchema,
  CreateClawbackInputSchema,
  CreateCommissionPlanInputSchema,
  CreatePayoutBatchInputSchema,
  CreatePayoutRequestInputSchema,
  CreateRecalculationProposalInputSchema,
  PayoutApprovalInputSchema,
  RecordPaymentFailureInputSchema,
  RecordPaymentInputSchema,
  RejectClawbackInputSchema,
  UpdateCommissionPlanInputSchema,
  type RequestContext,
  type Tx,
} from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import { Router, type Request, type Response } from 'express';
import type { ZodError } from 'zod';
import type { ApiDeps } from '../types';
import { FinanceService } from './finance-service';
import { SqlFinanceRepository } from './repository';

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

export function createRouter(deps: ApiDeps): Router {
  const router = Router();
  const repository = new SqlFinanceRepository();
  const service = new FinanceService({
    repository,
    audit: deps.audit,
    outbox: deps.outboxPort,
  });

  // --- COMMISSION PLANS ---

  // API-COM-003: POST /v1/commission-plans
  router.post('/commission-plans', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const parsed = CreateCommissionPlanInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.createCommissionPlan(tx, ctx, parsed.data);
      });
      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/commission-plans
  router.get('/commission-plans', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const lenderId = typeof req.query.lenderId === 'string' ? req.query.lenderId : undefined;
      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.listCommissionPlans(tx, ctx, lenderId);
      });
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/commission-plans/:id
  router.get('/commission-plans/:id', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id, 'id');
      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.getCommissionPlan(tx, ctx, id);
      });
      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-COM-004: PATCH /v1/commission-plans/:id
  router.patch('/commission-plans/:id', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id, 'id');
      const lockVersion = extractIfMatch(req);
      const parsed = UpdateCommissionPlanInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.updateCommissionPlan(tx, ctx, id, lockVersion, parsed.data);
      });
      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-COM-008: POST /v1/commission-plans/:id/approval
  router.post('/commission-plans/:id/approval', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id, 'id');
      const lockVersion = extractIfMatch(req);
      const parsed = ApproveCommissionPlanInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.approveCommissionPlan(tx, ctx, id, lockVersion, parsed.data);
      });
      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // --- COMMISSION CALCULATION & PAYABLES ---

  // Trigger from disbursement tranche: POST /v1/commission/calculate
  router.post('/commission/calculate', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const parsed = CalculateCommissionInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.calculateCommission(tx, ctx, parsed.data);
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-COM-001: GET /v1/commission-calculations/:id
  router.get('/commission-calculations/:id', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id, 'id');
      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.getCalculation(tx, ctx, id);
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-COM-002: GET /v1/commission-calculations
  router.get('/commission-calculations', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const lenderId = typeof req.query.lenderId === 'string' ? req.query.lenderId : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.listCalculations(tx, ctx, { lenderId, status, cursor, limit });
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-COM-007: GET /v1/commission-payables
  router.get('/commission-payables', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const connectorId = typeof req.query.connectorId === 'string' ? req.query.connectorId : undefined;
      const state = typeof req.query.state === 'string' ? req.query.state : undefined;
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.listPayables(tx, ctx, { connectorId, state, cursor, limit });
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // --- CLAWBACKS ---

  // API-COM-009: POST /v1/clawbacks
  router.post('/clawbacks', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const parsed = CreateClawbackInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.createClawback(tx, ctx, parsed.data);
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /v1/clawbacks/:id/approval
  router.post('/clawbacks/:id/approval', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id, 'id');
      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.approveClawback(tx, ctx, id);
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /v1/clawbacks/:id/rejection
  router.post('/clawbacks/:id/rejection', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id, 'id');
      const parsed = RejectClawbackInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.rejectClawback(tx, ctx, id);
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // --- RECALCULATION PROPOSALS ---

  // API-COM-005: POST /v1/recalculation-proposals
  router.post('/recalculation-proposals', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const parsed = CreateRecalculationProposalInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.createRecalculationProposal(tx, ctx, parsed.data);
      });
      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/recalculation-proposals
  router.get('/recalculation-proposals', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.listRecalculationProposals(tx, ctx);
      });
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/recalculation-proposals/:id
  router.get('/recalculation-proposals/:id', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id, 'id');
      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.getRecalculationProposal(tx, ctx, id);
      });
      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-COM-006: POST /v1/recalculation-proposals/:id/approval
  router.post('/recalculation-proposals/:id/approval', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id, 'id');
      const parsed = ApproveRecalculationProposalInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.approveRecalculationProposal(tx, ctx, id, parsed.data);
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // --- PAYOUT REQUESTS ---

  // API-PAY-001: POST /v1/payout-requests
  router.post('/payout-requests', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      deps.authz.requirePermission(ctx, 'payout.request');
      const parsed = CreatePayoutRequestInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const idemKey = req.header('idempotency-key');
      if (idemKey) {
        const cmd = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
          return withIdempotency(
            tx,
            ctx,
            { key: idemKey, method: 'POST', path: req.originalUrl || '/v1/payout-requests', body: parsed.data },
            async () => {
              const result = await service.createPayoutRequest(tx, ctx, parsed.data);
              return { status: 201, body: result };
            },
          );
        });
        res.setHeader('ETag', `"${cmd.body.lockVersion}"`);
        if (cmd.replayed) res.setHeader('Idempotent-Replayed', 'true');
        return res.status(cmd.status).json(cmd.body);
      }

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.createPayoutRequest(tx, ctx, parsed.data);
      });
      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-PAY-002: GET /v1/payout-requests
  router.get('/payout-requests', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      deps.authz.requirePermission(ctx, 'finance.view');
      const connectorId = typeof req.query.connectorId === 'string' ? req.query.connectorId : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.listPayoutRequests(tx, ctx, { connectorId, status, cursor, limit });
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/payout-requests/:id
  router.get('/payout-requests/:id', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      deps.authz.requirePermission(ctx, 'finance.view');
      const id = extractParam(req.params.id, 'id');
      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.getPayoutRequest(tx, ctx, id);
      });
      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-PAY-003: POST /v1/payout-requests/:id/approval
  router.post('/payout-requests/:id/approval', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      deps.authz.requirePermission(ctx, 'payout.approve');
      deps.authz.requireStepUp(ctx);
      const id = extractParam(req.params.id, 'id');
      const parsed = PayoutApprovalInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const idemKey = req.header('idempotency-key');
      if (idemKey) {
        const cmd = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
          return withIdempotency(
            tx,
            ctx,
            { key: idemKey, method: 'POST', path: req.originalUrl || `/v1/payout-requests/${id}/approval`, body: parsed.data },
            async () => {
              const result = await service.approvePayoutRequest(tx, ctx, id, parsed.data);
              return { status: 200, body: result };
            },
          );
        });
        if (cmd.replayed) res.setHeader('Idempotent-Replayed', 'true');
        return res.status(cmd.status).json(cmd.body);
      }

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.approvePayoutRequest(tx, ctx, id, parsed.data);
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /v1/payout-requests/:id/cancel
  router.post('/payout-requests/:id/cancel', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      deps.authz.requirePermission(ctx, 'payout.request');
      const id = extractParam(req.params.id, 'id');
      const parsed = CancelPayoutRequestInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const idemKey = req.header('idempotency-key');
      if (idemKey) {
        const cmd = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
          return withIdempotency(
            tx,
            ctx,
            { key: idemKey, method: 'POST', path: req.originalUrl || `/v1/payout-requests/${id}/cancel`, body: parsed.data },
            async () => {
              const result = await service.cancelPayoutRequest(tx, ctx, id, parsed.data);
              return { status: 200, body: result };
            },
          );
        });
        if (cmd.replayed) res.setHeader('Idempotent-Replayed', 'true');
        return res.status(cmd.status).json(cmd.body);
      }

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.cancelPayoutRequest(tx, ctx, id, parsed.data);
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-PAY-004: POST /v1/payout-requests/:id/payment
  router.post('/payout-requests/:id/payment', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      deps.authz.requirePermission(ctx, 'payout.record_payment');
      deps.authz.requireStepUp(ctx);
      const id = extractParam(req.params.id, 'id');
      const parsed = RecordPaymentInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const idemKey = req.header('idempotency-key');
      if (idemKey) {
        const cmd = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
          return withIdempotency(
            tx,
            ctx,
            { key: idemKey, method: 'POST', path: req.originalUrl || `/v1/payout-requests/${id}/payment`, body: parsed.data },
            async () => {
              const result = await service.recordPayoutPayment(tx, ctx, id, parsed.data);
              return { status: 200, body: result };
            },
          );
        });
        res.setHeader('ETag', `"${cmd.body.lockVersion}"`);
        if (cmd.replayed) res.setHeader('Idempotent-Replayed', 'true');
        return res.status(cmd.status).json(cmd.body);
      }

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.recordPayoutPayment(tx, ctx, id, parsed.data);
      });
      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-PAY-005: POST /v1/payout-requests/:id/payment-failure
  router.post('/payout-requests/:id/payment-failure', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      deps.authz.requirePermission(ctx, 'payout.record_payment');
      const id = extractParam(req.params.id, 'id');
      const parsed = RecordPaymentFailureInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const idemKey = req.header('idempotency-key');
      if (idemKey) {
        const cmd = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
          return withIdempotency(
            tx,
            ctx,
            { key: idemKey, method: 'POST', path: req.originalUrl || `/v1/payout-requests/${id}/payment-failure`, body: parsed.data },
            async () => {
              const result = await service.recordPayoutFailure(tx, ctx, id, parsed.data);
              return { status: 200, body: result };
            },
          );
        });
        res.setHeader('ETag', `"${cmd.body.lockVersion}"`);
        if (cmd.replayed) res.setHeader('Idempotent-Replayed', 'true');
        return res.status(cmd.status).json(cmd.body);
      }

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.recordPayoutFailure(tx, ctx, id, parsed.data);
      });
      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // --- PAYOUT BATCHES ---

  // API-PAY-006: POST /v1/payout-batches
  router.post('/payout-batches', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      deps.authz.requirePermission(ctx, 'payout.record_payment');
      const parsed = CreatePayoutBatchInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const idemKey = req.header('idempotency-key');
      if (idemKey) {
        const cmd = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
          return withIdempotency(
            tx,
            ctx,
            { key: idemKey, method: 'POST', path: req.originalUrl || '/v1/payout-batches', body: parsed.data },
            async () => {
              const result = await service.createPayoutBatch(tx, ctx, parsed.data);
              return { status: 201, body: result };
            },
          );
        });
        if (cmd.replayed) res.setHeader('Idempotent-Replayed', 'true');
        return res.status(cmd.status).json(cmd.body);
      }

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.createPayoutBatch(tx, ctx, parsed.data);
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-PAY-007: GET /v1/payout-batches/:id/bank-file
  router.get('/payout-batches/:id/bank-file', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      deps.authz.requirePermission(ctx, 'payout.record_payment');
      deps.authz.requireStepUp(ctx);
      const id = extractParam(req.params.id, 'id');
      const fileData = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.getPayoutBatchBankFile(tx, ctx, id);
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${fileData.filename}"`);
      res.setHeader('X-Checksum-SHA256', fileData.sha256);
      res.send(fileData.buffer);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
