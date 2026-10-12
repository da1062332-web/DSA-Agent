// Builds the OpenAPI 3.1 document from the zod schemas each module registers (Contracts §1).
// Used by tools/gen-openapi.ts; not loaded by the API at runtime.
import { OpenApiGeneratorV31, createRegistry } from '@dsa/contracts/openapi';
import { z } from 'zod';
import * as compliance from './modules/compliance/openapi';
import * as activities from './modules/crm/activities/openapi';
import * as customers from './modules/crm/customers/openapi';
import * as leads from './modules/crm/leads/openapi';
import * as messaging from './modules/crm/messaging/openapi';
import * as notifications from './modules/crm/notifications/openapi';
import * as tasks from './modules/crm/tasks/openapi';
import * as applications from './modules/origination/applications/openapi';
import * as catalogue from './modules/origination/catalogue/openapi';
import * as lenderCases from './modules/origination/lender-cases/openapi';
import * as platform from './modules/platform/openapi';
import * as rulesApi from './modules/rules/api/openapi';

const MODULES = [
  platform,
  leads,
  customers,
  activities,
  messaging,
  notifications,
  compliance,
  tasks,
  rulesApi,
  catalogue,
  applications,
  lenderCases,
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

  registry.registerPath({
    method: 'post',
    path: '/auth/login',
    summary: 'Database-backed user authentication',
    security: [],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              email: z.string().describe('User email (e.g. admin@dsa.com)'),
              password: z.string().describe('Password (e.g. admin@123)'),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Successful authentication',
        content: {
          'application/json': {
            schema: z.object({
              token: z.string(),
              user: z.object({
                id: z.string(),
                email: z.string(),
                displayName: z.string(),
                tenantId: z.string(),
                authenticatedAt: z.string(),
              }),
            }),
          },
        },
      },
      401: {
        description: 'Invalid email or password',
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
