// Module: origination/applications — owner: Dev 3 (MOD-APP Loan Applications, Module 16). APIs: API-APP-002, 003, 004,
// 010 (applications.ts), API-APP-005 transitions (transitions.ts; T-APP-01, 02, 04, 08, 09, 10), API-APP-001 create,
// 006 parties and 011 assignments (parties.ts). Lead conversion also creates applications, through ApplicationPort.
import { Router } from 'express';
import type { ApiDeps } from '../../types';
import { registerApplicationRoutes } from './applications';
import { registerChecklistRoutes } from './checklist';
import { registerDocumentRoutes } from './documents';
import { registerEligibilityRoutes } from './eligibility';
import { registerPartyRoutes } from './parties';
import { registerTransitionRoutes } from './transitions';

export function createRouter(deps: ApiDeps): Router {
  const router = Router();
  registerPartyRoutes(router, deps);
  registerApplicationRoutes(router, deps);
  registerTransitionRoutes(router, deps);
  registerEligibilityRoutes(router, deps);
  registerChecklistRoutes(router, deps);
  registerDocumentRoutes(router, deps);
  return router;
}
