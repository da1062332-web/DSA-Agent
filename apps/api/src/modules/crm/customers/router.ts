// apps/api/src/modules/crm/customers/router.ts — owner: Dev 5 (MOD-CUST Customers). Tasks: TASK-107..110
// APIs: API-CUST-001 (create) · API-CUST-003 (update) · API-CUST-004 (record consent) ·
//       API-CUST-005 (withdraw consent) · API-CUST-006 (reveal) · API-CUST-009 (preferences) · API-CUST-010 (list)
// Provides: PartyPort, ConsentPort, CUSTOMER ScopeResolver
import { AppError, type RequestContext } from '@dsa/contracts';
import { Router, type Request, type Response } from 'express';
import type { ZodError } from 'zod';
import type { ApiDeps } from '../../types';
import { CustomerService } from './customer-service';
import { SqlCustomerRepository, type CustomerRepository } from './repository';
import {
  CreateConsentSchema,
  CreateCustomerSchema,
  CustomerListQuerySchema,
  UpdateCustomerSchema,
  WithdrawConsentSchema,
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

function extractParamId(req: Request, paramName = 'id'): string {
  const id = req.params[paramName];
  if (!id || typeof id !== 'string') {
    throw AppError.of('NOT_FOUND', 'Resource not found');
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

export function createRouter(
  deps: ApiDeps & { customerRepository?: CustomerRepository },
  repoOverride?: CustomerRepository,
): Router {
  const router = Router();
  const repository =
    repoOverride ??
    (deps.customerRepository as CustomerRepository | undefined) ??
    new SqlCustomerRepository();
  const service = new CustomerService({
    repository,
    idGenerator: deps.idGenerator,
  });

  // API-CUST-001: POST /v1/customers — Create Customer
  router.post('/customers', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const idemKey = extractIdempotencyKey(req);

    const parseResult = CreateCustomerSchema.safeParse(req.body);
    if (!parseResult.success) {
      handleZodError(parseResult.error);
    }

    const { resource, etag, isReplayed } = await deps.txRunner.withTenantTx(ctx, async (tx) =>
      service.createCustomer(tx, ctx, parseResult.data, idemKey),
    );

    res.setHeader('ETag', etag);
    if (isReplayed) {
      res.setHeader('Idempotent-Replayed', 'true');
    }
    res.status(201).json(resource);
  });

  // API-CUST-010: GET /v1/customers — List Customers
  router.get('/customers', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);

    const queryResult = CustomerListQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      handleZodError(queryResult.error);
    }

    const result = await deps.txRunner.withTenantTx(ctx, async (tx) =>
      service.listCustomers(tx, ctx, queryResult.data),
    );

    res.status(200).json(result);
  });

  // Detail: GET /v1/customers/:id — Get Customer Detail
  router.get('/customers/:id', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const id = extractParamId(req, 'id');

    const { resource, etag } = await deps.txRunner.withTenantTx(ctx, async (tx) =>
      service.getCustomer(tx, ctx, id),
    );

    res.setHeader('ETag', etag);
    res.status(200).json(resource);
  });

  // API-CUST-003: PATCH /v1/customers/:id — Update Customer Profile
  router.patch('/customers/:id', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const id = extractParamId(req, 'id');
    const ifMatch = extractIfMatch(req);

    const parseResult = UpdateCustomerSchema.safeParse(req.body);
    if (!parseResult.success) {
      handleZodError(parseResult.error);
    }

    const { resource, etag } = await deps.txRunner.withTenantTx(ctx, async (tx) =>
      service.updateCustomer(tx, ctx, id, ifMatch, parseResult.data),
    );

    res.setHeader('ETag', etag);
    res.status(200).json(resource);
  });

  // API-CUST-006: POST /v1/customers/:id/reveal — Reveal Sensitive Profile Fields
  router.post('/customers/:id/reveal', async (_req: Request, _res: Response) => {
    throw AppError.of(
      'FORBIDDEN',
      'Sensitive field reveal is disabled: awaiting approved step-up authentication and privacy infrastructure (TASK-421)',
    );
  });

  // GET /v1/customers/:id/consents — List Customer Consents
  router.get('/customers/:id/consents', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const customerId = extractParamId(req, 'id');

    const result = await deps.txRunner.withTenantTx(ctx, async (tx) =>
      service.listConsents(tx, ctx, customerId),
    );

    res.status(200).json(result);
  });

  // API-CUST-004: POST /v1/customers/:id/consents — Record Customer Consent
  router.post('/customers/:id/consents', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const customerId = extractParamId(req, 'id');
    const idemKey = extractIdempotencyKey(req);

    const parseResult = CreateConsentSchema.safeParse(req.body);
    if (!parseResult.success) {
      handleZodError(parseResult.error);
    }

    const { resource, isReplayed } = await deps.txRunner.withTenantTx(ctx, async (tx) =>
      service.recordConsent(tx, ctx, customerId, parseResult.data, idemKey),
    );

    if (isReplayed) {
      res.setHeader('Idempotent-Replayed', 'true');
    }
    res.status(201).json(resource);
  });

  // API-CUST-005: POST /v1/consents/:id/withdrawal — Withdraw Consent
  router.post('/consents/:id/withdrawal', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const consentId = extractParamId(req, 'id');
    const idemKey = extractIdempotencyKey(req);

    const parseResult = WithdrawConsentSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      handleZodError(parseResult.error);
    }

    const { resource, isReplayed } = await deps.txRunner.withTenantTx(ctx, async (tx) =>
      service.withdrawConsent(tx, ctx, consentId, parseResult.data, idemKey),
    );

    if (isReplayed) {
      res.setHeader('Idempotent-Replayed', 'true');
    }
    res.status(200).json(resource);
  });

  // API-CUST-009: PUT /v1/customers/:id/preferences — Update Communication Preferences
  router.put('/customers/:id/preferences', async (_req: Request, _res: Response) => {
    throw AppError.of(
      'INVALID_STATE',
      'Communication preferences management is deferred to TASK-410 (release R2)',
    );
  });

  return router;
}
