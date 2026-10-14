// MOD-GRV Grievances (owner: Dev 3; DSA Notion MODULE 13, SUB-GRV.01 and .02). Request and response schemas for ENT-034.
// Complaints are about a lead or an application. Customer linking waits for MOD-CUST (Dev 5). The due date stays optional
// until the deadline rules are confirmed.
import { z } from 'zod';

const S3_PATTERNS = [/[A-Z]{5}[0-9]{4}[A-Z]/i, /\b\d{4}\s?\d{4}\s?\d{4}\b/, /\b\d{9,18}\b/];
const safeText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((s) => !S3_PATTERNS.some((p) => p.test(s)), 'must not contain identity or account numbers');
const Ref = z.string().trim().min(3).max(64);

export const ComplainantType = z.enum(['LEAD', 'APPLICATION']);
export const ComplaintChannel = z.enum(['PHONE', 'EMAIL', 'BRANCH', 'WEB', 'LENDER', 'OTHER']);
export const ComplaintCategory = z.enum([
  'SERVICE',
  'PROCESS',
  'CHARGES',
  'COLLECTION',
  'DATA_PRIVACY',
  'OTHER',
]);
export const ComplaintStatus = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED']);

// ---- Intake (API-GRV-001, SUB-GRV.01) ----
export const ComplaintCreate = z
  .object({
    complainantType: ComplainantType,
    complainantId: Ref,
    channel: ComplaintChannel,
    category: ComplaintCategory,
    description: safeText(10, 2000),
    dueAt: z.string().datetime().nullable().optional(),
  })
  .strict();

// ---- Assign, update, refer (API-GRV-003, SUB-GRV.02) ----
export const ComplaintPatch = z
  .object({
    ownerUserId: Ref.nullable().optional(),
    category: ComplaintCategory.optional(),
    dueAt: z.string().datetime().nullable().optional(),
    status: z.literal('IN_PROGRESS').optional(),
    lenderReferral: z
      .object({ lenderId: Ref, reference: safeText(2, 100) })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()
  .refine((p) => Object.values(p).some((v) => v !== undefined), {
    message: 'at least one field is required',
  });

// ---- Resolve or reopen (API-GRV-004, SUB-GRV.02) ----
export const ComplaintResolution = z.discriminatedUnion('action', [
  z.object({ action: z.literal('RESOLVE'), resolution: safeText(10, 2000) }).strict(),
  z.object({ action: z.literal('REOPEN'), reason: safeText(5, 500) }).strict(),
]);

// ---- Queue (API-GRV-002) ----
export const ComplaintListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  status: ComplaintStatus.optional(),
  category: ComplaintCategory.optional(),
  ownerUserId: z.string().optional(),
});

export const Complaint = z.object({
  id: z.string(),
  complainantType: ComplainantType,
  complainantId: z.string(),
  channel: ComplaintChannel,
  category: ComplaintCategory,
  description: z.string(),
  status: ComplaintStatus,
  ownerUserId: z.string().nullable(),
  dueAt: z.string().nullable(),
  ackRef: z.string(),
  lenderReferral: z.record(z.unknown()),
  resolution: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Complaint = z.infer<typeof Complaint>;
