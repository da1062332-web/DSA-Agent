// Module: crm/leads — owner: Dev 5 (MOD-04 Leads). Tasks: TASK-107..110 (Developer 5 page).
// APIs: API-LEAD-001 · 002 · 003 · 005 · 007 (atomic conversion) · 015 (PA-04, POST /v1/leads/{id}/consents).
// Consumes: DecisionPort (duplicate, routing), TaskPort (first-contact task), ApplicationPort (conversion),
// UserDirectoryPort. Provides: LEAD ScopeResolver.
import { Router } from 'express';
import type { ApiDeps } from '../../types';

export function createRouter(_deps: ApiDeps): Router {
  const router = Router();
  return router;
}
