// OpenAPI paths for origination/document-sharing (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import {
  CreateShareSchema,
  CreateUploadLinkSchema,
  ListSharesQuerySchema,
  ListUploadLinksQuerySchema,
  VerifyUploadOtpSchema,
} from '@dsa/contracts';
import { registerOperation } from '../../../http/openapi-op';

const tag = 'MOD-DSH Document Sharing';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'post',
    path: '/v1/upload-links',
    operationId: 'API-DSH-001',
    summary: 'POST /v1/upload-links',
    tag,
    body: CreateUploadLinkSchema,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/upload-links',
    operationId: 'DSH-GET-UPLOAD-LINKS',
    summary: 'GET /v1/upload-links',
    tag,
    query: ListUploadLinksQuerySchema,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/upload-links/:id/revocation',
    operationId: 'API-DSH-002',
    summary: 'POST /v1/upload-links/:id/revocation',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/shares',
    operationId: 'API-DSH-006',
    summary: 'POST /v1/shares',
    tag,
    body: CreateShareSchema,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/shares/:id/revocation',
    operationId: 'API-DSH-007',
    summary: 'POST /v1/shares/:id/revocation',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/shares',
    operationId: 'API-DSH-008',
    summary: 'GET /v1/shares',
    tag,
    query: ListSharesQuerySchema,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/public/v1/upload/:token',
    operationId: 'API-DSH-003',
    summary: 'GET /public/v1/upload/:token',
    tag,
    public: true,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/public/v1/upload/:token/otp-verification',
    operationId: 'API-DSH-004',
    summary: 'POST /public/v1/upload/:token/otp-verification',
    tag,
    body: VerifyUploadOtpSchema,
    public: true,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/public/v1/upload/:token/files',
    operationId: 'API-DSH-005',
    summary: 'POST /public/v1/upload/:token/files',
    tag,
    status: 201,
    public: true,
  });
}
