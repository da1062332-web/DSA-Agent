// packages/contracts/src/integrations.ts
// Module 28: Integration Management (MOD-INT)
// Submodule SUB-INT.01: Adapter Framework (ENT-103 integration_connection, API-INT-001, API-INT-002)

import { z } from 'zod';
import { IdSchema } from './ids';

export const INTEGRATION_ENVIRONMENTS = ['SANDBOX', 'PRODUCTION'] as const;
export type IntegrationEnvironment = (typeof INTEGRATION_ENVIRONMENTS)[number];
export const IntegrationEnvironmentSchema = z.enum(INTEGRATION_ENVIRONMENTS);

export const INTEGRATION_STATUSES = ['ACTIVE', 'INACTIVE', 'DEGRADED', 'SUSPENDED'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];
export const IntegrationStatusSchema = z.enum(INTEGRATION_STATUSES);

export const CAPABILITY_CATEGORIES = ['MESSAGING', 'VERIFICATION', 'STORAGE', 'BANKING', 'BUREAU'] as const;
export type CapabilityCategory = (typeof CAPABILITY_CATEGORIES)[number];
export const CapabilityCategorySchema = z.enum(CAPABILITY_CATEGORIES);

/**
 * Metadata for a standardized provider capability descriptor.
 */
export const CapabilityDescriptorSchema = z.object({
  capability: z.string().min(1),
  displayName: z.string().min(1),
  category: CapabilityCategorySchema,
  description: z.string(),
  requiredConfigFields: z.array(z.string()),
  dataClassification: z.enum(['S1', 'S2', 'S3', 'S4']),
  supportedProviders: z.array(z.string()),
});
export type CapabilityDescriptor = z.infer<typeof CapabilityDescriptorSchema>;

/**
 * Health check status of an integration adapter.
 */
export const HealthCheckResultSchema = z.object({
  healthy: z.boolean(),
  latencyMs: z.number().nonnegative(),
  message: z.string().optional(),
  checkedAt: z.string().datetime(),
  statusCode: z.number().int().optional(),
});
export type HealthCheckResult = z.infer<typeof HealthCheckResultSchema>;

/**
 * ENT-103: Integration Connection Schema.
 * Guarantees zero plaintext secret persistence: only opaque `credentialRef` is stored.
 */
export const IntegrationConnectionSchema = z.object({
  id: IdSchema('itc'),
  tenantId: z.string(),
  provider: z.string().min(1),
  capability: z.string().min(1),
  environment: IntegrationEnvironmentSchema,
  credentialRef: z.string().regex(/^vault:\/\/tenants\/[a-zA-Z0-9_-]+\/(sandbox|production)\/[a-zA-Z0-9_-]+\/credentials$/, 'credentialRef must be a valid tenant vault URI (e.g., vault://tenants/{tenant_id}/{env}/{provider}/credentials)'),
  config: z.record(z.unknown()),
  status: IntegrationStatusSchema,
  health: HealthCheckResultSchema.nullable().optional(),
  lockVersion: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  createdBy: z.string(),
  updatedAt: z.string().datetime(),
  updatedBy: z.string(),
});
export type IntegrationConnection = z.infer<typeof IntegrationConnectionSchema>;

/**
 * Query schema for GET /v1/integrations (API-INT-001)
 */
export const ListIntegrationsQuerySchema = z.object({
  environment: IntegrationEnvironmentSchema.optional(),
  capability: z.string().optional(),
  provider: z.string().optional(),
  status: IntegrationStatusSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});
export type ListIntegrationsQuery = z.input<typeof ListIntegrationsQuerySchema>;

/**
 * Payload schema for PUT /v1/integrations/:provider (API-INT-002)
 * Rejects any secret keys or plaintext passwords in config.
 */
const FORBIDDEN_SECRET_KEY_REGEX = /(password|secret|apikey|token|privatekey|bearer)/i;

