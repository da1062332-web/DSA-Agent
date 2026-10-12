import type { TxRunner } from '@dsa/contracts';
import type { Router } from 'express';

/** Dependencies handed to every module router.
 *  TODO(TASK-101/TASK-104, Dev 1): add the kernel services (Authz, AuditPort, OutboxPort, IdGenerator) and the
 *  port registry, where each port is chosen per PORT_<NAME>=fake|real|noop. */
export interface ApiDeps {
  txRunner: TxRunner;
}

export interface ApiModule {
  /** Folder under src/modules. */
  name: string;
  /** v1.2 Assignment Matrix §4. */
  owner: string;
  /** Mounted under /v1. Each router declares its own resource paths (e.g. /leads). */
  createRouter(deps: ApiDeps): Router;
}
