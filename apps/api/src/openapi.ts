// Builds the OpenAPI 3.1 document from the zod schemas each module registers (Contracts §1).
// Used by tools/gen-openapi.ts; not loaded by the API at runtime.
import { OpenApiGeneratorV31, createRegistry } from '@dsa/contracts/openapi';
import { z } from 'zod';
import * as compliance from './modules/compliance/openapi';
import * as activities from './modules/crm/activities/openapi';
import * as customers from './modules/crm/customers/openapi';
import * as leads from './modules/crm/leads/openapi';
import * as tasks from './modules/crm/tasks/openapi';
import * as applications from './modules/origination/applications/openapi';
import * as catalogue from './modules/origination/catalogue/openapi';
import * as lenderCases from './modules/origination/lender-cases/openapi';
import * as platform from './modules/platform/openapi';
import { authTags, registerAuthOpenApi } from './openapi-auth';
import * as rulesApi from './modules/rules/api/openapi';

// Each module exports `tags` (optional) for its Swagger groups; Swagger shows them in this order.
const MODULES: {
  registerOpenApi(r: ReturnType<typeof createRegistry>): void;
  tags?: { name: string; description: string }[];
}[] = [
  { registerOpenApi: registerAuthOpenApi, tags: authTags },
  platform,
  leads,
  customers,
  activities,
  compliance,
  tasks,
  rulesApi,
  catalogue,
  applications,
  lenderCases,
];

/**
 * The committed openapi/openapi.yaml is built without options, so it stays the same on every machine. The running
 * API passes its own SUPABASE_URL, so "Try it out" on the auth operations calls the Supabase project this process uses.
 */
export function buildOpenApiDocument(opts: { supabaseUrl?: string } = {}) {
  const registry = createRegistry();

  registry.registerPath({
    method: 'get',
    path: '/health',
    tags: ['System'],
    operationId: 'SYS-HEALTH',
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

  const document = new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'DSA CRM API',
      version: '0.1.0',
    },
    servers: [{ url: '/' }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'System', description: 'Liveness probe. No sign-in needed.' },
      ...MODULES.flatMap((m) => m.tags ?? []),
    ],
  });

  if (opts.supabaseUrl) pointAuthAt(document, opts.supabaseUrl);
  return document;
}

/** Auth operations are served by Supabase: send them to the project this API process is configured for. */
function pointAuthAt(document: { paths?: object }, supabaseUrl: string) {
  const base = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
  for (const methods of Object.values(document.paths ?? {}) as object[]) {
    for (const op of Object.values(methods) as { tags?: string[]; servers?: unknown[] }[]) {
      if (op.tags?.includes('MOD-AUTH Authentication')) {
        op.servers = [{ url: base, description: 'This environment (SUPABASE_URL)' }];
      }
    }
  }
}
