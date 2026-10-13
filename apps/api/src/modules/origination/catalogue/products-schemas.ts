// Request and response schemas for MOD-PRD Products (owner: Dev 3; DSA Notion MODULE 15). Products (ENT-043) and
// their immutable, effective-dated versions (ENT-044). Money is a decimal string (Contracts §5).
import { IdSchema } from '@dsa/contracts';
import { z } from 'zod';
import { ProductCategory } from './schemas';

const S3_PATTERNS = [/[A-Z]{5}[0-9]{4}[A-Z]/i, /\b\d{4}\s?\d{4}\s?\d{4}\b/, /\b\d{9,18}\b/];
const safeText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((s) => !S3_PATTERNS.some((p) => p.test(s)), 'must not contain identity or account numbers');
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const Money = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, 'decimal amount, up to 2 places, e.g. "300000.00"');

export const ApplicantType = z.enum([
  'INDIVIDUAL',
  'SALARIED',
  'SELF_EMPLOYED',
  'PROPRIETORSHIP',
  'PARTNERSHIP',
  'PRIVATE_LIMITED',
  'OTHER',
]);
export const ProductStatus = z.enum(['ACTIVE', 'INACTIVE']);
export const VersionStatus = z.enum(['ACTIVE', 'RETIRED']);

// ---- Product (API-PRD-001, API-PRD-002, SUB-PRD.01) ----
export const ProductCreate = z
  .object({
    lenderId: IdSchema('lnd'),
    name: safeText(2, 120),
    category: ProductCategory,
    applicantTypes: z.array(ApplicantType).min(1).max(7),
    secured: z.boolean(),
    ownerUserId: z.string().nullable().optional(),
    nextReviewAt: IsoDate.nullable().optional(),
  })
  .strict();

// ---- Basic details (API-PRD-006). Product-level fields only: the lender is fixed, and terms live in versions. ----
export const ProductPatch = z
  .object({
    name: safeText(2, 120).optional(),
    category: ProductCategory.optional(),
    applicantTypes: z.array(ApplicantType).min(1).max(7).optional(),
    secured: z.boolean().optional(),
    ownerUserId: z.string().nullable().optional(),
    nextReviewAt: IsoDate.nullable().optional(),
  })
  .strict()
  .refine((p) => Object.values(p).some((v) => v !== undefined), {
    message: 'at least one field is required',
  });

// ---- Status (API-PRD-005) ----
export const ProductStatusChange = z
  .object({
    status: ProductStatus,
    reason: safeText(2, 200).nullable().optional(),
  })
  .strict()
  .refine((p) => p.status === 'ACTIVE' || !!p.reason, {
    message: 'a reason is required to deactivate a product',
    path: ['reason'],
  });

// ---- Version (API-PRD-003, API-PRD-004, SUB-PRD.02 and .03, SUB-PRD.04 data) ----
export const GeoRule = z.object({ state: safeText(2, 60), allowed: z.boolean() }).strict();

export const ProductVersionCreate = z
  .object({
    amountMin: Money,
    amountMax: Money,
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('INR'),
    tenureMinMonths: z.number().int().min(1).max(600),
    tenureMaxMonths: z.number().int().min(1).max(600),
    illustrativeRateText: safeText(2, 200).nullable().optional(),
    feeText: safeText(2, 500).nullable().optional(),
    geoRules: z.array(GeoRule).max(100).optional(),
    effectiveFrom: z.string().datetime().optional(),
    documentProfileId: z.string().trim().min(2).max(64).nullable().optional(),
    workflowProfile: z.record(z.unknown()).optional(),
    eligibilityScope: z.record(z.unknown()).optional(),
  })
  .strict()
  .refine((v) => Number(v.amountMax) >= Number(v.amountMin), {
    message: 'amountMax must be at least amountMin',
    path: ['amountMax'],
  })
  .refine((v) => v.tenureMaxMonths >= v.tenureMinMonths, {
    message: 'tenureMaxMonths must be at least tenureMinMonths',
    path: ['tenureMaxMonths'],
  });

export const Product = z.object({
  id: IdSchema('prd'),
  lenderId: z.string(),
  name: z.string(),
  category: ProductCategory,
  applicantTypes: z.array(ApplicantType),
  secured: z.boolean(),
  ownerUserId: z.string().nullable(),
  nextReviewAt: z.string().nullable(),
  status: ProductStatus,
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Product = z.infer<typeof Product>;

export const ProductVersion = z.object({
  id: IdSchema('prv'),
  productId: z.string(),
  versionNo: z.number().int(),
  effectiveFrom: z.string(),
  amountMin: z.string(),
  amountMax: z.string(),
  currency: z.string(),
  tenureMinMonths: z.number().int(),
  tenureMaxMonths: z.number().int(),
  illustrativeRateText: z.string().nullable(),
  feeText: z.string().nullable(),
  geoRules: z.array(GeoRule),
  documentProfileId: z.string().nullable(),
  workflowProfile: z.record(z.unknown()),
  eligibilityScope: z.record(z.unknown()),
  status: VersionStatus,
  /** True for the single ACTIVE version whose effective date has been reached. */
  isCurrent: z.boolean(),
  createdAt: z.string(),
});
export type ProductVersion = z.infer<typeof ProductVersion>;

export const ProductListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  lenderId: z.string().optional(),
  status: ProductStatus.optional(),
  category: ProductCategory.optional(),
  q: z.string().trim().max(100).optional(),
});
