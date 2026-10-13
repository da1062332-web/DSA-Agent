// packages/contracts/src/messaging.ts — owner: Dev 1 / Dev 5
// Module: MOD-MSG (Domain DOM-C — Follow-ups & Communication)
// Canonical entities: ENT-035 (message_template), ENT-036 (message)
import { z } from 'zod';
import { IdSchema } from './ids';

export const MESSAGE_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];
export const MessageChannelSchema = z.enum(MESSAGE_CHANNELS);

export const TEMPLATE_CATEGORIES = ['TRANSACTIONAL', 'MARKETING', 'OPERATIONAL', 'AUTHENTICATION'] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];
export const TemplateCategorySchema = z.enum(TEMPLATE_CATEGORIES);

export const TEMPLATE_STATUSES = ['DRAFT', 'APPROVED', 'DEPRECATED', 'ARCHIVED'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];
export const TemplateStatusSchema = z.enum(TEMPLATE_STATUSES);

export const MESSAGE_DIRECTIONS = ['OUTBOUND', 'INBOUND'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];
export const MessageDirectionSchema = z.enum(MESSAGE_DIRECTIONS);

export const MESSAGE_STATUSES = ['BLOCKED', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'UNDELIVERED'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];
export const MessageStatusSchema = z.enum(MESSAGE_STATUSES);

export const BLOCKED_REASONS = [
  'UNAUTHORIZED',
  'SUBJECT_NOT_FOUND',
  'CONSENT_REQUIRED',
  'CONSENT_WITHDRAWN',
  'OPT_OUT_CHANNEL',
  'QUIET_HOURS',
  'FREQUENCY_CAPPED',
  'TEMPLATE_NOT_FOUND',
  'TEMPLATE_NOT_APPROVED',
  'TEMPLATE_VARIABLES_INVALID',
  'PROVIDER_NOT_CONFIGURED',
  'RECIPIENT_INVALID',
] as const;
export type BlockedReason = (typeof BLOCKED_REASONS)[number];
export const BlockedReasonSchema = z.enum(BLOCKED_REASONS);

export const TemplateVariableDeclarationSchema = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/, 'variable name must be alphanumeric identifier'),
  required: z.boolean().default(true),
  description: z.string().max(200).optional(),
});
export type TemplateVariableDeclaration = z.infer<typeof TemplateVariableDeclarationSchema>;

/**
 * ENT-035: Message Template
 */
export const CreateTemplateSchema = z.object({
  code: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9._-]+$/, 'code must be lowercase alphanumeric with ., _, or -'),
  channel: MessageChannelSchema,
  language: z.string().min(2).max(10).default('en'),
  category: TemplateCategorySchema.default('TRANSACTIONAL'),
  body: z.string().min(1).max(5000),
  variables: z.array(TemplateVariableDeclarationSchema).default([]),
  providerTemplateId: z.string().max(100).nullable().optional(),
  status: TemplateStatusSchema.default('APPROVED'),
});
export type CreateTemplateInput = z.infer<typeof CreateTemplateSchema>;

export const MessageTemplateSchema = z.object({
  id: IdSchema('tmpl'),
  tenantId: z.string(),
  code: z.string(),
  channel: MessageChannelSchema,
  language: z.string(),
  category: TemplateCategorySchema,
  body: z.string(),
  variables: z.array(TemplateVariableDeclarationSchema),
  providerTemplateId: z.string().nullable().optional(),
  version: z.number().int().positive(),
  status: TemplateStatusSchema,
  lockVersion: z.number().int().nonnegative(),
  createdAt: z.string(),
  createdBy: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type MessageTemplate = z.infer<typeof MessageTemplateSchema>;

/**
 * Recipient schema with S2 validation (no PAN/Aadhaar/bank account)
 */
export const MessageRecipientSchema = z.object({
  email: z.string().email().optional(),
  mobile: z.string().regex(/^\+?[1-9]\d{9,14}$/, 'valid E.164 phone number').optional(),
  name: z.string().max(100).optional(),
}).refine((data) => Boolean(data.email || data.mobile), {
  message: 'Recipient must specify at least an email or mobile phone number',
});
export type MessageRecipient = z.infer<typeof MessageRecipientSchema>;

/**
 * ENT-036: Message Dispatch Input (POST /v1/messages)
 */
export const SendMessageSchema = z.object({
  subjectType: z.enum(['LEAD', 'CUSTOMER', 'LOAN_APPLICATION']),
  subjectId: z.string().min(1),
  channel: MessageChannelSchema,
  templateCode: z.string().min(1),
  templateVersion: z.number().int().positive().optional(),
  recipient: MessageRecipientSchema,
  variables: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  correlationId: z.string().optional(),
});
export type SendMessageInput = z.infer<typeof SendMessageSchema>;

export const MessageStatusHistoryEntrySchema = z.object({
  status: MessageStatusSchema,
  timestamp: z.string(),
  reason: z.string().optional(),
  providerEventId: z.string().optional(),
});
export type MessageStatusHistoryEntry = z.infer<typeof MessageStatusHistoryEntrySchema>;

/**
 * ENT-036: Message Record
 */
export const MessageRecordSchema = z.object({
  id: IdSchema('msg'),
  tenantId: z.string(),
  direction: MessageDirectionSchema,
  channel: MessageChannelSchema,
  subjectType: z.string(),
  subjectId: z.string(),
  templateVersionId: z.string(),
  recipientHash: z.string(),
  recipientMasked: z.string(),
  variablesRedacted: z.record(z.unknown()),
  provider: z.string(),
  providerMessageId: z.string().nullable().optional(),
  status: MessageStatusSchema,
  statusHistory: z.array(MessageStatusHistoryEntrySchema),
  blockedReason: z.string().nullable().optional(),
  lockVersion: z.number().int().nonnegative(),
  createdAt: z.string(),
  createdBy: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type MessageRecord = z.infer<typeof MessageRecordSchema>;

/**
 * Filter for Listing Messages (GET /v1/messages?subjectType=&subjectId=)
 */
export const ListMessagesQuerySchema = z.object({
  subjectType: z.enum(['LEAD', 'CUSTOMER', 'LOAN_APPLICATION']),
  subjectId: z.string().min(1),
  channel: MessageChannelSchema.optional(),
  status: MessageStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export type ListMessagesQuery = z.infer<typeof ListMessagesQuerySchema>;

/**
 * Filter for Listing Templates (GET /v1/message-templates)
 */
export const ListTemplatesQuerySchema = z.object({
  channel: MessageChannelSchema.optional(),
  category: TemplateCategorySchema.optional(),
  status: TemplateStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export type ListTemplatesQuery = z.infer<typeof ListTemplatesQuerySchema>;
