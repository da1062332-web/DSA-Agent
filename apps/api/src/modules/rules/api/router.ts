// Module: rules/api — owner: Dev 6 (MOD-07 Rules, lifecycle). Tasks: TASK-206, TASK-207, TASK-435 (Developer 6 page).
// APIs: API-BRE-001 · 002 · 003 · 004 · 005 · 007 · 008 · 009 · 010 · 011 · 015 · 016 · 017 · 018 · 023 · 024,
// restored: API-BRE-025 · 026 (+027). Approve/publish/suspend need step-up (aal2 + TOTP ≤ 900 s) and SOD-01.
// Consumes the engine through ports only (RuleRepositoryPort, ValidatorPort from Dev 2).
import { Router } from 'express';
import type { ApiDeps } from '../../types';

export function createRouter(_deps: ApiDeps): Router {
  const router = Router();
  return router;
}
