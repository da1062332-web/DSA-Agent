// Module: platform — owner: Dev 1 (MOD-01 Kernel · MOD-02 Platform and access).
// Tasks: TASK-102 (JWT middleware + GET /v1/me), TASK-104 (authz, UserDirectoryPort, branches), TASK-435-D.
// APIs: API-USR-010 GET /v1/me (PA-01) · API-ORG-004 branch list · API-ORG-012 work-queue list (restored).
// Endpoint contracts: the owning task's page in the 4-Day Task Register.
import { Router } from 'express';
import type { ApiDeps } from '../types';

export function createRouter(_deps: ApiDeps): Router {
  const router = Router();
  return router;
}
