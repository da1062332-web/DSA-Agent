// packages/contracts/src/partner-api.ts — owner: Akash (Module 37: API Development MOD-DEV)
import { z } from 'zod';
import { IdSchema } from './ids';
import { MoneySchema } from './money';
import { ListMeta } from './pagination';

// ============================================================================
// 1. API Keys & Credentials Schemas (ENT-121)
// ============================================================================

export const ApiKeyStatusSchema = z.enum(['ACTIVE', 'REVOKED', 'EXPIRED']);
export type ApiKeyStatus = z.infer<typeof ApiKeyStatusSchema>;

export const CreateApiKeySchema = z.object({
  partnerId: z.string().min(2).max(100),
  name: z.string().min(3).max(120),
  scopes: z.array(z.string().min(2).max(60)).min(1).default(['partner.lead_ingest']),
  allowedIps: z.array(z.string().min(7).max(45)).optional(),
  rateLimitRpm: z.number().int().min(10).max(3000).default(120),
  expiresAt: z.string().datetime().optional(),
});
export type CreateApiKeyInput = z.infer<typeof CreateApiKeySchema>;

export const ApiKeyResponseSchema = z.object({
  id: IdSchema('apk'),
  tenantId: IdSchema('ten'),
  partnerId: z.string(),
  name: z.string(),
  keyPrefix: z.string(),
  scopes: z.array(z.string()),
  allowedIps: z.array(z.string()).nullable(),
  rateLimitRpm: z.number().int(),
  status: ApiKeyStatusSchema,
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  lockVersion: z.number().int(),
  createdAt: z.string(),
  // Plaintext secret returned only upon creation
  secretKey: z.string().optional(),
});
export type ApiKeyResponse = z.infer<typeof ApiKeyResponseSchema>;

// ============================================================================
// 2. Partner Lead Ingestion & Tracking Schemas (API-DEV-001 - API-DEV-003)
// ============================================================================

export const PartnerConsentDeclarationSchema = z.object({
  consentArtifactRef: z.string().min(3).max(200),
  consentPurpose: z.enum(['LOAN_APPLICATION', 'CREDIT_CHECK', 'MARKETING', 'GENERAL_ASSISTANCE']).default('LOAN_APPLICATION'),
  optInTimestamp: z.string().datetime(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
});
export type PartnerConsentDeclaration = z.infer<typeof PartnerConsentDeclarationSchema>;

export const PartnerApplicantSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  mobile: z.string().regex(/^\+?[1-9]\d{7,14}$/, 'Invalid phone number format'),
  email: z.string().email(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD format required').optional(),
  city: z.string().min(2).max(100),
  state: z.string().min(2).max(100),
  pincode: z.string().regex(/^\d{6}$/, 'Must be a 6-digit Indian PIN code'),
  employmentType: z.enum(['SALARIED', 'SELF_EMPLOYED_PROFESSIONAL', 'SELF_EMPLOYED_BUSINESS', 'OTHER']).default('SALARIED'),
  monthlyIncome: MoneySchema.optional(),
});
export type PartnerApplicant = z.infer<typeof PartnerApplicantSchema>;

