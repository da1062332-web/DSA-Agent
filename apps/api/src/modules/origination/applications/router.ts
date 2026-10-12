// Module: origination/applications — owner: Dev 3 (MOD-10 Applications + interim checklist). Tasks: TASK-303, TASK-304.
// APIs: API-APP-002 · 003 · 004 · 005 · 007 · 013 (PA-03 checklist attestation) · API-APP-008 (restored).
// Provides: ApplicationPort (real), LOAN_APPLICATION ScopeResolver.
// Consumes: DecisionPort (DK-document.requirements, DK-application.completeness), PartyPort, ConsentPort.
import { Router } from 'express';
import type { ApiDeps } from '../../types';

export function createRouter(_deps: ApiDeps): Router {
  const router = Router();
  return router;
}
