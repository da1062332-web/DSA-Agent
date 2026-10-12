// OpenAPI 3.1 is generated from the zod schemas (Contracts §1). Common components live here (owner: Dev 1);
// each API module registers its own paths in apps/api/src/modules/<module>/openapi.ts.
// Output: openapi/openapi.yaml, written by tools/gen-openapi.ts. Never hand-edit it; CI fails on a diff.
import { OpenAPIRegistry, OpenApiGeneratorV31, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { ErrorEnvelope } from '../errors';
import { MoneySchema } from '../money';
import { ListMeta } from '../pagination';

extendZodWithOpenApi(z);

export { OpenAPIRegistry, OpenApiGeneratorV31 };

export function createRegistry(): OpenAPIRegistry {
  const registry = new OpenAPIRegistry();

  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'Supabase Auth access token. The tenant comes only from app_metadata.tenant_id.',
  });

  registry.register('ErrorEnvelope', ErrorEnvelope);
  registry.register('Money', MoneySchema);
  registry.register('ListMeta', ListMeta);

  registry.registerParameter(
    'IdempotencyKey',
    z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,128}$/)
      .openapi({ param: { name: 'Idempotency-Key', in: 'header', required: true } }),
  );
  registry.registerParameter(
    'IfMatch',
    z.string().openapi({ param: { name: 'If-Match', in: 'header', required: true }, example: '"3"' }),
  );
  registry.registerParameter(
    'CorrelationId',
    z.string().openapi({ param: { name: 'X-Correlation-Id', in: 'header', required: false } }),
  );

  return registry;
}