export const PartnerCreateLeadSchema = z.object({
  externalReferenceId: z.string().min(2).max(100),
  loanProductCode: z.string().min(2).max(50),
  requestedAmount: MoneySchema,
  applicant: PartnerApplicantSchema,
  consent: PartnerConsentDeclarationSchema,
  connectorId: IdSchema('con').optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type PartnerCreateLeadInput = z.infer<typeof PartnerCreateLeadSchema>;

export const PartnerLeadStatusSchema = z.enum([
  'RECEIVED',
  'DUPLICATE_SUSPECTED',
  'QUALIFIED',
  'CONVERTED',
  'CONTACTED',
  'DROPPED',
  'REJECTED',
]);
export type PartnerLeadStatus = z.infer<typeof PartnerLeadStatusSchema>;

export const PartnerLeadResponseSchema = z.object({
  id: IdSchema('lead'),
  externalReferenceId: z.string(),
  tenantId: IdSchema('ten'),
  status: PartnerLeadStatusSchema,
  requestedAmount: MoneySchema,
  loanProductCode: z.string(),
  applicantName: z.string(),
  maskedMobile: z.string(),
  maskedEmail: z.string(),
  city: z.string(),
  duplicateFlag: z.boolean(),
  conversionApplicationId: IdSchema('app').nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PartnerLeadResponse = z.infer<typeof PartnerLeadResponseSchema>;

export const PartnerListLeadsQuerySchema = z.object({
  status: PartnerLeadStatusSchema.optional(),
  externalReferenceId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PartnerListLeadsQuery = z.infer<typeof PartnerListLeadsQuerySchema>;

export const PartnerListLeadsResponseSchema = z.object({
  data: z.array(PartnerLeadResponseSchema),
  meta: ListMeta,
});
export type PartnerListLeadsResponse = z.infer<typeof PartnerListLeadsResponseSchema>;

// ============================================================================
// 3. Partner Loan Application Schemas (API-DEV-004 - API-DEV-006)
// ============================================================================

export const PartnerApplicationStatusSchema = z.enum([
  'DRAFT',
  'SUBMITTED',
  'UNDERWRITING',
  'LENDER_PROCESSING',
  'APPROVED',
  'SANCTIONED',
  'DISBURSED',
  'REJECTED',
  'CANCELLED',
]);
export type PartnerApplicationStatus = z.infer<typeof PartnerApplicationStatusSchema>;

export const PartnerCreateApplicationSchema = z.object({
  leadId: IdSchema('lead'),
  productId: IdSchema('prd'),
  appliedAmount: MoneySchema,
  tenureMonths: z.number().int().min(3).max(360),
  branchId: IdSchema('br').optional(),
});
export type PartnerCreateApplicationInput = z.infer<typeof PartnerCreateApplicationSchema>;

export const PartnerSanctionOfferSchema = z.object({
  id: IdSchema('snc'),
  lenderId: IdSchema('lnd'),
  lenderName: z.string(),
  sanctionedAmount: MoneySchema,
  interestRateAnnual: z.string(),
  tenureMonths: z.number().int(),
  processingFee: MoneySchema.nullable(),
  sanctionLetterDocumentId: z.string().nullable(),
  validUntil: z.string().nullable(),
  status: z.enum(['ACTIVE', 'ACCEPTED', 'EXPIRED', 'CANCELLED']),
});
export type PartnerSanctionOffer = z.infer<typeof PartnerSanctionOfferSchema>;

export const PartnerApplicationResponseSchema = z.object({
  id: IdSchema('app'),
  leadId: IdSchema('lead'),
  tenantId: IdSchema('ten'),
  status: PartnerApplicationStatusSchema,
  appliedAmount: MoneySchema,
  currentStage: z.string(),
  checklistCompleted: z.boolean(),
  sanctionCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PartnerApplicationResponse = z.infer<typeof PartnerApplicationResponseSchema>;

export const PartnerSanctionOffersResponseSchema = z.object({
  applicationId: IdSchema('app'),
  offers: z.array(PartnerSanctionOfferSchema),
});
export type PartnerSanctionOffersResponse = z.infer<typeof PartnerSanctionOffersResponseSchema>;

// ============================================================================
// 4. Partner Document Upload Session (API-DEV-007)
// ============================================================================

export const PartnerUploadSessionRequestSchema = z.object({
  applicationId: IdSchema('app'),
  documentChecklistCodes: z.array(z.string().min(2).max(50)).min(1),
  expiresInMinutes: z.number().int().min(15).max(4320).default(1440),
  recipientMobile: z.string().optional(),
});
export type PartnerUploadSessionRequest = z.infer<typeof PartnerUploadSessionRequestSchema>;

export const PartnerUploadSessionResponseSchema = z.object({
  sessionId: IdSchema('upl'),
  uploadUrl: z.string().url(),
  token: z.string(),
  expiresAt: z.string(),
  items: z.array(z.string()),
});
export type PartnerUploadSessionResponse = z.infer<typeof PartnerUploadSessionResponseSchema>;

// ============================================================================
// 5. Partner Webhook Subscriptions & Delivery Engine (API-DEV-008 - API-DEV-010)
// ============================================================================

export const WebhookEventTypes = [
  'lead.created',
  'lead.duplicate_flagged',
  'lead.qualified',
  'lead.state_changed',
  'lead.converted',
  'application.created',
  'application.state_changed',
  'lender_case.submitted',
  'sanction.approved',
  'disbursement.completed',
  'verification.completed',
] as const;
export type WebhookEventType = (typeof WebhookEventTypes)[number];

export const CreateWebhookSubscriptionSchema = z.object({
  name: z.string().min(3).max(100),
  targetUrl: z.string().url().refine((u) => u.startsWith('https://') || u.startsWith('http://localhost'), {
    message: 'Webhook URL must use HTTPS (except for local development)',
  }),
  subscribedEvents: z.array(z.enum(WebhookEventTypes)).min(1),
  secret: z.string().min(16).max(128).optional(),
});
export type CreateWebhookSubscriptionInput = z.infer<typeof CreateWebhookSubscriptionSchema>;

export const WebhookSubscriptionResponseSchema = z.object({
  id: IdSchema('whs'),
  tenantId: IdSchema('ten'),
  partnerId: z.string(),
  name: z.string(),
  targetUrl: z.string().url(),
  subscribedEvents: z.array(z.string()),
  status: z.enum(['ACTIVE', 'PAUSED', 'REVOKED']),
  failureCount: z.number().int(),
  lockVersion: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Returned once upon creation for HMAC signature verification
  signingSecret: z.string().optional(),
});
export type WebhookSubscriptionResponse = z.infer<typeof WebhookSubscriptionResponseSchema>;

export const WebhookPayloadEnvelopeSchema = z.object({
  eventId: z.string(),
  eventType: z.enum(WebhookEventTypes),
  occurredAt: z.string(),
  tenantId: z.string(),
  data: z.record(z.unknown()),
});
export type WebhookPayloadEnvelope = z.infer<typeof WebhookPayloadEnvelopeSchema>;

export const WebhookDeliveryLogSchema = z.object({
  id: IdSchema('whd'),
  subscriptionId: IdSchema('whs'),
  eventId: z.string(),
  eventType: z.string(),
  httpStatus: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  attempt: z.number().int(),
  status: z.enum(['DELIVERED', 'FAILED', 'PENDING_RETRY']),
  deliveredAt: z.string().nullable(),
  createdAt: z.string(),
});
export type WebhookDeliveryLog = z.infer<typeof WebhookDeliveryLogSchema>;

// ============================================================================
// 6. Developer Sandbox & Diagnostics (API-DEV-011 - API-DEV-012)
// ============================================================================

export const SandboxEchoRequestSchema = z.object({
  message: z.string().max(1000).default('ping'),
  payload: z.record(z.unknown()).optional(),
});
export type SandboxEchoRequest = z.infer<typeof SandboxEchoRequestSchema>;

export const SandboxEchoResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.string(),
  partnerId: z.string(),
  tenantId: z.string(),
  receivedHeaders: z.record(z.string().or(z.array(z.string()))),
  echo: z.record(z.unknown()),
});
export type SandboxEchoResponse = z.infer<typeof SandboxEchoResponseSchema>;

export const SandboxSimulateEventRequestSchema = z.object({
  subscriptionId: IdSchema('whs'),
  eventType: z.enum(WebhookEventTypes),
  customData: z.record(z.unknown()).optional(),
});
export type SandboxSimulateEventRequest = z.infer<typeof SandboxSimulateEventRequestSchema>;

export const SandboxSimulateEventResponseSchema = z.object({
  simulationId: z.string(),
  subscriptionId: IdSchema('whs'),
  targetUrl: z.string(),
  eventType: z.string(),
  signatureHeader: z.string(),
  deliveryStatus: z.enum(['DELIVERED', 'FAILED', 'PENDING_RETRY']),
  httpStatus: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
});
export type SandboxSimulateEventResponse = z.infer<typeof SandboxSimulateEventResponseSchema>;
