// Every MVP module router, pre-registered at Gate 0 so nobody edits app.ts later (Assignment Matrix §7).
// Owners implement their own router.ts; this list only changes when a new module is agreed.
import * as compliance from './compliance/router';
import * as activities from './crm/activities/router';
import * as customers from './crm/customers/router';
import * as grievances from './crm/grievances/router';
import * as leads from './crm/leads/router';
import * as messaging from './crm/messaging/router';
import * as notifications from './crm/notifications/router';
import * as tasks from './crm/tasks/router';
import * as applications from './origination/applications/router';
import * as catalogue from './origination/catalogue/router';
import * as finance from './finance/router';
import * as documentSharing from './origination/document-sharing/router';
import * as verifications from './origination/verifications/router';
import * as connectors from './origination/connectors/router';
import * as lenderCases from './origination/lender-cases/router';
import * as sanctions from './origination/sanctions/router';
import * as targets from './crm/targets/router';
import * as reporting from './reporting/router';
import * as platform from './platform/router';
import * as platformAdmin from './platform-admin/router';
import * as integrations from './integrations/router';
import * as rulesApi from './rules/api/router';
import * as verification from './verification/router';
import * as automation from './automation/router';
import * as partnerApi from './partner-api/router';
import * as audit from './audit/router';
import * as imports from './platform/imports/router';
import * as workforce from './crm/workforce/router';
import * as invoices from './invoices/router';
import type { ApiModule } from './types';

export const apiModules: readonly ApiModule[] = [
  { name: 'platform', owner: 'Dev 1', createRouter: platform.createRouter },
  { name: 'imports', owner: 'Dev 1', createRouter: imports.createRouter },
  { name: 'platform-admin', owner: 'Dev 1', createRouter: platformAdmin.createRouter },
  { name: 'integrations', owner: 'Dev 1', createRouter: integrations.createRouter },
  { name: 'crm/leads', owner: 'Dev 5', createRouter: leads.createRouter },
  { name: 'crm/customers', owner: 'Dev 5', createRouter: customers.createRouter },
  { name: 'crm/activities', owner: 'Dev 5', createRouter: activities.createRouter },
  { name: 'crm/messaging', owner: 'Dev 1', createRouter: messaging.createRouter },
  { name: 'crm/notifications', owner: 'Dev 1', createRouter: notifications.createRouter },
  { name: 'compliance', owner: 'Dev 5', createRouter: compliance.createRouter },
  { name: 'finance', owner: 'Dev 5', createRouter: finance.createRouter },
  { name: 'invoices', owner: 'Dev 5', createRouter: invoices.createRouter },
  { name: 'crm/tasks', owner: 'Dev 6', createRouter: tasks.createRouter },
  { name: 'crm/grievances', owner: 'Dev 3', createRouter: grievances.createRouter },
  { name: 'crm/targets', owner: 'Dev 5', createRouter: targets.createRouter },
  { name: 'crm/workforce', owner: 'Dev 1', createRouter: workforce.createRouter },
  { name: 'reporting', owner: 'Dev 5', createRouter: reporting.createRouter },
  { name: 'rules/api', owner: 'Dev 6', createRouter: rulesApi.createRouter },
  { name: 'origination/catalogue', owner: 'Dev 3', createRouter: catalogue.createRouter },
  { name: 'origination/applications', owner: 'Dev 3', createRouter: applications.createRouter },
  { name: 'origination/lender-cases', owner: 'Dev 4', createRouter: lenderCases.createRouter },
  { name: 'origination/document-sharing', owner: 'Dev 1', createRouter: documentSharing.createRouter },
  { name: 'verification', owner: 'Dev 2', createRouter: verification.createRouter },
  { name: 'origination/verifications', owner: 'Dev 2', createRouter: verifications.createRouter },
  { name: 'origination/connectors', owner: 'Dev 1', createRouter: connectors.createRouter },
  { name: 'origination/sanctions', owner: 'Dev 3', createRouter: sanctions.createRouter },
  { name: 'automation', owner: 'Dev 1 / Dev 6', createRouter: automation.createRouter },
  { name: 'partner-api', owner: 'Dev 2 / Dev 6', createRouter: partnerApi.createRouter },
  { name: 'audit', owner: 'Dev 1 / Dev 6', createRouter: audit.createRouter },
];
// rules/engine (Dev 2) has no router: the engine is in-process behind DecisionPort.
