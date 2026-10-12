// Module: crm/activities — owner: Dev 5 (MOD-06 Activity). Tasks: TASK-107..110 (Developer 5 page).
// APIs: API-ACT-001 (contact logging). Free-text fields reject PAN/Aadhaar/account-number patterns (Contracts §12).
import { Router } from 'express';
import type { ApiDeps } from '../../types';

export function createRouter(_deps: ApiDeps): Router {
  const router = Router();
  return router;
}
