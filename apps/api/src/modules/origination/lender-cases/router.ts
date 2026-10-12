// Module: origination/lender-cases — owner: Dev 4 (MOD-11 Lender cases). Tasks: TASK-306, TASK-307.
// APIs: API-LCS-001 · 002 · 003 · 004 · 005. Gates: SHARE_WITH_LENDER consent, empanelment, lender not paused.
// Provides: LENDER_CASE ScopeResolver. Consumes: ApplicationPort, ConsentPort, DataSharingPort, TaskPort.
import { Router } from 'express';
import type { ApiDeps } from '../../types';

export function createRouter(_deps: ApiDeps): Router {
  const router = Router();
  return router;
}
