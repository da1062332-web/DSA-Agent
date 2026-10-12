// Module: crm/customers — owner: Dev 5 (MOD-05 Customers). Tasks: TASK-107..110 (Developer 5 page).
// APIs: API-CUST-004 (record consent) · API-CUST-005 (POST /v1/consents/{id}/withdrawal).
// Provides: PartyPort (real), CUSTOMER ScopeResolver.
import { Router } from 'express';
import type { ApiDeps } from '../../types';

export function createRouter(_deps: ApiDeps): Router {
  const router = Router();
  return router;
}
