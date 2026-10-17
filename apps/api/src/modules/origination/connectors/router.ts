// apps/api/src/modules/origination/connectors/router.ts
// Module 27: Connector Management (MOD-CON) — Express Router
import { Router, type Request, type Response } from 'express';
import {
  AppError,
  ActivateConnectorSchema,
  ApproveAttributionChangeRequestSchema,
  ApproveConnectorBankAccountSchema,
  CreateAttributionChangeRequestSchema,
  CreateConnectorAgreementSchema,
  CreateConnectorBankAccountSchema,
  CreateConnectorSchema,
  InviteConnectorUserSchema,
  ListConnectorsQuerySchema,
  ResolveAttributionDisputeSchema,
  UpdateConnectorSchema,
  UpdateConnectorStatusSchema,
  type RequestContext,
} from '@dsa/contracts';
import { ifMatchVersion } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { ConnectorService } from './connector-service';

function requireContext(req: Request): RequestContext {
  const ctx = req.ctx as RequestContext | undefined;
  if (!ctx || !ctx.principal) throw AppError.of('UNAUTHENTICATED', 'Authentication required.');
  return ctx;
}

function requireIdempotencyKey(req: Request): string {
  const key = req.get('Idempotency-Key');
  if (!key) {
    throw AppError.of('VALIDATION_ERROR', 'Idempotency-Key header is required for mutating requests.', [
      { field: 'Idempotency-Key', issue: 'REQUIRED' },
    ]);
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
    throw AppError.of('VALIDATION_ERROR', 'Invalid Idempotency-Key format.', [
      { field: 'Idempotency-Key', issue: 'INVALID_FORMAT' },
    ]);
  }
  return key;
}

