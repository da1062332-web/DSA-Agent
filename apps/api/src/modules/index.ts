// Every MVP module router, pre-registered at Gate 0 so nobody edits app.ts later (Assignment Matrix §7).
// Owners implement their own router.ts; this list only changes when a new module is agreed.
// Owners follow the five lanes of the multi-lender plan (Notion main page, section 6.1, revised 2026-11-26);
// the old Dev 1-6 labels are retired. Changes to another owner's folder are guest work that owner reviews.
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
import * as security from './security/router';
import * as reconciliation from './reconciliation/router';
import * as workforce from './crm/workforce/router';
import * as invoices from './invoices/router';
import type { ApiModule } from './types';

export const apiModules: readonly ApiModule[] = [
  { name: 'platform', owner: 'Vaibhav', createRouter: platform.createRouter },
  { name: 'imports', owner: 'Devyani', createRouter: imports.createRouter },
  { name: 'platform-admin', owner: 'Prathamesh', createRouter: platformAdmin.createRouter },
  { name: 'integrations', owner: 'Prathamesh', createRouter: integrations.createRouter },
  { name: 'crm/leads', owner: 'Bhushan', createRouter: leads.createRouter },
  { name: 'crm/customers', owner: 'Bhushan', createRouter: customers.createRouter },
  { name: 'crm/activities', owner: 'Bhushan', createRouter: activities.createRouter },
  { name: 'crm/messaging', owner: 'Prathamesh', createRouter: messaging.createRouter },
  { name: 'crm/notifications', owner: 'Prathamesh', createRouter: notifications.createRouter },
  { name: 'compliance', owner: 'Prathamesh', createRouter: compliance.createRouter },
  { name: 'finance', owner: 'Devyani', createRouter: finance.createRouter },
  { name: 'invoices', owner: 'Devyani', createRouter: invoices.createRouter },
  { name: 'crm/tasks', owner: 'Bhushan', createRouter: tasks.createRouter },
  { name: 'crm/grievances', owner: 'Prathamesh', createRouter: grievances.createRouter },
  { name: 'crm/targets', owner: 'Devyani', createRouter: targets.createRouter },
  { name: 'crm/workforce', owner: 'Devyani', createRouter: workforce.createRouter },
  { name: 'reporting', owner: 'Dipanshu', createRouter: reporting.createRouter },
  { name: 'rules/api', owner: 'Dipanshu', createRouter: rulesApi.createRouter },
  { name: 'origination/catalogue', owner: 'Dipanshu', createRouter: catalogue.createRouter },
  {
    name: 'origination/applications',
    owner: 'Dipanshu (document files: Prathamesh)',
    createRouter: applications.createRouter,
  },
  { name: 'origination/lender-cases', owner: 'Devyani', createRouter: lenderCases.createRouter },
  { name: 'origination/document-sharing', owner: 'Prathamesh', createRouter: documentSharing.createRouter },
  { name: 'verification', owner: 'Prathamesh', createRouter: verification.createRouter },
  { name: 'origination/verifications', owner: 'Prathamesh', createRouter: verifications.createRouter },
  { name: 'origination/connectors', owner: 'Bhushan', createRouter: connectors.createRouter },
  { name: 'origination/sanctions', owner: 'Devyani', createRouter: sanctions.createRouter },
  { name: 'automation', owner: 'Prathamesh', createRouter: automation.createRouter },
  { name: 'partner-api', owner: 'Vaibhav', createRouter: partnerApi.createRouter },
  { name: 'audit', owner: 'Vaibhav', createRouter: audit.createRouter },
  { name: 'security', owner: 'Vaibhav', createRouter: security.createRouter },
  { name: 'reconciliation', owner: 'Devyani', createRouter: reconciliation.createRouter },
];
// rules/engine (Dipanshu, with packages/bre-core) has no router: the engine is in-process behind DecisionPort.
