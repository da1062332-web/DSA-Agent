// Builds the OpenAPI 3.1 document from the zod schemas each module registers (Contracts §1).
// Used by tools/gen-openapi.ts; not loaded by the API at runtime.
import { OpenApiGeneratorV31, createRegistry } from '@dsa/contracts/openapi';
import { z } from 'zod';
import * as compliance from './modules/compliance/openapi';
import * as activities from './modules/crm/activities/openapi';
import * as customers from './modules/crm/customers/openapi';
import * as grievances from './modules/crm/grievances/openapi';
import * as leads from './modules/crm/leads/openapi';
import * as messaging from './modules/crm/messaging/openapi';
import * as notifications from './modules/crm/notifications/openapi';
import * as tasks from './modules/crm/tasks/openapi';
import * as applications from './modules/origination/applications/openapi';
import * as catalogue from './modules/origination/catalogue/openapi';
import * as finance from './modules/finance/openapi';
import * as lenderCases from './modules/origination/lender-cases/openapi';
import * as sanctions from './modules/origination/sanctions/openapi';
import * as targets from './modules/crm/targets/openapi';
import * as reporting from './modules/reporting/openapi';
import * as platform from './modules/platform/openapi';
import * as platformAdmin from './modules/platform-admin/openapi';
import * as integrations from './modules/integrations/openapi';
import * as rulesApi from './modules/rules/api/openapi';
import * as verification from './modules/verification/openapi';
import * as partnerApi from './modules/partner-api/openapi';
import * as audit from './modules/audit/openapi';
import * as security from './modules/security/openapi';
import * as ledger from './modules/ledger/openapi';
import * as documentSharing from './modules/origination/document-sharing/openapi';
import { registerPaths as paths_automation } from './modules/automation/openapi-paths';
import { registerPaths as paths_compliance } from './modules/compliance/openapi-paths';
import { registerPaths as paths_crm_activities } from './modules/crm/activities/openapi-paths';
import { registerPaths as paths_crm_customers } from './modules/crm/customers/openapi-paths';
import { registerPaths as paths_crm_leads } from './modules/crm/leads/openapi-paths';
import { registerPaths as paths_crm_messaging } from './modules/crm/messaging/openapi-paths';
import { registerPaths as paths_crm_tasks } from './modules/crm/tasks/openapi-paths';
import { registerPaths as paths_crm_workforce } from './modules/crm/workforce/openapi-paths';
import { registerPaths as paths_finance } from './modules/finance/openapi-paths';
import { registerPaths as paths_integrations } from './modules/integrations/openapi-paths';
import { registerPaths as paths_invoices } from './modules/invoices/openapi-paths';
import { registerPaths as paths_ledger } from './modules/ledger/openapi-paths';
import { registerPaths as paths_origination_connectors } from './modules/origination/connectors/openapi-paths';
import { registerPaths as paths_origination_document_sharing } from './modules/origination/document-sharing/openapi-paths';
import { registerPaths as paths_origination_lender_cases } from './modules/origination/lender-cases/openapi-paths';
import { registerPaths as paths_origination_sanctions } from './modules/origination/sanctions/openapi-paths';
import { registerPaths as paths_origination_verifications } from './modules/origination/verifications/openapi-paths';
import { registerPaths as paths_platform } from './modules/platform/openapi-paths';
import { registerPaths as paths_platform_admin } from './modules/platform-admin/openapi-paths';
import { registerPaths as paths_platform_imports } from './modules/platform/imports/openapi-paths';
import { registerPaths as paths_reconciliation } from './modules/reconciliation/openapi-paths';
import { registerPaths as paths_reporting } from './modules/reporting/openapi-paths';

const MODULES = [
  platform,
  platformAdmin,
  integrations,
  leads,
  customers,
  activities,
  messaging,
  notifications,
  compliance,
  finance,
  ledger,
  tasks,
  grievances,
  targets,
  reporting,
  rulesApi,
  catalogue,
  applications,
  lenderCases,
  sanctions,
  verification,
  partnerApi,
  audit,
  security,
  documentSharing,
];

const PATH_MODULES = [
  paths_automation,
  paths_compliance,
  paths_crm_activities,
  paths_crm_customers,
  paths_crm_leads,
  paths_crm_messaging,
  paths_crm_tasks,
  paths_crm_workforce,
  paths_finance,
  paths_integrations,
  paths_invoices,
  paths_ledger,
  paths_origination_connectors,
  paths_origination_document_sharing,
  paths_origination_lender_cases,
  paths_origination_sanctions,
  paths_origination_verifications,
  paths_platform,
  paths_platform_admin,
  paths_platform_imports,
  paths_reconciliation,
  paths_reporting,
];

export function buildOpenApiDocument() {
  const registry = createRegistry();

  registry.registerPath({
    method: 'get',
    path: '/health',
    summary: 'Liveness probe (the only unauthenticated path)',
    security: [],
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: z.object({ status: z.literal('ok') }) } },
      },
    },
  });

  for (const m of MODULES) m.registerOpenApi(registry);
  // Paths of routes that had no registration (audit 2026-10-19); each module owns its openapi-paths.ts.
  for (const register of PATH_MODULES) register(registry);

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: 'DSA CRM API', version: '0.1.0' },
    servers: [{ url: '/' }],
    security: [{ bearerAuth: [] }],
  });
}
