// Module: platform — owner: Dev 1 (MOD-01 Kernel · MOD-02 Platform and access).
// Tasks: TASK-102 (GET /v1/me), TASK-104 (authz, UserDirectoryPort, branches), TASK-412 / TASK-435 (org admin).
// APIs: API-USR-010 /v1/me · /v1/users · /v1/tenant · API-ORG-001…014 (organisation, branches, teams, work queues).
// Endpoint contracts: the owning task's page in the 4-Day Task Register.
import { Router } from 'express';
import type { ApiDeps } from '../types';
import { registerBranchRoutes } from './branches';
import { registerOrganisationRoutes } from './organisation';
import { registerQueueRoutes } from './queues';
import { registerTeamRoutes } from './teams';
import { registerUserRoutes } from './users';

export function createRouter(deps: ApiDeps): Router {
  const router = Router();
  registerUserRoutes(router, deps);
  registerOrganisationRoutes(router, deps);
  registerBranchRoutes(router, deps);
  registerTeamRoutes(router, deps);
  registerQueueRoutes(router, deps);
  return router;
}
