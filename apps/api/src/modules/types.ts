import type {
  ApplicationPort,
  AuditPort,
  ComplaintSubjectPort,
  LenderPort,
  ProductVersionPort,
  Authz,
  Clock,
  ConsentPort,
  DataSharingPort,
  DecisionPort,
  IdGenerator,
  OutboxPort,
  PartyPort,
  TaskPort,
  Tx,
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
  /** Confirms a lender exists in the tenant, for complaint referrals. Provided by origination/catalogue. */
  lenderPort?: LenderPort;
  taskPort?: TaskPort;
  userDirectoryPort?: UserDirectoryPort;
  userDirectory: UserDirectoryPort;
  consentPort?: ConsentPort;
  dataSharingPort?: DataSharingPort;
  clock?: Clock;
  leadRepository?: unknown;
  customerRepository?: unknown;
  taskRepository?: unknown;
  partyPort?: PartyPort;
  sanctionRepository?: unknown;
  apiKeyStore?: unknown;
  partnerService?: unknown;
  /** Where API clients are stored (ApiClientRepository). Without it the service keeps them in memory, for unit tests only. */
  apiClientRepository?: unknown;
  webhookService?: unknown;
  targetRepository?: unknown;
  reportingRepository?: unknown;
  importRepository?: unknown;
  workforceRepository?: unknown;
  invoiceRepository?: unknown;
  /** Where document bytes are stored (MOD-DOC). Local folder when absent. */
  documentStore?: unknown;
  /** Secret behind signed document links and archive encryption (derived keys). A per-process secret when absent. */
  documentLinkSecret?: string;
  /** Queues background work in the caller's transaction (platform job queue, run per tenant by the worker). */
  enqueueJob?: (
    tx: Tx,
    tenantId: string,
    jobType: string,
    payload: Record<string, unknown>,
    runAt?: Date,
  ) => Promise<string>;
}

export interface ApiModule {
  /** Folder under src/modules. */
  name: string;
  /** v1.2 Assignment Matrix §4. */
  owner: string;
  /** Mounted under /v1. Each router declares its own resource paths (e.g. /leads). */
  createRouter(deps: ApiDeps): Router;
}
