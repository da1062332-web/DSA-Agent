import type { AuditPort, Authz, IdGenerator, TxRunner, UserDirectoryPort } from '@dsa/contracts';
import type { Router } from 'express';

/** Dependencies handed to every module router.
 *  TODO(TASK-105, Dev 1): add OutboxPort and the port registry (PORT_<NAME>=fake|real|noop). */
export interface ApiDeps {
  txRunner: TxRunner;
  authz: Authz;
  audit: AuditPort;
  ids: IdGenerator;
  userDirectory: UserDirectoryPort;
}

export interface ApiModule {
  /** Folder under src/modules. */
  name: string;
  /** v1.2 Assignment Matrix §4. */
  owner: string;
  /** Mounted under /v1. Each router declares its own resource paths (e.g. /leads). */
  createRouter(deps: ApiDeps): Router;
}