export function createRouter(deps: ApiDeps, serviceOverride?: ConnectorService): Router {
  const router = Router();
  const service = serviceOverride ?? new ConnectorService(deps);

  // ==========================================
  // API-CON-001: POST /v1/connectors
  // ==========================================
  router.post('/connectors', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const idemKey = requireIdempotencyKey(req);
      const input = CreateConnectorSchema.parse(req.body);

      const { connector, isReplayed } = await service.createConnector(ctx, input, idemKey);

      res.setHeader('ETag', `"${connector.lockVersion}"`);
      if (isReplayed) res.setHeader('Idempotent-Replayed', 'true');
      res.status(isReplayed ? 200 : 201).json(connector);
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // API-CON-002: GET /v1/connectors
  // ==========================================
  router.get('/connectors', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const query = ListConnectorsQuerySchema.parse(req.query);
      const result = await service.listConnectors(ctx, query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // GET /v1/connectors/:id
  // ==========================================
  router.get('/connectors/:id', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const id = String(req.params.id);
      const connector = await service.getConnector(ctx, id);
      res.setHeader('ETag', `"${connector.lockVersion}"`);
      res.status(200).json(connector);
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // API-CON-003: PATCH /v1/connectors/:id
  // ==========================================
  router.patch('/connectors/:id', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const id = String(req.params.id);
      const ifMatch = ifMatchVersion(req);
      const input = UpdateConnectorSchema.parse(req.body);

      const updated = await service.updateConnector(ctx, id, input, ifMatch);
      res.setHeader('ETag', `"${updated.lockVersion}"`);
      res.status(200).json(updated);
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // API-CON-005: POST /v1/connectors/:id/activation
  // ==========================================
  router.post('/connectors/:id/activation', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const id = String(req.params.id);
      const ifMatch = ifMatchVersion(req);
      const idemKey = requireIdempotencyKey(req);
      const input = ActivateConnectorSchema.parse(req.body);

      const { connector, isReplayed } = await service.activateConnector(ctx, id, input, ifMatch, idemKey);

      res.setHeader('ETag', `"${connector.lockVersion}"`);
      if (isReplayed) res.setHeader('Idempotent-Replayed', 'true');
      res.status(200).json(connector);
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // API-CON-006: POST /v1/connectors/:id/status
  // ==========================================
  router.post('/connectors/:id/status', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const id = String(req.params.id);
      const ifMatch = ifMatchVersion(req);
      const idemKey = requireIdempotencyKey(req);
      const input = UpdateConnectorStatusSchema.parse(req.body);

      const { connector, isReplayed } = await service.updateConnectorStatus(ctx, id, input, ifMatch, idemKey);

      res.setHeader('ETag', `"${connector.lockVersion}"`);
      if (isReplayed) res.setHeader('Idempotent-Replayed', 'true');
      res.status(200).json(connector);
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // GET /v1/connectors/:id/bank-accounts
  // ==========================================
  router.get('/connectors/:id/bank-accounts', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const id = String(req.params.id);
      const accounts = await service.listBankAccounts(ctx, id);
      res.status(200).json({ items: accounts });
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // API-CON-007: POST /v1/connectors/:id/bank-accounts
  // ==========================================
  router.post('/connectors/:id/bank-accounts', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const id = String(req.params.id);
      const idemKey = requireIdempotencyKey(req);
      const input = CreateConnectorBankAccountSchema.parse(req.body);

      const { bankAccount, isReplayed } = await service.createBankAccount(ctx, id, input, idemKey);

      res.setHeader('ETag', `"${bankAccount.lockVersion}"`);
      if (isReplayed) res.setHeader('Idempotent-Replayed', 'true');
      res.status(isReplayed ? 200 : 201).json(bankAccount);
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // Approval for Bank Account (SOD)
  // ==========================================
  router.post(
    '/connectors/:id/bank-accounts/:accountId/approval',
    async (req: Request, res: Response, next) => {
      try {
        const ctx = requireContext(req);
        const id = String(req.params.id);
        const accountId = String(req.params.accountId);
        const input = ApproveConnectorBankAccountSchema.parse(req.body);

        const approved = await service.approveBankAccount(ctx, id, accountId, input);
        res.setHeader('ETag', `"${approved.lockVersion}"`);
        res.status(200).json(approved);
      } catch (err) {
        next(err);
      }
    },
  );

  // ==========================================
  // GET /v1/connectors/:id/agreements
  // ==========================================
  router.get('/connectors/:id/agreements', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const id = String(req.params.id);
      const agreements = await service.listAgreements(ctx, id);
      res.status(200).json({ items: agreements });
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // API-CON-004: POST /v1/connectors/:id/agreements
  // ==========================================
  router.post('/connectors/:id/agreements', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const id = String(req.params.id);
      const idemKey = requireIdempotencyKey(req);
      const input = CreateConnectorAgreementSchema.parse(req.body);

      const { agreement, isReplayed } = await service.createAgreement(ctx, id, input, idemKey);

      res.setHeader('ETag', `"${agreement.lockVersion}"`);
      if (isReplayed) res.setHeader('Idempotent-Replayed', 'true');
      res.status(isReplayed ? 200 : 201).json(agreement);
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // API-CON-011: POST /v1/connectors/:id/users
  // ==========================================
  router.post('/connectors/:id/users', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const id = String(req.params.id);
      const input = InviteConnectorUserSchema.parse(req.body);
      const result = await service.inviteConnectorUser(ctx, id, input);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // GET /v1/attribution-change-requests
  // ==========================================
  router.get('/attribution-change-requests', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const leadId = typeof req.query.leadId === 'string' ? req.query.leadId : undefined;
      const requests = await service.listAttributionChangeRequests(ctx, leadId);
      res.status(200).json({ items: requests });
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // API-CON-009: POST /v1/attribution-change-requests
  // ==========================================
  router.post('/attribution-change-requests', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const idemKey = requireIdempotencyKey(req);
      const input = CreateAttributionChangeRequestSchema.parse(req.body);

      const { request, isReplayed } = await service.createAttributionChangeRequest(ctx, input, idemKey);

      res.setHeader('ETag', `"${request.lockVersion}"`);
      if (isReplayed) res.setHeader('Idempotent-Replayed', 'true');
      res.status(isReplayed ? 200 : 201).json(request);
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // API-CON-010: POST /v1/attribution-change-requests/:id/approval
  // ==========================================
  router.post('/attribution-change-requests/:id/approval', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const id = String(req.params.id);
      const ifMatch = ifMatchVersion(req);
      const input = ApproveAttributionChangeRequestSchema.parse(req.body);

      const approved = await service.approveAttributionChangeRequest(ctx, id, input, ifMatch);
      res.setHeader('ETag', `"${approved.lockVersion}"`);
      res.status(200).json(approved);
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // GET /v1/attribution-disputes
  // ==========================================
  router.get('/attribution-disputes', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const leadId = typeof req.query.leadId === 'string' ? req.query.leadId : undefined;
      const disputes = await service.listAttributionDisputes(ctx, leadId);
      res.status(200).json({ items: disputes });
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // API-CON-008: POST /v1/attribution-disputes/:id/resolution
  // ==========================================
  router.post('/attribution-disputes/:id/resolution', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const id = String(req.params.id);
      const ifMatch = ifMatchVersion(req);
      const input = ResolveAttributionDisputeSchema.parse(req.body);

      const resolved = await service.resolveAttributionDispute(ctx, id, input, ifMatch);
      res.setHeader('ETag', `"${resolved.lockVersion}"`);
      res.status(200).json(resolved);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
