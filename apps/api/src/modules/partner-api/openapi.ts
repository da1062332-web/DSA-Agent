// apps/api/src/modules/partner-api/openapi.ts — owner: Akash (Module 37: API Development MOD-DEV)
import {
  ApiKeyResponseSchema,
  CreateApiKeySchema,
  CreateWebhookSubscriptionSchema,
  PartnerApplicationResponseSchema,
  PartnerCreateApplicationSchema,
  PartnerCreateLeadSchema,
  PartnerLeadResponseSchema,
  PartnerListLeadsQuerySchema,
  PartnerListLeadsResponseSchema,
  PartnerSanctionOffersResponseSchema,
  PartnerUploadSessionRequestSchema,
  PartnerUploadSessionResponseSchema,
  SandboxEchoRequestSchema,
  SandboxEchoResponseSchema,
  SandboxSimulateEventRequestSchema,
  SandboxSimulateEventResponseSchema,
  WebhookSubscriptionResponseSchema,
  CreateApiClientSchema,
  UpdateApiClientSchema,
  ApiClientResponseSchema,
  RotateClientSecretResponseSchema,
} from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { z } from 'zod';

export function registerOpenApi(registry: OpenAPIRegistry): void {
  // 1. API Keys
  registry.registerPath({
    method: 'post',
    path: '/v1/partner/api-keys',
    summary: 'Create and issue a new Partner API Key',
    tags: ['Partner API - Governance'],
    request: {
      body: { content: { 'application/json': { schema: CreateApiKeySchema } } },
    },
    responses: {
      201: {
        description: 'API Key issued successfully',
        content: { 'application/json': { schema: ApiKeyResponseSchema } },
      },
    },
  });

  // 2. Partner Leads
  registry.registerPath({
    method: 'post',
    path: '/v1/partner/leads',
    summary: 'Ingest lead programmatically with consent verification',
    tags: ['Partner API - Leads'],
    request: {
      body: { content: { 'application/json': { schema: PartnerCreateLeadSchema } } },
    },
    responses: {
      201: {
        description: 'Lead received and queued',
        content: { 'application/json': { schema: PartnerLeadResponseSchema } },
      },
      200: {
        description: 'Idempotent replay of previously ingested lead',
        content: { 'application/json': { schema: PartnerLeadResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/partner/leads/{id}',
    summary: 'Query lead lifecycle status (masked PII)',
    tags: ['Partner API - Leads'],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Lead status details',
        content: { 'application/json': { schema: PartnerLeadResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/partner/leads',
    summary: 'List leads ingested by this partner (cursor-paginated)',
    tags: ['Partner API - Leads'],
    request: {
      query: PartnerListLeadsQuerySchema,
    },
    responses: {
      200: {
        description: 'Paginated lead listing',
        content: { 'application/json': { schema: PartnerListLeadsResponseSchema } },
      },
    },
  });

  // 3. Partner Applications & Offers
  registry.registerPath({
    method: 'post',
    path: '/v1/partner/applications',
    summary: 'Programmatically convert lead or submit loan application',
    tags: ['Partner API - Origination'],
    request: {
      body: { content: { 'application/json': { schema: PartnerCreateApplicationSchema } } },
    },
    responses: {
      201: {
        description: 'Application created and submitted',
        content: { 'application/json': { schema: PartnerApplicationResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/partner/applications/{id}',
    summary: 'Retrieve loan application processing stage and status',
    tags: ['Partner API - Origination'],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Application details',
        content: { 'application/json': { schema: PartnerApplicationResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/partner/applications/{id}/offers',
    summary: 'Retrieve approved lender sanction offers for an application',
    tags: ['Partner API - Origination'],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Lender sanction offers',
        content: { 'application/json': { schema: PartnerSanctionOffersResponseSchema } },
      },
    },
  });

  // 4. Partner Document Upload Session
  registry.registerPath({
    method: 'post',
    path: '/v1/partner/applications/{id}/documents/upload-session',
    summary: 'Generate customer document upload session token',
    tags: ['Partner API - Documents'],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: PartnerUploadSessionRequestSchema.omit({ applicationId: true }) } } },
    },
    responses: {
      201: {
        description: 'Upload session initialized',
        content: { 'application/json': { schema: PartnerUploadSessionResponseSchema } },
      },
    },
  });

  // 5. Webhook Subscriptions
  registry.registerPath({
    method: 'post',
    path: '/v1/partner/webhooks/subscriptions',
    summary: 'Register partner webhook subscription with HMAC signing',
    tags: ['Partner API - Webhooks'],
    request: {
      body: { content: { 'application/json': { schema: CreateWebhookSubscriptionSchema } } },
    },
    responses: {
      201: {
        description: 'Webhook subscription created',
        content: { 'application/json': { schema: WebhookSubscriptionResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/partner/webhooks/subscriptions',
    summary: 'List active partner webhook subscriptions',
    tags: ['Partner API - Webhooks'],
    responses: {
      200: {
        description: 'List of webhook subscriptions',
        content: {
          'application/json': {
            schema: z.object({ data: z.array(WebhookSubscriptionResponseSchema) }),
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/v1/partner/webhooks/subscriptions/{id}',
    summary: 'Revoke webhook subscription',
    tags: ['Partner API - Webhooks'],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      204: { description: 'Subscription revoked' },
    },
  });

  // 6. Sandbox & Diagnostics
  registry.registerPath({
    method: 'post',
    path: '/v1/partner/sandbox/echo',
    summary: 'Partner diagnostic echo and signature verification probe',
    tags: ['Partner API - Sandbox'],
    request: {
      body: { content: { 'application/json': { schema: SandboxEchoRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Echo response',
        content: { 'application/json': { schema: SandboxEchoResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/partner/sandbox/simulate-event',
    summary: 'Simulate synthetic event delivery for partner receiver test',
    tags: ['Partner API - Sandbox'],
    request: {
      body: { content: { 'application/json': { schema: SandboxSimulateEventRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Simulation outcome',
        content: { 'application/json': { schema: SandboxSimulateEventResponseSchema } },
      },
    },
  });

  // 7. API Management & Client Credentials (MOD-API)
  registry.registerPath({
    method: 'get',
    path: '/v1/api-clients',
    summary: 'List API clients registered for the tenant',
    tags: ['MOD-API API Management'],
    responses: {
      200: {
        description: 'List of registered API clients',
        content: { 'application/json': { schema: z.object({ data: z.array(ApiClientResponseSchema) }) } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/api-clients',
    summary: 'Register and issue credentials for an external API client',
    tags: ['MOD-API API Management'],
    request: {
      body: { content: { 'application/json': { schema: CreateApiClientSchema } } },
    },
    responses: {
      201: {
        description: 'API client registered with one-time unmasked secret',
        content: { 'application/json': { schema: ApiClientResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/api-clients/{id}',
    summary: 'Get details of an API client',
    tags: ['MOD-API API Management'],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'API client details',
        content: { 'application/json': { schema: ApiClientResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/v1/api-clients/{id}',
    summary: 'Update API client configuration, status, scopes, or rate limits',
    tags: ['MOD-API API Management'],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: UpdateApiClientSchema } } },
    },
    responses: {
      200: {
        description: 'Updated API client details',
        content: { 'application/json': { schema: ApiClientResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/v1/api-clients/{id}',
    summary: 'Revoke and delete an API client',
    tags: ['MOD-API API Management'],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      204: { description: 'API client revoked successfully' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/api-clients/{id}/rotate-secret',
    summary: 'Rotate client secret for an API client',
    tags: ['MOD-API API Management'],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Rotated client secret payload',
        content: { 'application/json': { schema: RotateClientSecretResponseSchema } },
      },
    },
  });
}
