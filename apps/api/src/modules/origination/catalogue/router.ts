// apps/api/src/modules/origination/catalogue/router.ts — owner: Developer 5 (Bhushan)
// APIs: API-LND-001..006, API-PRD-001..005
import {
  AppError,
  CreateEmpanelmentInputSchema,
  CreateLenderInputSchema,
  CreateProductInputSchema,
  CreateProductVersionInputSchema,
  LenderListQuerySchema,
  ProductListQuerySchema,
  SetLenderContactsInputSchema,
  UpdateEmpanelmentInputSchema,
  UpdateLenderInputSchema,
  UpdateProductStatusInputSchema,
  type RequestContext,
} from '@dsa/contracts';
import { Router, type Request, type Response } from 'express';
import type { ZodError } from 'zod';
import type { ApiDeps } from '../../types';
import { CatalogueService } from './catalogue-service';
import { SqlCatalogueRepository } from './repository';

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
  const repository = new SqlCatalogueRepository();
  const service = new CatalogueService({ repository, audit: deps.audit });

  // --- LENDERS ---

  // API-LND-001: POST /v1/lenders
  router.post('/lenders', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const parsed = CreateLenderInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.createLender(tx, ctx, parsed.data);
      });
      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-LND-002: GET /v1/lenders
  router.get('/lenders', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const queryParsed = LenderListQuerySchema.safeParse(req.query);
      if (!queryParsed.success) handleZodError(queryParsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.listLenders(tx, ctx, queryParsed.data);
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/lenders/:id
  router.get('/lenders/:id', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id);
      const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.getLender(tx, ctx, id);
      });
      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-LND-003: PATCH /v1/lenders/:id
  router.patch('/lenders/:id', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id);
      const lockVersion = extractIfMatch(req);
      const parsed = UpdateLenderInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.updateLender(tx, ctx, id, lockVersion, parsed.data);
      });
      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-LND-004: POST /v1/lenders/:id/empanelments
  router.post('/lenders/:id/empanelments', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id);
      const parsed = CreateEmpanelmentInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.createEmpanelment(tx, ctx, id, parsed.data);
      });
      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/lenders/:id/empanelments
  router.get('/lenders/:id/empanelments', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id);
      const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.listEmpanelments(tx, ctx, id);
      });
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/empanelments/:id
  router.get('/empanelments/:id', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id);
      const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.getEmpanelment(tx, ctx, id);
      });
      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-LND-005: PATCH /v1/empanelments/:id
  router.patch('/empanelments/:id', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id);
      const lockVersion = extractIfMatch(req);
      const parsed = UpdateEmpanelmentInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.updateEmpanelment(tx, ctx, id, lockVersion, parsed.data);
      });
      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-LND-006: PUT /v1/lenders/:id/contacts
  router.put('/lenders/:id/contacts', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id);
      const parsed = SetLenderContactsInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.setLenderContacts(tx, ctx, id, parsed.data);
      });
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/lenders/:id/contacts
  router.get('/lenders/:id/contacts', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id);
      const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.listLenderContacts(tx, ctx, id);
      });
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  // --- LOAN PRODUCTS ---

  // API-PRD-001: POST /v1/products
  router.post('/products', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const parsed = CreateProductInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.createProduct(tx, ctx, parsed.data);
      });
      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-PRD-002: GET /v1/products
  router.get('/products', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const queryParsed = ProductListQuerySchema.safeParse(req.query);
      if (!queryParsed.success) handleZodError(queryParsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.listProducts(tx, ctx, queryParsed.data);
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/products/:id
  router.get('/products/:id', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id);
      const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.getProduct(tx, ctx, id);
      });
      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-PRD-005: POST /v1/products/:id/status
  router.post('/products/:id/status', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id);
      const parsed = UpdateProductStatusInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.updateProductStatus(tx, ctx, id, parsed.data);
      });
      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-PRD-003: POST /v1/products/:id/versions
  router.post('/products/:id/versions', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id);
      const parsed = CreateProductVersionInputSchema.safeParse(req.body);
      if (!parsed.success) handleZodError(parsed.error);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.createProductVersion(tx, ctx, id, parsed.data);
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-PRD-004: GET /v1/product-versions/:id
  router.get('/product-versions/:id', async (req: Request, res: Response, next) => {
    try {
      const ctx = getRequestContext(req);
      const id = extractParam(req.params.id);
      const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.getProductVersion(tx, ctx, id);
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
