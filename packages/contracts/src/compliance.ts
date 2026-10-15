// packages/contracts/src/compliance.ts — Module 29: Privacy and Consent (MOD-PRV)
// Canonical entities: ENT-028 (consent_record), ENT-100 (data_sharing_record)
import { z } from 'zod';
import { IdSchema } from './ids';

export const DATA_SHARING_RECIPIENT_TYPES = ['LENDER', 'CO_LENDER', 'PARTNER', 'AUDITOR'] as const;
export type DataSharingRecipientType = (typeof DATA_SHARING_RECIPIENT_TYPES)[number];
export const DataSharingRecipientTypeSchema = z.enum(DATA_SHARING_RECIPIENT_TYPES);

export const DATA_SHARING_PURPOSES = ['LENDER_SUBMISSION', 'PORTFOLIO_REVIEW', 'AUDIT_INSPECTION'] as const;
export type DataSharingPurpose = (typeof DATA_SHARING_PURPOSES)[number];
export const DataSharingPurposeSchema = z.enum(DATA_SHARING_PURPOSES);

export const DATA_SHARING_CHANNELS = ['PORTAL', 'EMAIL', 'API', 'PHYSICAL'] as const;
export type DataSharingChannel = (typeof DATA_SHARING_CHANNELS)[number];
export const DataSharingChannelSchema = z.enum(DATA_SHARING_CHANNELS);

export const CONSENT_PURPOSES = [
  'CONTACT',
  'LOAN_PROCESSING',
  'SHARE_WITH_LENDER',
  'VERIFICATION_CHECK',
  'MARKETING',
] as const;
export type ConsentPurposeCode = (typeof CONSENT_PURPOSES)[number];
export const ConsentPurposeSchema = z.enum(CONSENT_PURPOSES);

export const DataSharingItemsSchema = z.object({
  fields: z.array(z.string()),
  checklistItemIds: z.array(z.string()),
});
export type DataSharingItems = z.infer<typeof DataSharingItemsSchema>;

/**
 * ENT-100: Data Sharing Record
 */
export const DataSharingRecordSchema = z.object({
  id: IdSchema('dsr'),
  tenantId: z.string(),
  subjectType: z.literal('LOAN_APPLICATION'),
  subjectId: z.string(),
  recipientType: DataSharingRecipientTypeSchema,
  recipientId: z.string(),
  purpose: DataSharingPurposeSchema,
  consentIds: z.array(z.string()),
  items: DataSharingItemsSchema,
  channel: DataSharingChannelSchema,
  sourceRef: z.string(),
  actorId: z.string(),
  sharedAt: z.string(),
});
export type DataSharingRecord = z.infer<typeof DataSharingRecordSchema>;

export const ListDataSharingRecordsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  subjectId: z.string().optional(),
  recipientType: DataSharingRecipientTypeSchema.optional(),
  purpose: DataSharingPurposeSchema.optional(),
});
export type ListDataSharingRecordsQuery = z.infer<typeof ListDataSharingRecordsQuerySchema>;

export const ListDataSharingRecordsResponseSchema = z.object({
  items: z.array(DataSharingRecordSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type ListDataSharingRecordsResponse = z.infer<typeof ListDataSharingRecordsResponseSchema>;

export const ProtectionPolicyItemSchema = z.object({
  field: z.string(),
  tier: z.enum(['S0', 'S1', 'S2', 'S3', 'S4']),
  strategy: z.string(),
  description: z.string(),
});
export type ProtectionPolicyItem = z.infer<typeof ProtectionPolicyItemSchema>;

export const PrivacyStatsSchema = z.object({
  activeConsentsCount: z.number().int().nonnegative(),
  withdrawnConsentsCount: z.number().int().nonnegative(),
  totalSharingRecordsCount: z.number().int().nonnegative(),
  consentsByPurpose: z.record(z.string(), z.number()),
  sharingByRecipientType: z.record(z.string(), z.number()),
  protectionPolicies: z.array(ProtectionPolicyItemSchema),
});
export type PrivacyStats = z.infer<typeof PrivacyStatsSchema>;

export const VerifyConsentInputSchema = z.object({
  customerId: z.string().optional(),
  leadId: z.string().optional(),
  purpose: ConsentPurposeSchema,
  purposeTarget: z.string().optional(),
});
export type VerifyConsentInput = z.infer<typeof VerifyConsentInputSchema>;

export const VerifyConsentResultSchema = z.object({
  hasConsent: z.boolean(),
  consentId: z.string().nullable(),
  source: z.enum(['CUSTOMER', 'LEAD']).nullable(),
  purpose: z.string(),
  purposeTarget: z.string().nullable(),
  status: z.enum(['ACTIVE', 'WITHDRAWN', 'MISSING']),
  channel: z.string().nullable(),
  noticeVersion: z.string().nullable(),
  createdAt: z.string().nullable(),
});
export type VerifyConsentResult = z.infer<typeof VerifyConsentResultSchema>;
