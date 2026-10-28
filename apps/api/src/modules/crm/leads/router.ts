// apps/api/src/modules/crm/leads/router.ts — owner: Dev 5 (MOD-04 Leads). Tasks: TASK-107..110
// APIs: API-LEAD-001 (create) · 002 (list) · 003 (detail) · 004 (patch) · 005 (transitions) · 006 (assignments) · 007 (atomic conversion)
// and, in lead-extras.ts, 008/009 (duplicate reviews) · 010/011 (apply links) · 012 (reroute) · 013 (bulk) · 014 (restore)
import { AppError, type RequestContext } from '@dsa/contracts';
import { Router, type Request, type Response } from 'express';
import type { ZodError } from 'zod';
import type { ApiDeps } from '../../types';
import { registerLeadExtraRoutes } from './lead-extras';
import { LeadService } from './lead-service';
import { SqlLeadRepository, type LeadRepository } from './repository';
import {
  AssignLeadInputSchema,
  ConvertLeadInputSchema,
  CreateLeadInputSchema,
  LeadListQuerySchema,
  LeadTransitionInputSchema,
  UpdateLeadInputSchema,
} from './types';

function getRequestContext(req: Request): RequestContext {
  if (!req.ctx) {
    throw AppError.of('UNAUTHENTICATED', 'No request authentication context.');
  }
  return req.ctx;
}

function extractIdempotencyKey(req: Request): string {
  const raw = req.header('Idempotency-Key');
  if (!raw || !/^[A-Za-z0-9_-]{8,128}$/.test(raw)) {
    throw AppError.of('VALIDATION_ERROR', 'A valid Idempotency-Key header is required', [
      { field: 'Idempotency-Key', issue: 'REQUIRED_OR_INVALID_FORMAT' },
    ]);
  }
  return raw;
}

function extractIfMatch(req: Request): string {
  const raw = req.header('If-Match');
  if (!raw) {
    throw AppError.of('VALIDATION_ERROR', 'If-Match header is required for optimistic concurrency', [
      { field: 'If-Match', issue: 'REQUIRED' },
    ]);
  }
  return raw;
}

function extractParamId(req: Request): string {
  const id = req.params.id;
  if (!id || typeof id !== 'string') {
    throw AppError.of('NOT_FOUND', 'Lead not found');
  }
  return id;
}

function handleZodError(err: ZodError): never {
  const details = err.issues.map((i) => ({
    field: i.path.join('.'),
    issue: i.message,
  }));
  throw AppError.of('VALIDATION_ERROR', 'Request validation failed', details);
}

/** The lead service with the API's ports; also used by the public Apply Link form (lead-extras.ts). */
export function createLeadService(
  deps: ApiDeps,
  repository: LeadRepository = new SqlLeadRepository(),
): LeadService {
  return new LeadService({
    repository,
    decisionPort: deps.decisionPort,
    applicationPort: deps.applicationPort,
    taskPort: deps.taskPort,
    userDirectoryPort: deps.userDirectoryPort,
    auditPort: deps.auditPort,
    outboxPort: deps.outboxPort,
    idGenerator: deps.idGenerator,
  });
}

