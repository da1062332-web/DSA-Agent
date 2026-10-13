// Request and response schemas for origination/catalogue (owner: Dev 3; this slice: Module 14 Lenders, DSA Notion
// MODULE 14). Lenders (ENT-040), empanelments (ENT-041). Products (MODULE 15) are added to this file later.
import { IdSchema } from '@dsa/contracts';
import { z } from 'zod';

// Free text rejects PAN, Aadhaar and 9–18-digit account-like numbers (Contracts §12, S3 out of MVP).
const S3_PATTERNS = [/[A-Z]{5}[0-9]{4}[A-Z]/i, /\b\d{4}\s?\d{4}\s?\d{4}\b/, /\b\d{9,18}\b/];
const safeText = (max: number) =>
  z
    .string()
    .trim()
    .min(2)
    .max(max)
    .refine((s) => !S3_PATTERNS.some((p) => p.test(s)), 'must not contain identity or account numbers');

export const LenderType = z.enum(['BANK', 'NBFC', 'HFC', 'SFB', 'OTHER']);
export const LenderStatus = z.enum(['ACTIVE', 'PAUSED', 'TERMINATED']);
export const ProductCategory = z.enum(['PL', 'BL', 'MSME', 'LAP', 'HL', 'VL', 'GL', 'EL', 'OTHER']);
export const EmpanelmentStatus = z.enum(['ACTIVE', 'SUSPENDED', 'EXPIRED']);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const atLeastOne = (o: Record<string, unknown>) => Object.values(o).some((v) => v !== undefined);

// ---- Lenders (API-LND-001..003, SUB-LND.01 and SUB-LND.05) ----
export const LenderCreate = z
  .object({
    name: safeText(120),
    lenderType: LenderType,
    regulatorRef: z.string().trim().min(2).max(40).nullable().optional(),
  })
  .strict();

export const LenderPatch = z
  .object({
    name: safeText(120).optional(),
    lenderType: LenderType.optional(),
    regulatorRef: z.string().trim().min(2).max(40).nullable().optional(),
    status: LenderStatus.optional(),
    statusReason: safeText(200).nullable().optional(),
  })
  .strict()
  .refine(atLeastOne, 'at least one field is required')
  .refine((p) => p.status === undefined || p.status === 'ACTIVE' || !!p.statusReason, {
    message: 'a reason is required to pause or terminate a lender',
    path: ['statusReason'],
  });

export const Lender = z.object({
  id: IdSchema('lnd'),
  name: z.string(),
  lenderType: LenderType,
  regulatorRef: z.string().nullable(),
  status: LenderStatus,
  statusReason: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Lender = z.infer<typeof Lender>;

// ---- Empanelments (API-LND-004, API-LND-005, SUB-LND.02) ----
export const EmpanelmentCreate = z
  .object({
    dsaCode: z
      .string()
      .trim()
      .regex(/^[A-Z0-9_-]{3,30}$/, '3–30 of A-Z 0-9 _ -'),
    validFrom: IsoDate,
    validTo: IsoDate.nullable().optional(),
    permittedCategories: z.array(ProductCategory).min(1).max(9),
  })
  .strict()
  .refine((e) => !e.validTo || e.validTo >= e.validFrom, {
    message: 'validTo must not be before validFrom',
    path: ['validTo'],
  });

export const EmpanelmentPatch = z
  .object({
    validTo: IsoDate.nullable().optional(),
    permittedCategories: z.array(ProductCategory).min(1).max(9).optional(),
    status: EmpanelmentStatus.optional(),
  })
  .strict()
  .refine(atLeastOne, 'at least one field is required');

export const Empanelment = z.object({
  id: IdSchema('emp'),
  lenderId: z.string(),
  dsaCode: z.string(),
  validFrom: z.string(),
  validTo: z.string().nullable(),
  permittedCategories: z.array(ProductCategory),
  status: EmpanelmentStatus,
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Empanelment = z.infer<typeof Empanelment>;

export const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  status: LenderStatus.optional(),
  type: LenderType.optional(),
  q: z.string().trim().max(100).optional(),
});
