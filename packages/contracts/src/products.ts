// packages/contracts/src/products.ts — owner: Developer 5 (Bhushan) (MOD-PRD / Module 29)
import { z } from 'zod';
import { IdSchema } from './ids';

import type { ApplicantType } from './ports/decision-keys';

export const LOAN_CATEGORIES = ['PL', 'BL', 'MSME', 'LAP', 'HL', 'VL', 'GL', 'EL', 'OTHER'] as const;
export type LoanCategory = (typeof LOAN_CATEGORIES)[number];

export const PRODUCT_APPLICANT_TYPES = [
  'SALARIED',
  'SELF_EMPLOYED_PROFESSIONAL',
  'SELF_EMPLOYED_BUSINESS',
  'NON_INDIVIDUAL',
] as const;
export type ProductApplicantType = ApplicantType;

export const PRODUCT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PRODUCT_VERSION_STATUSES = ['ACTIVE', 'RETIRED'] as const;
export type ProductVersionStatus = (typeof PRODUCT_VERSION_STATUSES)[number];

export const CreateProductInputSchema = z.object({
  lenderId: IdSchema('lnd'),
  name: z.string().min(2).max(120),
  category: z.enum(LOAN_CATEGORIES),
  applicantTypes: z.array(z.string()).min(1),
  secured: z.boolean(),
  ownerUserId: z.string().optional().nullable(),
  nextReviewAt: z.string().optional().nullable(),
  initialVersion: z
    .object({
      effectiveFrom: z.string().optional(),
      amountMin: z.string().regex(/^\d+(\.\d{1,2})?$/),
      amountMax: z.string().regex(/^\d+(\.\d{1,2})?$/),
      currency: z.string().length(3).default('INR'),
      tenureMinMonths: z.number().int().min(1),
      tenureMaxMonths: z.number().int().min(1),
      illustrativeRateText: z.string().max(255).optional().nullable(),
    })
    .optional(),
});
export type CreateProductInput = z.infer<typeof CreateProductInputSchema>;

export const UpdateProductStatusInputSchema = z.object({
  status: z.enum(PRODUCT_STATUSES),
});
export type UpdateProductStatusInput = z.infer<typeof UpdateProductStatusInputSchema>;

export const CreateProductVersionInputSchema = z.object({
  effectiveFrom: z.string().optional(),
  amountMin: z.string().regex(/^\d+(\.\d{1,2})?$/),
  amountMax: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currency: z.string().length(3).default('INR'),
  tenureMinMonths: z.number().int().min(1),
  tenureMaxMonths: z.number().int().min(1),
  illustrativeRateText: z.string().max(255).optional().nullable(),
  feeText: z.string().max(255).optional().nullable(),
  geoRules: z.record(z.unknown()).optional().nullable(),
  documentProfileId: z.string().optional().nullable(),
  workflowProfile: z.record(z.unknown()).optional().nullable(),
});
export type CreateProductVersionInput = z.infer<typeof CreateProductVersionInputSchema>;

export const ProductVersionResponseSchema = z.object({
  id: IdSchema('lpv'),
  productId: IdSchema('prd'),
  versionNo: z.number().int(),
  effectiveFrom: z.string(),
  amountMin: z.string(),
  amountMax: z.string(),
  currency: z.string(),
  tenureMinMonths: z.number().int(),
  tenureMaxMonths: z.number().int(),
  illustrativeRateText: z.string().nullable(),
  feeText: z.string().nullable().optional(),
  geoRules: z.record(z.unknown()).nullable().optional(),
  documentProfileId: z.string().nullable().optional(),
  workflowProfile: z.record(z.unknown()).nullable().optional(),
  status: z.enum(PRODUCT_VERSION_STATUSES),
  createdAt: z.string(),
});
export type ProductVersionResponse = z.infer<typeof ProductVersionResponseSchema>;

export const ProductResponseSchema = z.object({
  id: IdSchema('prd'),
  lenderId: IdSchema('lnd'),
  lenderName: z.string().optional(),
  name: z.string(),
  category: z.enum(LOAN_CATEGORIES),
  applicantTypes: z.array(z.string()),
  secured: z.boolean(),
  ownerUserId: z.string().nullable(),
  nextReviewAt: z.string().nullable(),
  status: z.enum(PRODUCT_STATUSES),
  lockVersion: z.number().int(),
  activeVersion: ProductVersionResponseSchema.optional().nullable(),
  createdAt: z.string(),
  createdBy: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type ProductResponse = z.infer<typeof ProductResponseSchema>;

export const ProductListQuerySchema = z.object({
  lenderId: z.string().optional(),
  category: z.enum(LOAN_CATEGORIES).optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ProductListQuery = z.infer<typeof ProductListQuerySchema>;
