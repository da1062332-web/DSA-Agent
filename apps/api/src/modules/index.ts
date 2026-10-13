// Every MVP module router, pre-registered at Gate 0 so nobody edits app.ts later (Assignment Matrix §7).
// Owners implement their own router.ts; this list only changes when a new module is agreed.
import * as compliance from './compliance/router';
import * as activities from './crm/activities/router';
import * as customers from './crm/customers/router';
import * as leads from './crm/leads/router';
import * as messaging from './crm/messaging/router';
import * as notifications from './crm/notifications/router';
import * as tasks from './crm/tasks/router';
import * as applications from './origination/applications/router';
import * as catalogue from './origination/catalogue/router';
import * as documentSharing from './origination/document-sharing/router';
import * as verifications from './origination/verifications/router';
import * as connectors from './origination/connectors/router';
import * as lenderCases from './origination/lender-cases/router';
import * as platform from './platform/router';
import * as rulesApi from './rules/api/router';
import type { ApiModule } from './types';

export const apiModules: readonly ApiModule[] = [
  { name: 'platform', owner: 'Dev 1', createRouter: platform.createRouter },
  { name: 'crm/leads', owner: 'Dev 5', createRouter: leads.createRouter },
  { name: 'crm/customers', owner: 'Dev 5', createRouter: customers.createRouter },
  { name: 'crm/activities', owner: 'Dev 5', createRouter: activities.createRouter },
  { name: 'crm/messaging', owner: 'Dev 1', createRouter: messaging.createRouter },
  { name: 'crm/notifications', owner: 'Dev 1', createRouter: notifications.createRouter },
  { name: 'compliance', owner: 'Dev 5', createRouter: compliance.createRouter },
  { name: 'crm/tasks', owner: 'Dev 6', createRouter: tasks.createRouter },
  { name: 'rules/api', owner: 'Dev 6', createRouter: rulesApi.createRouter },
  { name: 'origination/catalogue', owner: 'Dev 3', createRouter: catalogue.createRouter },
  { name: 'origination/applications', owner: 'Dev 3', createRouter: applications.createRouter },
  { name: 'origination/lender-cases', owner: 'Dev 4', createRouter: lenderCases.createRouter },
  { name: 'origination/document-sharing', owner: 'Dev 1', createRouter: documentSharing.createRouter },
  { name: 'origination/verifications', owner: 'Dev 2', createRouter: verifications.createRouter },
  { name: 'origination/connectors', owner: 'Dev 1', createRouter: connectors.createRouter },
];
// rules/engine (Dev 2) has no router: the engine is in-process behind DecisionPort.
