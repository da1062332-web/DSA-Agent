// Module: origination/catalogue — owner: Dev 3 (MOD-LND Lenders, MOD-PRD Products). Tasks: Developer 3 page.
// Module 14 Lenders (API-LND-001..006) and Module 15 Products (API-PRD-001..005).
import { Router } from 'express';
import type { ApiDeps } from '../../types';
import { registerContactRoutes } from './contacts';
import { registerLenderRoutes } from './lenders';
import { registerProductRoutes } from './products';

export function createRouter(deps: ApiDeps): Router {
  const router = Router();
  registerLenderRoutes(router, deps);
  registerContactRoutes(router, deps);
  registerProductRoutes(router, deps);
  return router;
}
