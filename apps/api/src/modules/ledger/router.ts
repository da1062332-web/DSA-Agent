// apps/api/src/modules/ledger/router.ts — MOD-LED Ledger Management (API-LED-001..006)
import {
  AppError,
  CloseLedgerPeriodInputSchema,
  CreateLedgerAccountInputSchema,
  CreateLedgerExportInputSchema,
  GetAccountBalanceQuerySchema,
  GetConnectorStatementsQuerySchema,
  ListLedgerAccountsQuerySchema,
  ListLedgerJournalsQuerySchema,
  PostJournalInputSchema,
  type RequestContext,
  type Tx,
} from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import { Router, type Request, type Response } from 'express';
import type { ZodError } from 'zod';
import type { ApiDeps } from '../types';
import { LedgerService } from './ledger-service';
import { SqlLedgerRepository } from './repository';

function getRequestContext(req: Request): RequestContext {
  if (!req.ctx) {
    throw AppError.of('UNAUTHENTICATED', 'No request authentication context.');
  }
  return req.ctx;
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
  const repository = new SqlLedgerRepository();
  const service = new LedgerService({
    repository,
    audit: deps.audit,
    outbox: deps.outboxPort,
  });

  // API-LED-001: GET /ledger/accounts
  router.get('/ledger/accounts', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const parsed = ListLedgerAccountsQuerySchema.safeParse({
        ...req.query,
        isActive: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined,
      });
      if (!parsed.success) handleZodError(parsed.error);

      const accounts = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.listAccounts(tx, ctx, parsed.data);
      });
      res.json({ data: accounts });
    } catch (err) {
      next(err);
    }
  });

  // POST /ledger/accounts
  router.post('/ledger/accounts', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const parsed = CreateLedgerAccountInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.createAccount(tx, ctx, parsed.data);
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-LED-002: GET /ledger/journals
  router.get('/ledger/journals', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const parsed = ListLedgerJournalsQuerySchema.safeParse({
        ...req.query,
        limit: req.query.limit ? parseInt(String(req.query.limit), 10) : undefined,
      });
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.listJournals(tx, ctx, parsed.data);
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // System/Manual Posting: POST /ledger/journals
  router.post('/ledger/journals', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const parsed = PostJournalInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const idempotencyKey = req.header('Idempotency-Key') || parsed.data.idempotencyKey;
      const input = { ...parsed.data, idempotencyKey };

      if (idempotencyKey) {
        const cmd = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
          if (typeof (tx as any)?.execute === 'function') {
            return withIdempotency(
              tx,
              ctx,
              {
                key: idempotencyKey,
                method: 'POST',
                path: req.originalUrl || '/v1/ledger/journals',
                body: input,
              },
              async () => {
                const result = await service.postJournal(tx, ctx, input);
                return { status: 201, body: result };
              },
            );
          }
          const result = await service.postJournal(tx, ctx, input);
          return { status: 201, body: result };
        });
        res.status(cmd.status).json(cmd.body);
      } else {
        const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
          return service.postJournal(tx, ctx, input);
        });
        res.status(201).json(result);
      }
    } catch (err) {
      next(err);
    }
  });

  // API-LED-003: POST /ledger/periods/:period/close
  router.post('/ledger/periods/:period/close', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const period = Array.isArray(req.params.period) ? req.params.period[0] : req.params.period;
      if (!period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
        throw AppError.of('VALIDATION_ERROR', 'Period must be in YYYY-MM format');
      }
      const parsed = CloseLedgerPeriodInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const idempotencyKey = req.header('Idempotency-Key');
      if (idempotencyKey) {
        const cmd = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
          if (typeof (tx as any)?.execute === 'function') {
            return withIdempotency(
              tx,
              ctx,
              {
                key: idempotencyKey,
                method: 'POST',
                path: req.originalUrl || `/v1/ledger/periods/${period}/close`,
                body: parsed.data,
              },
              async () => {
                const result = await service.closePeriod(tx, ctx, period, parsed.data);
                return { status: 200, body: result };
              },
            );
          }
          const result = await service.closePeriod(tx, ctx, period, parsed.data);
          return { status: 200, body: result };
        });
        res.status(cmd.status).json(cmd.body);
      } else {
        const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
          return service.closePeriod(tx, ctx, period, parsed.data);
        });
        res.json(result);
      }
    } catch (err) {
      next(err);
    }
  });

  // API-LED-004: GET /ledger/accounts/:id/balance
  router.get('/ledger/accounts/:id/balance', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!id) throw AppError.of('VALIDATION_ERROR', 'Account id required');

      const parsed = GetAccountBalanceQuerySchema.safeParse(req.query);
      if (!parsed.success) handleZodError(parsed.error);

      const balance = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.getAccountBalance(tx, ctx, id, parsed.data);
      });
      res.json(balance);
    } catch (err) {
      next(err);
    }
  });

  // API-LED-005: GET /connectors/:id/statements
  router.get('/connectors/:id/statements', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!id) throw AppError.of('VALIDATION_ERROR', 'Connector id required');

      const parsed = GetConnectorStatementsQuerySchema.safeParse({
        ...req.query,
        limit: req.query.limit ? parseInt(String(req.query.limit), 10) : undefined,
      });
      if (!parsed.success) handleZodError(parsed.error);

      const statement = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.getConnectorStatements(tx, ctx, id, parsed.data);
      });
      res.json(statement);
    } catch (err) {
      next(err);
    }
  });

  // API-LED-006: POST /ledger/exports
  router.post('/ledger/exports', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const parsed = CreateLedgerExportInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.createExport(tx, ctx, parsed.data);
      });
      res.status(202).json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-LED-007: GET /ledger/trial-balance
  router.get('/ledger/trial-balance', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const period = typeof req.query.period === 'string' ? req.query.period : undefined;

      const tb = await deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
        return service.getTrialBalance(tx, ctx, period);
      });
      res.json(tb);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
