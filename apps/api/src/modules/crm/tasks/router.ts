// Module: crm/tasks — owner: Dev 6 (MOD-08 Tasks). Task: TASK-302 (Developer 6 page).
// APIs: API-TASK-001 · 002 · 004. Provides: TaskPort (real), TASK ScopeResolver.
// Consumes: DecisionPort (DK-sla.target), UserDirectoryPort.
import { Router } from 'express';
import type { ApiDeps } from '../../types';

export function createRouter(_deps: ApiDeps): Router {
  const router = Router();
  return router;
}
