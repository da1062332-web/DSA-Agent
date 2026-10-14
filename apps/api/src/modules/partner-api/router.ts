// apps/api/src/modules/partner-api/router.ts — owner: Akash (Module 37: API Development MOD-DEV)
import {
  AppError,
  CreateApiKeySchema,
  PartnerCreateLeadSchema,
  PartnerListLeadsQuerySchema,
  PartnerCreateApplicationSchema,
  PartnerUploadSessionRequestSchema,
  CreateWebhookSubscriptionSchema,
  SandboxEchoRequestSchema,
  SandboxSimulateEventRequestSchema,
  type RequestContext,
} from '@dsa/contracts';
import { Router, type Request, type Response } from 'express';
import type { ApiDeps } from '../types';
import {
  createPartnerAuthMiddleware,
  DatabaseApiKeyStore,
  InMemoryApiKeyStore,
  type ApiKeyStore,
} from './auth-middleware';
import { PartnerApiService } from './service';
import { WebhookDeliveryService } from './webhook-service';

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

function paramStr(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val[0] ?? '';
  return val ?? '';
}

export function createRouter(
  deps: ApiDeps,
  overrides?: {
    apiKeyStore?: ApiKeyStore;
    partnerService?: PartnerApiService;
    webhookService?: WebhookDeliveryService;
  },
): Router {
  const router = Router();
  const apiKeyStore =
    overrides?.apiKeyStore ??
    (deps.apiKeyStore as ApiKeyStore) ??
    ((deps as unknown as { db?: unknown }).db ? new DatabaseApiKeyStore(deps) : new InMemoryApiKeyStore());
  const partnerService = overrides?.partnerService ?? (deps.partnerService as PartnerApiService) ?? new PartnerApiService(deps, apiKeyStore);
  const webhookService = overrides?.webhookService ?? (deps.webhookService as WebhookDeliveryService) ?? new WebhookDeliveryService(deps);

  // Apply Partner API key auth middleware
  router.use('/partner', createPartnerAuthMiddleware(apiKeyStore));

  // ==========================================================================
  // API Keys (ENT-121)
  // ==========================================================================

  router.post('/partner/api-keys', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const input = CreateApiKeySchema.parse(req.body);
      const result = await partnerService.createApiKey(ctx, input);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // ==========================================================================
  // API-DEV-001 - API-DEV-003: Leads
  // ==========================================================================

  router.post('/partner/leads', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const idemKey = requireIdempotencyKey(req);
      const input = PartnerCreateLeadSchema.parse(req.body);

      const { lead, isReplayed } = await partnerService.ingestLead(ctx, input, idemKey);

      if (isReplayed) res.setHeader('Idempotent-Replayed', 'true');
      res.status(isReplayed ? 200 : 201).json(lead);
    } catch (err) {
      next(err);
    }
  });

  router.get('/partner/leads/:id', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const lead = await partnerService.getLead(ctx, paramStr(req.params.id));
      res.json(lead);
    } catch (err) {
      next(err);
    }
  });

  router.get('/partner/leads', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const query = PartnerListLeadsQuerySchema.parse(req.query);
      const result = await partnerService.listLeads(ctx, query);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // ==========================================================================
  // API-DEV-004 - API-DEV-006: Applications & Offers
  // ==========================================================================

  router.post('/partner/applications', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const idemKey = requireIdempotencyKey(req);
      const input = PartnerCreateApplicationSchema.parse(req.body);

      const { application, isReplayed } = await partnerService.createApplication(ctx, input, idemKey);

      if (isReplayed) res.setHeader('Idempotent-Replayed', 'true');
      res.status(isReplayed ? 200 : 201).json(application);
    } catch (err) {
      next(err);
    }
  });

  router.get('/partner/applications/:id', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const app = await partnerService.getApplication(ctx, paramStr(req.params.id));
      res.json(app);
    } catch (err) {
      next(err);
    }
  });

  router.get('/partner/applications/:id/offers', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const offers = await partnerService.getApplicationOffers(ctx, paramStr(req.params.id));
      res.json(offers);
    } catch (err) {
      next(err);
    }
  });

  // ==========================================================================
  // API-DEV-007: Document Upload Session
  // ==========================================================================

  router.post('/partner/applications/:id/documents/upload-session', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const idemKey = requireIdempotencyKey(req);
      const input = PartnerUploadSessionRequestSchema.parse({
        ...req.body,
        applicationId: paramStr(req.params.id),
      });

      const session = await partnerService.createUploadSession(ctx, input, idemKey);
      res.status(201).json(session);
    } catch (err) {
      next(err);
    }
  });

  // ==========================================================================
  // API-DEV-008 - API-DEV-010: Webhook Subscriptions
  // ==========================================================================

  router.post('/partner/webhooks/subscriptions', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const input = CreateWebhookSubscriptionSchema.parse(req.body);
      const subscription = await webhookService.createSubscription(ctx, input);
      res.status(201).json(subscription);
    } catch (err) {
      next(err);
    }
  });

  router.get('/partner/webhooks/subscriptions', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const subs = await webhookService.listSubscriptions(ctx);
      res.json({ data: subs });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/partner/webhooks/subscriptions/:id', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      await webhookService.deleteSubscription(ctx, paramStr(req.params.id));
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // ==========================================================================
  // API-DEV-011 - API-DEV-012: Developer Sandbox & Diagnostics
  // ==========================================================================

  router.post('/partner/sandbox/echo', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const body = SandboxEchoRequestSchema.parse(req.body);

      res.json({
        status: 'ok',
        timestamp: ctx.now.toISOString(),
        partnerId: ctx.principal.id,
        tenantId: ctx.principal.tenantId,
        receivedHeaders: req.headers,
        echo: body.payload ?? { message: body.message },
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/partner/sandbox/simulate-event', async (req: Request, res: Response, next) => {
    try {
      const ctx = requireContext(req);
      const input = SandboxSimulateEventRequestSchema.parse(req.body);
      const result = await webhookService.simulateEvent(ctx, input);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
