// Production dependencies (owner: Dev 1). server.ts and the database test harnesses build the API from this one function, so
// a port that production needs cannot be missing from the tests, or the other way round. Routes treat several ports as
// required and fail closed (503) without them; test/server-wiring.spec.ts checks that each is provided here.
import type { TxRunner } from '@dsa/contracts';
import {
  createAuditPort,
  createAuthz,
  createIdGenerator,
  createOutboxPort,
  createUserDirectory,
} from '@dsa/kernel';
import { AutomationEngine } from './modules/automation/engine';
import { AutomationTriggerService } from './modules/automation/triggers';
import { createNotificationSubscriber } from './modules/crm/notifications/event-subscriber';
import { createCommissionSubscriber } from './modules/finance/commission-subscriber';
import { PostgresDataSharingPort } from './modules/compliance/data-sharing-port';
import { createConsentPort, createPartyPort } from './modules/crm/customers/consent-port';
import { createBorrowerFinancialsPort } from './modules/crm/customers/borrower-financials-port';
import { createCompositeComplaintSubjectPort } from './modules/crm/leads/subject-port';
import { createTaskPort } from './modules/crm/tasks/task-port';
import { IntegrationRegistry } from './modules/integrations/integration-registry';
import { createBureauPullPort } from './modules/integrations/bureau-port';
import { createKycCheckPort } from './modules/integrations/kyc-port';
import { createApplicationPort } from './modules/origination/applications/application-port';
import { createCommissionPort } from './modules/finance/commission-port';
import { createApplicationSubjectPort } from './modules/origination/applications/subject-port';
import { createLenderPort } from './modules/origination/catalogue/lender-port';
import { createLenderPolicyPort } from './modules/origination/catalogue/lender-policy-port';
import { createLenderCaseStatusPort } from './modules/origination/lender-cases/status-port';
import { createSanctionTranchePort } from './modules/origination/sanctions/tranche-port';
import { SanctionService } from './modules/origination/sanctions/service';
import { SqlSanctionRepository } from './modules/origination/sanctions/repository';
import { SqlLenderCaseRepository } from './modules/origination/lender-cases/repository';
import { createProductVersionPort } from './modules/origination/catalogue/product-version-port';
import { LocalDocumentStorage } from './modules/origination/document-sharing/storage-port';
import { createLenderCasePackagePort } from './modules/origination/lender-cases/package-port';
import { createWebhookOutboxSubscriber } from './modules/partner-api/webhooks';
import { globalJobQueue } from './modules/platform/job-queue';
import type { OutboxSubscriber } from './modules/platform/outbox-relay';
import { LiveDecisionEngine } from './modules/rules/engine/decision-engine';
import type { ApiDeps } from './modules/types';

