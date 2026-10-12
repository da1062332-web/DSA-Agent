// Module: compliance — owner: Dev 5 (MOD-03 Compliance: consent, data sharing). Tasks: Developer 5 page.
// No public MVP endpoint of its own. Provides: ConsentPort and DataSharingPort (real), CONSENT ScopeResolver.
import { Router } from 'express';
import type { ApiDeps } from '../types';

export function createRouter(_deps: ApiDeps): Router {
  const router = Router();
  return router;
}
