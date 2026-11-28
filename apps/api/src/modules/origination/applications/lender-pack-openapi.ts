// OpenAPI registration for lender document packs (owner: Dipanshu; task P2-04). The profile is MOD-LND (catalogue routes), the
// download MOD-LCS (served by origination/applications, which owns the documents).
import { ErrorEnvelope, LenderPackProfilePutSchema, LenderPackProfileSchema } from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { z } from 'zod';
import { registerOperation } from '../../../http/openapi-op';

export function registerLenderPackOpenApi(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'get',
    path: '/v1/lenders/:id/pack-profile',
    operationId: 'API-LND-PCK-001',
    summary:
      "The lender's pack profile (document order, file name pattern), or the default with isDefault true and version 0 (lender.read, lender.manage, config.manage or lender_case.submit)",
    tag: 'MOD-LND Lenders',
    response: LenderPackProfileSchema,
  });
  registerOperation(registry, {
    method: 'put',
    path: '/v1/lenders/:id/pack-profile',
    operationId: 'API-LND-PCK-002',
    summary:
      'Save the pack profile; If-Match "0" creates it for a lender on the default (lender.manage or config.manage)',
    tag: 'MOD-LND Lenders',
    body: LenderPackProfilePutSchema,
    response: LenderPackProfileSchema,
    ifMatch: true,
  });
  const error = (description: string) => ({
    description,
    content: { 'application/json': { schema: ErrorEnvelope } },
  });
  registry.registerPath({
    method: 'get',
    path: '/v1/lender-cases/{id}/pack',
    operationId: 'API-LCS-PCK-001',
    summary:
      "Download the case's frozen submission package as one ZIP, files ordered and named by the lender's pack profile; audited (lender_case.submit)",
    tags: ['MOD-LCS Lender Cases'],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: 'The ZIP. X-Package-Id and X-Manifest-Sha256 name the frozen package it was built from.',
        content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } },
      },
      401: error('Not authenticated'),
      403: error('Missing permission'),
      404: error('Not found, or outside the caller tenant or scope'),
      409: error(
        'No frozen package (INVALID_STATE), a listed file is gone (INVALID_STATE), or the manifest or a file no longer matches its checksum (CONTENT_HASH_MISMATCH)',
      ),
    },
  });
}