export function createRouter(
  deps: ApiDeps & { leadRepository?: LeadRepository },
  repoOverride?: LeadRepository,
): Router {
  const router = Router();
  const repository = repoOverride ?? deps.leadRepository ?? new SqlLeadRepository();
  const service = createLeadService(deps, repository);
  registerLeadExtraRoutes(router, deps, service, repository);

  // API-LEAD-001: POST /v1/leads — Create Lead
  router.post('/leads', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const idemKey = extractIdempotencyKey(req);

    const parseResult = CreateLeadInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      handleZodError(parseResult.error);
    }

    const { resource, etag, isReplayed } = await deps.txRunner.withTenantTx(ctx, async (tx) =>
      service.createLead(tx, ctx, parseResult.data, idemKey),
    );

    res.setHeader('ETag', etag);
    if (isReplayed) {
      res.setHeader('Idempotent-Replayed', 'true');
    }
    res.status(201).json(resource);
  });

  // API-LEAD-002: GET /v1/leads — List Leads
  router.get('/leads', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);

    const parseResult = LeadListQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      handleZodError(parseResult.error);
    }

    const result = await deps.txRunner.withTenantTx(ctx, async (tx) =>
      service.listLeads(tx, ctx, parseResult.data),
    );

    res.json(result);
  });

  // API-LEAD-003: GET /v1/leads/:id — Lead Detail
  router.get('/leads/:id', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const id = extractParamId(req);

    const { resource, etag } = await deps.txRunner.withTenantTx(ctx, async (tx) =>
      service.getLead(tx, ctx, id),
    );

    res.setHeader('ETag', etag);
    res.json(resource);
  });

  // API-LEAD-004: PATCH /v1/leads/:id — Update Lead
  router.patch('/leads/:id', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const id = extractParamId(req);
    const ifMatch = extractIfMatch(req);

    const parseResult = UpdateLeadInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      handleZodError(parseResult.error);
    }

    const { resource, etag } = await deps.txRunner.withTenantTx(ctx, async (tx) =>
      service.updateLead(tx, ctx, id, ifMatch, parseResult.data),
    );

    res.setHeader('ETag', etag);
    res.json(resource);
  });

  // API-LEAD-005: POST /v1/leads/:id/transitions — State Transition
  router.post('/leads/:id/transitions', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const id = extractParamId(req);
    const ifMatch = extractIfMatch(req);
    const idemKey = extractIdempotencyKey(req);

    const parseResult = LeadTransitionInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      handleZodError(parseResult.error);
    }

    const { resource, etag, isReplayed } = await deps.txRunner.withTenantTx(ctx, async (tx) =>
      service.transitionLead(tx, ctx, id, ifMatch, idemKey, parseResult.data),
    );

    res.setHeader('ETag', etag);
    if (isReplayed) {
      res.setHeader('Idempotent-Replayed', 'true');
    }
    res.json(resource);
  });

  // API-LEAD-006: POST /v1/leads/:id/assignments — Assignment & Routing
  router.post('/leads/:id/assignments', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const id = extractParamId(req);
    const ifMatch = extractIfMatch(req);
    const idemKey = extractIdempotencyKey(req);

    const parseResult = AssignLeadInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      handleZodError(parseResult.error);
    }

    const { resource, etag, isReplayed } = await deps.txRunner.withTenantTx(ctx, async (tx) =>
      service.assignLead(tx, ctx, id, ifMatch, idemKey, parseResult.data),
    );

    res.setHeader('ETag', etag);
    if (isReplayed) {
      res.setHeader('Idempotent-Replayed', 'true');
    }
    res.json(resource);
  });

  router.get('/leads/:id/assignments', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const id = extractParamId(req);
    const data = await deps.txRunner.withTenantTx(ctx, async (tx) =>
      service.listAssignments(tx, ctx, id),
    );
    res.json({ data });
  });

  // API-LEAD-007: POST /v1/leads/:id/conversion — Atomic Conversion (TASK-110)
  router.post(['/leads/:id/conversion', '/leads/:id/conversions'], async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const id = extractParamId(req);
    const ifMatch = extractIfMatch(req);
    const idemKey = extractIdempotencyKey(req);

    const parseResult = ConvertLeadInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      handleZodError(parseResult.error);
    }

    const { result, etag, isReplayed } = await deps.txRunner.withTenantTx(ctx, async (tx) =>
      service.convertLead(tx, ctx, id, ifMatch, idemKey, parseResult.data),
    );

    res.setHeader('ETag', etag);
    if (isReplayed) {
      res.setHeader('Idempotent-Replayed', 'true');
    }
    res.json(result);
  });

  return router;
}
