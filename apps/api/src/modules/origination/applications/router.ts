// Module: origination/applications — owner: Dev 3 (MOD-APP Loan Applications, Module 16). APIs: API-APP-002, 003, 004,
// 010 (applications.ts) and API-APP-005 transitions (transitions.ts; T-APP-01, 02, 10 only). Creation is through lead
// conversion in the MVP; the rest of the module is deferred.
import { Router } from 'express';
import type { ApiDeps } from '../../types';
import { registerApplicationRoutes } from './applications';
import { registerTransitionRoutes } from './transitions';

export function createRouter(deps: ApiDeps): Router {
  const router = Router();
  registerApplicationRoutes(router, deps);
  registerTransitionRoutes(router, deps);
  return router;
}
