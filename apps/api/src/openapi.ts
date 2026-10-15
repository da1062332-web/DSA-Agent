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

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: 'DSA CRM API', version: '0.1.0' },
    servers: [{ url: '/' }],
    security: [{ bearerAuth: [] }],
  });
}
