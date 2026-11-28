import type {
  ApplicationPort,
  AuditPort,
  CommissionPort,
  LenderCaseStatusPort,
  SanctionTranchePort,
  ComplaintSubjectPort,
  LenderPort,
  LenderPolicyPort,
  LenderCasePackagePort,
  ProductVersionPort,
  Authz,
  Clock,
  ConsentPort,
  DataSharingPort,
  DecisionPort,
  IdGenerator,
  BureauPullPort,
  KycCheckPort,
  OutboxPort,
  PartyPort,
  BorrowerFinancialsPort,
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
  /** P2-01: lets invoices and reconciliation read earned commission without entering the finance module. */
  commissionPort?: CommissionPort;
  /** P1-07: the MIS import moves lender cases and records tranches only through these. */
  lenderCaseStatusPort?: LenderCaseStatusPort;
  sanctionTranchePort?: SanctionTranchePort;
  /** Injected in tests so the MIS import paths run without a database; production uses the real repository. */
  misMappingRepository?: unknown;
  /** Confirms complaint subjects exist in the caller tenant (MOD-GRV). Required for complaint intake; fails closed without it. */
  complaintSubjectPort?: ComplaintSubjectPort;
  /** Checks a product version for an application transition (T-APP-01). Provided by origination/catalogue. */
  productVersionPort?: ProductVersionPort;
  /** Confirms a lender exists in the tenant, for complaint referrals. Provided by origination/catalogue. */
  lenderPort?: LenderPort;
  /** The ACTIVE lender policies a match run evaluates (P1-04). Provided by origination/catalogue; matching fails closed without it. */
  lenderPolicyPort?: LenderPolicyPort;
  /** A lender case's current submission package, for the pack download (P2-04). Provided by origination/lender-cases; the
   *  download is refused (503) without it. */
  lenderCasePackagePort?: LenderCasePackagePort;
  /** Where files uploaded through a customer upload link are kept (document-sharing). The pack download reads them through it. */
  customerUploadStore?: { get(tenantId: string, storagePath: string): Promise<Buffer | null> };
  /** Runs provider KYC checks (PAN, GST) for POST /v1/verifications/checks. Provided by integrations. Fails closed (503) without it. */
  kycPort?: KycCheckPort;
  /** Pulls credit-bureau summaries for POST /v1/customers/{id}/credit-reports. Provided by integrations. Fails closed (503) without it. */
  bureauPort?: BureauPullPort;
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
  /** Profile figures of the borrowers on a file, for eligibility and lender matching (2026-11-28). */
  borrowerFinancialsPort?: BorrowerFinancialsPort;
  sanctionRepository?: unknown;
  apiKeyStore?: unknown;
  partnerService?: unknown;
  webhookService?: unknown;
  targetRepository?: unknown;
  reportingRepository?: unknown;
  importRepository?: unknown;
  workforceRepository?: unknown;
  invoiceRepository?: unknown;
  /** Where document bytes are stored (MOD-DOC). Local folder when absent. */
  documentStore?: unknown;
  /** Where uploaded bytes wait for their malware verdict (private; never served). Local folder when absent. */
  documentQuarantineStore?: unknown;
  /** Malware scanner for document uploads (MOD-DOC SUB-DOC.04). The file-signature check only when absent. */
  documentScanner?: unknown;
  /** Secret behind signed document links and archive encryption (derived keys). A per-process secret when absent. */
  documentLinkSecret?: string;
  /** Reads for the customer status link (P3-05). The Postgres implementation when absent. */
  statusLinkRepository?: unknown;
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
