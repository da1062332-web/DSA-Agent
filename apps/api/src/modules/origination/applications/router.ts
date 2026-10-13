// Module: origination/applications — owner: Dev 3 (MOD-APP Loan Applications, Module 16). This slice: API-APP-002 list,
// 003 read, 004 edit, 010 hold. Creation is through lead conversion in the MVP; the rest of the module is deferred.
import { Router } from 'express';
import type { ApiDeps } from '../../types';
import { registerApplicationRoutes } from './applications';

export function createRouter(deps: ApiDeps): Router {
  const router = Router();
  registerApplicationRoutes(router, deps);
  return router;
}
