// Module: crm/grievances — owner: Dev 3 (MOD-GRV Grievances, Module 13). APIs: API-GRV-001 to 004.
import { Router } from 'express';
import type { ApiDeps } from '../../types';
import { registerComplaintRoutes } from './complaints';

export function createRouter(deps: ApiDeps): Router {
  const router = Router();
  registerComplaintRoutes(router, deps);
  return router;
}
