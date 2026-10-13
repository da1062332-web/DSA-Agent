// apps/api/src/modules/crm/customers/types.ts — owner: Dev 5 (MOD-CUST)
import type { ConsentPurpose } from '@dsa/contracts';
import { z } from 'zod';

export const PartyTypeEnum = z.enum(['INDIVIDUAL', 'ENTITY']);
export type PartyType = z.infer<typeof PartyTypeEnum>;

export const CustomerStatusEnum = z.enum(['ACTIVE', 'MERGED']);
export type CustomerStatus = z.infer<typeof CustomerStatusEnum>;

export interface CustomerRow {
  id: string;
  tenant_id: string;
  party_type: PartyType;
  full_name: string;
  home_branch_id: string;
  status: CustomerStatus;
  lock_version: number;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
}

export const ConsentChannelEnum = z.enum([
  'IN_PERSON',
  'PHONE',
  'WEB_FORM',
  'EMAIL',
  'OTP',
  'DOCUMENT',
]);
export type ConsentChannel = z.infer<typeof ConsentChannelEnum>;

export const ConsentPurposeEnum = z.enum([
  'CONTACT',
  'LOAN_PROCESSING',
  'SHARE_WITH_LENDER',
  'VERIFICATION_CHECK',
  'MARKETING',
]);

export const ConsentStatusEnum = z.enum(['ACTIVE', 'WITHDRAWN', 'EXPIRED']);
export type ConsentStatus = z.infer<typeof ConsentStatusEnum>;

/** API-CUST-001: Customer Creation Input */
export const CreateCustomerSchema = z
  .object({
    partyType: PartyTypeEnum,
    fullName: z
      .string()
      .min(2, 'Full name must be at least 2 characters')
      .max(200, 'Full name cannot exceed 200 characters'),
    homeBranchId: z.string().min(1, 'Home branch ID is required'),
    primaryMobile: z.string().optional(),
    primaryEmail: z.string().email('Invalid email address').optional(),
    // S3-class fields that must be explicitly rejected if provided
    pan: z.unknown().optional(),
    aadhaar: z.unknown().optional(),
    dob: z.unknown().optional(),
    dateOfBirth: z.unknown().optional(),
    bankAccount: z.unknown().optional(),
    bankAccountNumber: z.unknown().optional(),
  })
  .strict();
export type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>;

/** API-CUST-003: Customer Profile Update Input */
export const UpdateCustomerSchema = z
  .object({
    fullName: z
      .string()
      .min(2, 'Full name must be at least 2 characters')
      .max(200, 'Full name cannot exceed 200 characters')
      .optional(),
    homeBranchId: z.string().min(1, 'Home branch ID is required').optional(),
    // S3-class fields that must be explicitly rejected if provided
    pan: z.unknown().optional(),
    aadhaar: z.unknown().optional(),
    dob: z.unknown().optional(),
    dateOfBirth: z.unknown().optional(),
    bankAccount: z.unknown().optional(),
    bankAccountNumber: z.unknown().optional(),
  })
  .strict();
export type UpdateCustomerInput = z.infer<typeof UpdateCustomerSchema>;

/** API-CUST-004: Customer Consent Registration Input */
export const CreateConsentSchema = z
  .object({
    purpose: ConsentPurposeEnum,
    purposeTarget: z.string().optional(),
    noticeVersion: z
      .string()
      .regex(/^[A-Z0-9._-]{2,40}$/, 'Invalid notice version format (must match ^[A-Z0-9._-]{2,40}$)'),
    channel: ConsentChannelEnum,
    evidenceRef: z.string().max(255).optional(),
    expiresAt: z.string().datetime().optional(),
  })
  .refine(
    (data) => {
      if (
        (data.purpose === 'SHARE_WITH_LENDER' || data.purpose === 'VERIFICATION_CHECK') &&
        !data.purposeTarget
      ) {
        return false;
      }
      return true;
    },
    {
      message: 'purposeTarget is required when purpose is SHARE_WITH_LENDER or VERIFICATION_CHECK',
      path: ['purposeTarget'],
    },
  );
export type CreateConsentInput = z.infer<typeof CreateConsentSchema>;

/** API-CUST-005: Consent Withdrawal Input */
export const WithdrawConsentSchema = z.object({
  withdrawalReason: z.string().max(500).optional(),
});
export type WithdrawConsentInput = z.infer<typeof WithdrawConsentSchema>;

/** API-CUST-010: Customer List Query */
export const CustomerListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  partyType: PartyTypeEnum.optional(),
  'filter[partyType]': PartyTypeEnum.optional(),
  homeBranchId: z.string().optional(),
  'filter[homeBranchId]': z.string().optional(),
  status: CustomerStatusEnum.optional(),
  'filter[status]': CustomerStatusEnum.optional(),
});
export type CustomerListQuery = z.infer<typeof CustomerListQuerySchema>;

/** Masked representation of Customer */
export interface MaskedCustomerResource {
  id: string;
  tenantId: string;
  partyType: PartyType;
  fullName: string;
  homeBranchId: string;
  status: CustomerStatus;
  lockVersion: number;
  primaryMobileMasked?: string | null;
  primaryEmailMasked?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Representation of Consent Record */
export interface ConsentResource {
  id: string;
  tenantId: string;
  subjectType: 'CUSTOMER' | 'LEAD';
  subjectId: string;
  purpose: ConsentPurpose;
  purposeTarget: string | null;
  noticeVersion: string;
  channel: ConsentChannel;
  evidenceRef: string | null;
  capturedBy: string;
  capturedAt: string;
  status: ConsentStatus;
  withdrawnAt: string | null;
  withdrawnBy: string | null;
  withdrawalReason: string | null;
  expiresAt: string | null;
  createdAt: string;
}
