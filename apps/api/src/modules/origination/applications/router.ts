// Module: origination/applications — owner: Dev 3 (MOD-APP Loan Applications, Module 16). APIs: API-APP-002, 003, 004,
// 010 (applications.ts), API-APP-005 transitions (transitions.ts; T-APP-01, 02, 04, 08, 09, 10), API-APP-001 create,
// 006 parties and 011 assignments (parties.ts), P1-03 collateral (collateral.ts), status history (history.ts). Lead conversion also creates applications, through ApplicationPort.
import { Router } from 'express';
import type { ApiDeps } from '../../types';
import { registerApplicationRoutes } from './applications';
import { registerChecklistRoutes } from './checklist';
import { registerCollateralRoutes } from './collateral';
import { registerDocumentRoutes } from './documents';
import { registerEligibilityRoutes } from './eligibility';
import { registerHistoryRoutes } from './history';
import { registerLenderMatchRoutes } from './lender-matches';
import { registerLenderPackRoutes } from './lender-pack';
import { registerPartyRoutes } from './parties';
import { registerStatusLinkRoutes } from './status-link';
import { registerTransitionRoutes } from './transitions';

export function createRouter(deps: ApiDeps): Router {
  const router = Router();
  registerPartyRoutes(router, deps);
  registerCollateralRoutes(router, deps);
  registerHistoryRoutes(router, deps);
  registerApplicationRoutes(router, deps);
  registerTransitionRoutes(router, deps);
  registerEligibilityRoutes(router, deps);
  registerLenderMatchRoutes(router, deps); // P1-04 (Dipanshu)
  registerLenderPackRoutes(router, deps); // P2-04 (Dipanshu)
  registerChecklistRoutes(router, deps);
  registerDocumentRoutes(router, deps);
  registerStatusLinkRoutes(router, deps);
  return router;
}
