// OpenAPI registration for module compliance (owner: see router.ts). Register this module's paths with zod schemas;
// tools/gen-openapi.ts writes openapi/openapi.yaml (never hand-edited; CI fails on a diff).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';

export function registerOpenApi(_registry: OpenAPIRegistry): void {}
