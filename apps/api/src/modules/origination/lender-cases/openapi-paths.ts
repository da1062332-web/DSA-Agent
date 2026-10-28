// OpenAPI paths for origination/lender-cases (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import { LenderCaseResourceSchema } from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { z } from 'zod';
import { registerOperation } from '../../../http/openapi-op';

const tag = 'MOD-LCS Lender Cases';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'get',
    path: '/v1/lender-cases',
    operationId: 'LCS-GET-LENDER-CASES',
    summary: 'GET /v1/lender-cases',
    tag,
    query: z.object({
      status: z.string().optional(),
      lenderId: z.string().optional(),
      applicationId: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.string().optional(),
    }),
    response: z.object({
      data: z.array(LenderCaseResourceSchema),
      meta: z.object({ nextCursor: z.string().nullable(), limit: z.number().int() }),
    }),
  });
}
