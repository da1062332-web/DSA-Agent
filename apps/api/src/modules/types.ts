import type {
  ApplicationPort,
  AuditPort,
  ComplaintSubjectPort,
  ProductVersionPort,
  Authz,
  Clock,
  ConsentPort,
  DecisionPort,
  IdGenerator,
  OutboxPort,
  TaskPort,
  TxRunner,
  UserDirectoryPort,
} from '@dsa/contracts';
import type { Router } from 'express';

/** Dependencies handed to every module router.
 *  Ports and services are optional and resolve to real/fallback when not passed. */
export interface ApiDeps {
  txRunner: TxRunner;
  authz: Authz;
  auditPort?: AuditPort;
  audit: AuditPort;
  outboxPort?: OutboxPort;
  idGenerator?: IdGenerator;
  ids: IdGenerator;
  decisionPort?: DecisionPort;
  applicationPort?: ApplicationPort;
  /** Confirms complaint subjects exist in the caller tenant (MOD-GRV). Required for complaint intake; fails closed without it. */
  complaintSubjectPort?: ComplaintSubjectPort;
  /** Checks a product version for an application transition (T-APP-01). Provided by origination/catalogue. */
  productVersionPort?: ProductVersionPort;
  taskPort?: TaskPort;
  userDirectoryPort?: UserDirectoryPort;
  userDirectory: UserDirectoryPort;
  consentPort?: ConsentPort;
  clock?: Clock;
  leadRepository?: unknown;
  customerRepository?: unknown;
  taskRepository?: unknown;
  partyPort?: unknown;
  sanctionRepository?: unknown;
}

export interface ApiModule {
  /** Folder under src/modules. */
  name: string;
  /** v1.2 Assignment Matrix §4. */
  owner: string;
  /** Mounted under /v1. Each router declares its own resource paths (e.g. /leads). */
  createRouter(deps: ApiDeps): Router;
}