export const ConfigureIntegrationRequestSchema = z.object({
  capability: z.string().min(1),
  environment: IntegrationEnvironmentSchema,
  credentialRef: z.string().regex(/^vault:\/\/tenants\/[a-zA-Z0-9_-]+\/(sandbox|production)\/[a-zA-Z0-9_-]+\/credentials$/, 'credentialRef must be a valid tenant vault URI'),
  config: z.record(z.unknown()).refine(
    (obj) => {
      for (const key of Object.keys(obj)) {
        if (FORBIDDEN_SECRET_KEY_REGEX.test(key)) {
          return false;
        }
      }
      return true;
    },
    { message: 'Configuration must not contain secret or credential keys. Use credentialRef to reference secrets in vault.' },
  ),
  status: IntegrationStatusSchema.default('ACTIVE'),
});
export type ConfigureIntegrationRequest = z.infer<typeof ConfigureIntegrationRequestSchema>;

/**
 * Adapter execution result metadata
 */
export interface AdapterExecutionMetadata {
  provider: string;
  capability: string;
  environment: IntegrationEnvironment;
  durationMs: number;
  httpStatus?: number;
  externalTransactionId?: string;
  maskedPayloadSummary?: string;
}

/**
 * Standardized adapter output envelope
 */
export interface AdapterResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    details?: unknown;
  };
  metadata: AdapterExecutionMetadata;
}

/**
 * Pre-registered standard capability descriptors in the platform.
 */
export const STANDARD_CAPABILITY_DESCRIPTORS: CapabilityDescriptor[] = [
  {
    capability: 'MESSAGING.SMS',
    displayName: 'Transactional SMS Dispatch',
    category: 'MESSAGING',
    description: 'Outbound SMS messaging with DLT template compliance and delivery tracking',
    requiredConfigFields: ['senderId'],
    dataClassification: 'S2',
    supportedProviders: ['TWILIO', 'MOCK'],
  },
  {
    capability: 'MESSAGING.WHATSAPP',
    displayName: 'WhatsApp Business Messaging',
    category: 'MESSAGING',
    description: 'WhatsApp Business API interactive and template notifications',
    requiredConfigFields: ['businessAccountId', 'phoneNumberId'],
    dataClassification: 'S2',
    supportedProviders: ['TWILIO', 'MOCK'],
  },
  {
    capability: 'VERIFICATION.PAN',
    displayName: 'Instant PAN Verification',
    category: 'VERIFICATION',
    description: 'Real-time Income Tax Department PAN status and fuzzy name matching',
    requiredConfigFields: ['apiEndpoint', 'minMatchScore'],
    dataClassification: 'S3',
    supportedProviders: ['KARZA', 'SUREPASS', 'MOCK'],
  },
  {
    capability: 'VERIFICATION.GST',
    displayName: 'GSTIN Business Verification',
    category: 'VERIFICATION',
    description: 'GST Portal corporate registration, status, and filing compliance check',
    requiredConfigFields: ['apiEndpoint'],
    dataClassification: 'S2',
    supportedProviders: ['KARZA', 'SUREPASS', 'MOCK'],
  },
  {
    capability: 'VERIFICATION.BANK',
    displayName: 'Penny-Drop Bank Verification',
    category: 'BANKING',
    description: 'IMPS penny-drop bank account name verification and account validation',
    requiredConfigFields: ['pennyAmountPaise', 'webhookUrl'],
    dataClassification: 'S3',
    supportedProviders: ['SETU', 'MOCK'],
  },
  {
    capability: 'STORAGE.DOC_SCAN',
    displayName: 'Document Malware Scan',
    category: 'STORAGE',
    description: 'Streamed antivirus and content policy scanning for uploaded borrower documents',
    requiredConfigFields: ['maxSizeBytes'],
    dataClassification: 'S1',
    supportedProviders: ['CLAMAV', 'MOCK'],
  },
];