export function createProductionDeps(
  txRunner: TxRunner,
  options: {
    documentLinkSecret?: string;
    documentStore?: unknown;
    documentQuarantineStore?: unknown;
    documentScanner?: unknown;
  } = {},
): ApiDeps {
  const ids = createIdGenerator();
  const audit = createAuditPort(ids);
  const userDirectory = createUserDirectory();
  const outboxPort = createOutboxPort(ids);
  // The rule engine runs in-process behind DecisionPort (lead duplicate and routing, SLA targets, document checklist).
  const decisionPort = new LiveDecisionEngine();
  // Built before any router, so every consumer (leads, lender cases, automation) gets the same real port.
  const taskPort = createTaskPort({
    decisionPort,
    userDirectoryPort: userDirectory,
    auditPort: audit,
    outboxPort,
    idGenerator: ids,
  });
  const applicationPort = createApplicationPort({ ids, audit });
  const enqueueJob: ApiDeps['enqueueJob'] = (tx, tenantId, jobType, payload, runAt) =>
    globalJobQueue.enqueue(tx, ids.next('job'), tenantId, jobType, payload, runAt);
  const consentPort = createConsentPort();
  const taskPortForCases = taskPort;

  return {
    txRunner,
    authz: createAuthz(),
    audit,
    ids,
    userDirectory,
    outboxPort,
    decisionPort,
    taskPort,
    // Lead conversion creates applications through this port; lender cases read the document checklist through it.
    applicationPort,
    commissionPort: createCommissionPort(),
    // P1-07: a bank's status sheet moves cases and records tranches only through these two ports, inside the
    // batch's own transaction, so it takes the same path as a person's click: same rules, audit and outbox.
    // (Wording note: do not start a sentence in this file with the word that begins an ES module statement.
    // TEST-WIRING-99 strips module statements with a regex that runs to the next semicolon, so such a sentence
    // swallows the code after it and fails the test for a reason that has nothing to do with the code.)
    lenderCaseStatusPort: createLenderCaseStatusPort({
      repository: new SqlLenderCaseRepository(),
      consentPort,
      applicationPort,
      taskPort: taskPortForCases,
      enqueueJob,
    }),
    sanctionTranchePort: createSanctionTranchePort(
      new SanctionService(new SqlSanctionRepository(), txRunner, applicationPort),
    ),
    // Lender packages and submissions fail closed (503) without it: nothing is shared without consent.
    consentPort,
    // Applications created from a customer (API-APP-001) and added parties (API-APP-006) read the customer through it.
    partyPort: createPartyPort(),
    // Lender matching clubs co-applicant income and reads EMIs, age, pincode and vintage from the customer profiles through it.
    borrowerFinancialsPort: createBorrowerFinancialsPort(),
    complaintSubjectPort: createCompositeComplaintSubjectPort({
      application: createApplicationSubjectPort(),
    }),
    productVersionPort: createProductVersionPort(),
    // Complaint referrals confirm the lender exists through this port; without it every referral is refused (503).
    lenderPort: createLenderPort(),
    // Lender matching (P1-04) loads the ACTIVE policies through this port; without it a match run is refused (503).
    lenderPolicyPort: createLenderPolicyPort(),
    // The lender pack download (P2-04) reads the case's frozen package through this port; without it the download is refused (503).
    lenderCasePackagePort: createLenderCasePackagePort(),
    // Customer upload-link files, read by the pack download. The same local store the document-sharing service writes to.
    customerUploadStore: new LocalDocumentStorage(),
    // PAN and GST checks (POST /v1/verifications/checks) run through this port; without it they fail closed (503).
    kycPort: createKycCheckPort({ registry: new IntegrationRegistry() }),
    // Credit-bureau pulls (POST /v1/customers/{id}/credit-reports) run through this port; without it they fail closed (503).
    bureauPort: createBureauPullPort({ registry: new IntegrationRegistry() }),
    dataSharingPort: new PostgresDataSharingPort(),
    documentLinkSecret: options.documentLinkSecret,
    // Document files: an S3-compatible bucket and clamd when configured (config.ts), else local disk and the signature check.
    documentStore: options.documentStore,
    documentQuarantineStore: options.documentQuarantineStore,
    documentScanner: options.documentScanner,
    enqueueJob,
  };
}

/** The outbox relay's subscribers: automation triggers today. Each is idempotent per event id. */
export function createOutboxSubscribers(deps: ApiDeps): OutboxSubscriber[] {
  const automationTriggers = new AutomationTriggerService({
    txRunner: deps.txRunner,
    engine: new AutomationEngine({
      txRunner: deps.txRunner,
      ids: deps.ids,
      auditPort: deps.audit,
      outboxPort: deps.outboxPort,
      decisionPort: deps.decisionPort,
      taskPort: deps.taskPort,
      userDirectoryPort: deps.userDirectory,
    }),
  });
  return [
    (ctx, event) => automationTriggers.handleDomainEvent(ctx, event),
    // Outbound webhooks (MOD-API): one delivery per matching subscription, sent by the WEBHOOK_DELIVERY job.
    createWebhookOutboxSubscriber(deps),
    // In-app notifications for the events that name a recipient (CMP-NTF.01.1).
    createNotificationSubscriber(deps),
    // P2-01: a verified disbursement tranche is priced from the lender's payout grid without anyone pressing calculate.
    createCommissionSubscriber(deps),
  ];
}
