// apps/api/src/modules/crm/leads/types.ts — owner: Dev 5 (MOD-04 Leads)
import { CursorQuery, MoneySchema, type Money } from '@dsa/contracts';
import { z } from 'zod';

export const PRODUCT_CATEGORIES = ['PL', 'BL', 'MSME', 'LAP', 'HL', 'VL', 'GL', 'EL', 'OTHER'] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export const ProductCategorySchema = z.enum(PRODUCT_CATEGORIES);

export const LEAD_SOURCES = ['WALK_IN', 'PHONE', 'WEBSITE', 'REFERRAL', 'CAMPAIGN', 'API', 'OTHER'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const LeadSourceSchema = z.enum(LEAD_SOURCES);

export const LEAD_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type LeadPriority = (typeof LEAD_PRIORITIES)[number];
export const LeadPrioritySchema = z.enum(LEAD_PRIORITIES);

export const LEAD_STATES = [
  'NEW',
  'CONTACT_ATTEMPTED',
  'IN_PROGRESS',
  'QUALIFIED',
  'CONVERTED',
  'DISQUALIFIED',
  'NOT_CONTACTABLE',
  'MERGED',
  'ARCHIVED',
] as const;
export type LeadState = (typeof LEAD_STATES)[number];
export const LeadStateSchema = z.enum(LEAD_STATES);

export const DUPLICATE_FLAGS = ['NONE', 'POSSIBLE', 'EXACT', 'ATTRIBUTION_CONFLICT'] as const;
export type DuplicateFlag = (typeof DUPLICATE_FLAGS)[number];
export const DuplicateFlagSchema = z.enum(DUPLICATE_FLAGS);

export const DISQUALIFICATION_REASONS = [
  'NOT_INTERESTED',
  'NOT_ELIGIBLE',
  'DUPLICATE',
  'UNREACHABLE',
  'OTHER',
] as const;
export type DisqualificationReason = (typeof DISQUALIFICATION_REASONS)[number];
export const DisqualificationReasonSchema = z.enum(DISQUALIFICATION_REASONS);

export const APPLICANT_TYPES = [
  'SALARIED',
  'SELF_EMPLOYED_PROFESSIONAL',
  'SELF_EMPLOYED_BUSINESS',
  'NON_INDIVIDUAL',
] as const;
export type ApplicantType = (typeof APPLICANT_TYPES)[number];
export const ApplicantTypeSchema = z.enum(APPLICANT_TYPES);

export const CONSENT_PURPOSES = [
  'CONTACT',
  'LOAN_PROCESSING',
  'SHARE_WITH_LENDER',
  'VERIFICATION_CHECK',
  'MARKETING',
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export const ConsentPurposeSchema = z.enum(CONSENT_PURPOSES);

export const CONSENT_CHANNELS = ['IN_PERSON', 'PHONE', 'WEB_FORM', 'EMAIL', 'OTP', 'DOCUMENT'] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];
export const ConsentChannelSchema = z.enum(CONSENT_CHANNELS);

export const LeadConsentInputSchema = z.object({
  purpose: ConsentPurposeSchema.default('CONTACT'),
  purposeTarget: z.string().nullable().optional(),
  noticeVersion: z
    .string()
    .regex(/^[a-zA-Z0-9._-]{2,40}$/, 'noticeVersion must match ^[a-zA-Z0-9._-]{2,40}$'),
  channel: ConsentChannelSchema,
  evidenceRef: z.string().nullable().optional(),
});
export type LeadConsentInput = z.infer<typeof LeadConsentInputSchema>;

export const CreateLeadInputSchema = z.object({
  fullName: z.string().min(2).max(200),
  mobile: z.string().min(8).max(25),
  email: z.string().email().nullable().optional(),
  productCategory: ProductCategorySchema,
  indicativeAmount: MoneySchema.nullable().optional(),
  pincode: z
    .string()
    .regex(/^[1-9][0-9]{5}$/, 'pincode must be 6 digits')
    .nullable()
    .optional(),
  branchId: z.string().min(1),
  source: LeadSourceSchema,
  subSource: z.string().max(100).nullable().optional(),
  campaign: z.string().max(100).nullable().optional(),
  utm: z.record(z.unknown()).nullable().optional(),
  connectorId: z.string().nullable().optional(),
  priority: LeadPrioritySchema.optional().default('MEDIUM'),
  tags: z.array(z.string()).optional().default([]),
  consent: LeadConsentInputSchema,
});
export type CreateLeadInput = z.infer<typeof CreateLeadInputSchema>;

export const UpdateLeadInputSchema = z.object({
  fullName: z.string().min(2).max(200).optional(),
  email: z.string().email().nullable().optional(),
  indicativeAmount: MoneySchema.nullable().optional(),
  pincode: z
    .string()
    .regex(/^[1-9][0-9]{5}$/)
    .nullable()
    .optional(),
  priority: LeadPrioritySchema.optional(),
  tags: z.array(z.string()).optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
  qualApplicantType: ApplicantTypeSchema.nullable().optional(),
  qualRequestedAmount: MoneySchema.nullable().optional(),
  qualTenureMonths: z.number().int().min(1).max(480).nullable().optional(),
  qualPurposeCode: z.string().nullable().optional(),
});
export type UpdateLeadInput = z.infer<typeof UpdateLeadInputSchema>;

export const LeadTransitionInputSchema = z.object({
  transitionCode: z.enum(['T-LEAD-01', 'T-LEAD-02', 'T-LEAD-04', 'T-LEAD-05', 'T-LEAD-06']),
  reasonCode: z.string().nullable().optional(),
  disqualificationReason: DisqualificationReasonSchema.nullable().optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
  qualification: z
    .object({
      applicantType: ApplicantTypeSchema,
      requestedAmount: MoneySchema,
      tenureMonths: z.number().int().min(1).max(480).nullable().optional(),
      purposeCode: z.string().nullable().optional(),
    })
    .optional(),
});
export type LeadTransitionInput = z.infer<typeof LeadTransitionInputSchema>;

export const AssignLeadInputObjectSchema = z.object({
  toUserId: z.string().nullable().optional(),
  toQueueId: z.string().nullable().optional(),
  reasonCode: z
    .enum(['AUTO_ROUTING', 'ROUTING_FALLBACK', 'MANUAL', 'REBALANCE', 'OWNER_INACTIVE'])
    .default('MANUAL'),
  transferOpenTasks: z.boolean().optional(),
});

export const AssignLeadInputSchema = AssignLeadInputObjectSchema.refine(
  (data) => (data.toUserId == null) !== (data.toQueueId == null),
  {
    message: 'Exactly one of toUserId or toQueueId must be provided',
  },
);
export type AssignLeadInput = z.infer<typeof AssignLeadInputSchema>;

export const ConvertLeadInputSchema = z.object({
  customerId: z.string().nullable().optional(),
});
export type ConvertLeadInput = z.infer<typeof ConvertLeadInputSchema>;

export const LeadListQuerySchema = CursorQuery.extend({
  'filter[state]': z.string().optional(),
  state: z.string().optional(),
  'filter[ownerUserId]': z.string().optional(),
  ownerUserId: z.string().optional(),
  'filter[branchId]': z.string().optional(),
  branchId: z.string().optional(),
});
export type LeadListQuery = z.infer<typeof LeadListQuerySchema>;

export interface MaskedLeadResource {
  id: string;
  tenantId: string;
  branchId: string;
  fullName: string;
  mobileMasked: string;
  emailMasked: string | null;
  productCategory: ProductCategory;
  indicativeAmount: Money | null;
  pincode: string | null;
  source: string;
  subSource: string | null;
  campaign: string | null;
  utm: Record<string, unknown> | null;
  connectorId: string | null;
  state: LeadState;
  ownerUserId: string | null;
  ownerQueueId: string | null;
  priority: LeadPriority;
  customerId: string | null;
  applicationId: string | null;
  duplicateFlag: DuplicateFlag;
  duplicateCandidateIds: string[];
  contactAttempts: number;
  tags: string[];
  nextFollowUpAt: string | null;
  qualApplicantType: ApplicantType | null;
  qualRequestedAmount: Money | null;
  qualTenureMonths: number | null;
  qualPurposeCode: string | null;
  disqualificationReason: DisqualificationReason | null;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface LeadConversionResult {
  leadId: string;
  customerId: string;
  applicationId: string;
  status: 'CONVERTED';
}
