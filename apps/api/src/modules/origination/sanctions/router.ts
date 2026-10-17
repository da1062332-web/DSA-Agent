// apps/api/src/modules/origination/sanctions/router.ts — owner: Dev 3 (MOD-SND Sanctions & Disbursement)
import {
  AppError,
  CancelSanctionRequestSchema,
  ExceptionApprovalRequestSchema,
  RecordSanctionRequestSchema,
  RecordTrancheRequestSchema,
  VerifyTrancheRequestSchema,
  VoidTrancheRequestSchema,
  type RequestContext,
} from '@dsa/contracts';
import { Router, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import type { ApiDeps } from '../../types';
import { SqlSanctionRepository, type SanctionRepository } from './repository';
import { SanctionService } from './service';

function getRequestContext(req: Request): RequestContext {
  if (!req.ctx || !req.ctx.principal) {
    throw AppError.of('UNAUTHENTICATED', 'No request authentication context.');
  }
  return req.ctx;
}

function getParamId(req: Request, paramName = 'id'): string {
  const raw = req.params[paramName];
  if (!raw) return '';
  return Array.isArray(raw) ? raw[0]! : raw;
}

function handleZodError(err: ZodError): never {
  const details = err.issues.map((i) => ({
    field: i.path.join('.'),
    issue: i.message,
  }));
  throw AppError.of('VALIDATION_ERROR', 'Request validation failed', details);
}

export function createRouter(deps: ApiDeps): Router {
  const repo = (deps.sanctionRepository as SanctionRepository) ?? new SqlSanctionRepository();
  const service = new SanctionService(repo, deps.txRunner);

  const router = Router();

  // API-SND-001: Record or Revise Sanction
  router.post('/lender-cases/:id/sanctions', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const lenderCaseId = getParamId(req);

      let body: any;
      try {
        body = RecordSanctionRequestSchema.parse(req.body);
      } catch (err: any) {
        if (err instanceof ZodError) return handleZodError(err);
        throw err;
      }

      const result = await service.recordSanction(ctx, lenderCaseId, body);
      res.setHeader('ETag', `"${result.sanction.lockVersion}"`);
      return res.status(201).json(result.sanction);
    } catch (err) {
      return next(err);
    }
  });

  // List Sanctions for Lender Case
  router.get('/lender-cases/:id/sanctions', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const lenderCaseId = getParamId(req);
      const list = await service.listSanctionsForCase(ctx, lenderCaseId);
      return res.status(200).json({ data: list });
    } catch (err) {
      return next(err);
    }
  });

  // List All Sanctions (Tenant Scope)
  router.get('/sanctions', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const { status, limit } = req.query;
      const list = await service.listAllSanctions(ctx, {
        status: typeof status === 'string' ? status : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.status(200).json({ data: list });
    } catch (err) {
      return next(err);
    }
  });

  // List All Disbursement Tranches (Tenant Scope)
  router.get('/disbursements', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const { status, limit } = req.query;
      const list = await service.listAllTranches(ctx, {
        status: typeof status === 'string' ? status : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.status(200).json({ data: list });
    } catch (err) {
      return next(err);
    }
  });

  // Get Sanction by ID
  router.get('/sanctions/:id', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = getParamId(req);
      const sanction = await service.getSanction(ctx, id);
      res.setHeader('ETag', `"${sanction.lockVersion}"`);
      return res.status(200).json(sanction);
    } catch (err) {
      return next(err);
    }
  });

  // API-SND-005: Cancel Sanction
  router.post('/sanctions/:id/cancellation', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = getParamId(req);

      let body: any;
      try {
        body = CancelSanctionRequestSchema.parse(req.body);
      } catch (err: any) {
        if (err instanceof ZodError) return handleZodError(err);
        throw err;
      }

      const cancelled = await service.cancelSanction(ctx, id, body);
      res.setHeader('ETag', `"${cancelled.lockVersion}"`);
      return res.status(200).json(cancelled);
    } catch (err) {
      return next(err);
    }
  });

  // API-SND-002: Record Disbursement Tranche
  router.post('/sanctions/:id/tranches', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const sanctionId = getParamId(req);

      let body: any;
      try {
        body = RecordTrancheRequestSchema.parse(req.body);
      } catch (err: any) {
        if (err instanceof ZodError) return handleZodError(err);
        throw err;
      }

      const result = await service.recordTranche(ctx, sanctionId, body);
      res.setHeader('ETag', `"${result.tranche.lockVersion}"`);
      return res.status(201).json(result);
    } catch (err) {
      return next(err);
    }
  });

  // List Tranches for Sanction
  router.get('/sanctions/:id/tranches', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const sanctionId = getParamId(req);
      const list = await service.listTranchesForSanction(ctx, sanctionId);
      return res.status(200).json({ data: list });
    } catch (err) {
      return next(err);
    }
  });

  // Get Tranche by ID
  router.get('/tranches/:id', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = getParamId(req);
      const tranche = await service.getTranche(ctx, id);
      res.setHeader('ETag', `"${tranche.lockVersion}"`);
      return res.status(200).json(tranche);
    } catch (err) {
      return next(err);
    }
  });

  // API-SND-003: Verify or Return a Tranche
  router.post('/tranches/:id/verification', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const trancheId = getParamId(req);

      let body: any;
      try {
        body = VerifyTrancheRequestSchema.parse(req.body);
      } catch (err: any) {
        if (err instanceof ZodError) return handleZodError(err);
        throw err;
      }

      const verified = await service.verifyTranche(ctx, trancheId, body);
      res.setHeader('ETag', `"${verified.lockVersion}"`);
      return res.status(200).json(verified);
    } catch (err) {
      return next(err);
    }
  });

  // API-SND-004: Approve Evidence Exception
  router.post('/tranches/:id/exception-approval', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const trancheId = getParamId(req);

      let body: any;
      try {
        body = ExceptionApprovalRequestSchema.parse(req.body);
      } catch (err: any) {
        if (err instanceof ZodError) return handleZodError(err);
        throw err;
      }

      const approved = await service.approveException(ctx, trancheId, body);
      res.setHeader('ETag', `"${approved.lockVersion}"`);
      return res.status(200).json(approved);
    } catch (err) {
      return next(err);
    }
  });

  // API-SND-006: Void and Replace Tranche
  router.post('/tranches/:id/void', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const trancheId = getParamId(req);

      let body: any;
      try {
        body = VoidTrancheRequestSchema.parse(req.body);
      } catch (err: any) {
        if (err instanceof ZodError) return handleZodError(err);
        throw err;
      }

      const result = await service.voidTranche(ctx, trancheId, body);
      res.setHeader('ETag', `"${result.voidedTranche.lockVersion}"`);
      return res.status(200).json(result);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
