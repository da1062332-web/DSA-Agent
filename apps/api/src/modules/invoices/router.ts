// apps/api/src/modules/invoices/router.ts — Module 33: Invoices & Statements Router
import {
  AppError,
  CreateInvoiceInputSchema,
  InvoiceListQuerySchema,
  StatementQuerySchema,
  UpdateInvoiceStatusInputSchema,
} from '@dsa/contracts';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { ZodError } from 'zod';
import { requireCtx } from '../../http/request';
import type { ApiDeps } from '../types';
import { SqlInvoiceRepository, type InvoiceRepository } from './repository';
import { InvoiceService } from './service';

function handleZodError(err: ZodError): never {
  const details = err.issues.map((i) => ({
    field: i.path.join('.'),
    issue: i.message,
  }));
  throw AppError.of('VALIDATION_ERROR', 'Request validation failed', details);
}

function parseIfMatch(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const clean = raw.replace(/^W\//, '').replace(/^"|"$/g, '');
  const parsed = parseInt(clean, 10);
  return isNaN(parsed) ? undefined : parsed;
}

export function createRouter(deps: ApiDeps): Router {
  const router = Router();
  const repository = (deps.invoiceRepository as InvoiceRepository) ?? new SqlInvoiceRepository();
  const service = new InvoiceService({
    repository,
    authz: deps.authz,
    audit: deps.audit,
    ids: deps.ids,
  });

  // ==========================================
  // API-INV-001: POST /v1/invoices — Record Invoice
  // ==========================================
  router.post('/invoices', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = requireCtx(req);
      const parsed = CreateInvoiceInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const invoice = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.recordInvoice(tx, ctx, parsed.data);
      });

      res.setHeader('ETag', `"${invoice.lockVersion}"`);
      return res.status(201).json(invoice);
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // API-INV-002: GET /v1/invoices — List Invoices
  // ==========================================
  router.get('/invoices', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = requireCtx(req);
      const parsed = InvoiceListQuerySchema.safeParse(req.query);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.listInvoices(tx, ctx, parsed.data);
      });

      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // GET /v1/invoices/:id — Get Invoice by ID
  // ==========================================
  router.get('/invoices/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = requireCtx(req);
      const invoiceId = String(req.params.id);

      const invoice = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.getInvoice(tx, ctx, invoiceId);
      });

      res.setHeader('ETag', `"${invoice.lockVersion}"`);
      return res.status(200).json(invoice);
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // API-INV-003: POST /v1/invoices/:id/status — Issue, Pay, or Void
  // ==========================================
  router.post('/invoices/:id/status', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = requireCtx(req);
      const invoiceId = String(req.params.id);
      const parsed = UpdateInvoiceStatusInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const ifMatch = req.header('If-Match');
      const lockVersion = parseIfMatch(ifMatch);

      const updated = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.updateInvoiceStatus(
          tx,
          ctx,
          invoiceId,
          parsed.data.status,
          lockVersion,
          parsed.data.notes,
        );
      });

      res.setHeader('ETag', `"${updated.lockVersion}"`);
      return res.status(200).json(updated);
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // API-LED-004: GET /v1/connectors/:id/statements — Connector Statement
  // ==========================================
  router.get('/connectors/:id/statements', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = requireCtx(req);
      const connectorId = String(req.params.id);
      const parsed = StatementQuerySchema.safeParse(req.query);
      if (!parsed.success) handleZodError(parsed.error);

      const statement = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.generateConnectorStatement(tx, ctx, connectorId, parsed.data);
      });

      return res.status(200).json(statement);
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // API-CPT-004: GET /v1/portal/connectors/:id/statements — Portal View
  // ==========================================
  router.get('/portal/connectors/:id/statements', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = requireCtx(req);
      const connectorId = String(req.params.id);
      const parsed = StatementQuerySchema.safeParse(req.query);
      if (!parsed.success) handleZodError(parsed.error);

      const statement = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.generateConnectorStatement(tx, ctx, connectorId, parsed.data);
      });

      return res.status(200).json(statement);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
