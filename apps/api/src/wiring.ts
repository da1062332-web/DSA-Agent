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
import { PostgresDataSharingPort } from './modules/compliance/data-sharing-port';
import { createConsentPort, createPartyPort } from './modules/crm/customers/consent-port';
import { createCompositeComplaintSubjectPort } from './modules/crm/leads/subject-port';
import { createTaskPort } from './modules/crm/tasks/task-port';
import { createApplicationPort } from './modules/origination/applications/application-port';
import { createApplicationSubjectPort } from './modules/origination/applications/subject-port';
import { createLenderPort } from './modules/origination/catalogue/lender-port';
import { createProductVersionPort } from './modules/origination/catalogue/product-version-port';
import { PgApiClientRepository } from './modules/partner-api/api-client-repository';
import { createWebhookOutboxSubscriber } from './modules/partner-api/webhooks';
import { globalJobQueue } from './modules/platform/job-queue';
import type { OutboxSubscriber } from './modules/platform/outbox-relay';
import { LiveDecisionEngine } from './modules/rules/engine/decision-engine';
import type { ApiDeps } from './modules/types';

export function createProductionDeps(
  txRunner: TxRunner,
  options: { documentLinkSecret?: string } = {},
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
    applicationPort: createApplicationPort({ ids, audit }),
    // Lender packages and submissions fail closed (503) without it: nothing is shared without consent.
    consentPort: createConsentPort(),
    // Applications created from a customer (API-APP-001) and added parties (API-APP-006) read the customer through it.
    partyPort: createPartyPort(),
    complaintSubjectPort: createCompositeComplaintSubjectPort({
      application: createApplicationSubjectPort(),
    }),
    productVersionPort: createProductVersionPort(),
    // Complaint referrals confirm the lender exists through this port; without it every referral is refused (503).
    lenderPort: createLenderPort(),
    dataSharingPort: new PostgresDataSharingPort(),
    apiClientRepository: new PgApiClientRepository(txRunner, audit),
    documentLinkSecret: options.documentLinkSecret,
    enqueueJob: (tx, tenantId, jobType, payload, runAt) =>
      globalJobQueue.enqueue(tx, ids.next('job'), tenantId, jobType, payload, runAt),
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
  ];
}
