// Module: origination/catalogue — owner: Dev 3 (MOD-LND Lenders, MOD-PRD Products). Tasks: Developer 3 page.
// This slice: Module 14 Lenders (API-LND-001..005). Products (API-PRD-001..005) are added next.
import { Router } from 'express';
import type { ApiDeps } from '../../types';
import { registerContactRoutes } from './contacts';
import { registerLenderRoutes } from './lenders';

export function createRouter(deps: ApiDeps): Router {
  const router = Router();
  registerLenderRoutes(router, deps);
  registerContactRoutes(router, deps);
  return router;
}
