// Schemas for the application checklist (MOD-DOC SUB-DOC.02, API-APP-007). Owner: Dev 3.
import { z } from 'zod';

export const CHECKLIST_STATUSES = [
  'PENDING',
  'SUBMITTED',
  'ACCEPTED',
  'REJECTED',
  'WAIVED',
  'NOT_APPLICABLE',
  'EXPIRED',
] as const;
/** Statuses that need nothing further from the customer or the reviewer. */
export const CHECKLIST_DONE_STATUSES: readonly string[] = ['ACCEPTED', 'WAIVED', 'NOT_APPLICABLE'];

export const ChecklistItemSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  partyId: z.string(),
  documentTypeCode: z.string(),
  ordinal: z.number().int(),
  mandatory: z.boolean(),
  requiredCount: z.number().int(),
  periodMonths: z.number().int().nullable(),
  status: z.enum(CHECKLIST_STATUSES),
  rejectReason: z.string().nullable(),
  attestationNote: z.string().nullable(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().datetime().nullable(),
  documentId: z.string().nullable(),
  sourceDecisionId: z.string(),
  version: z.number().int(),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const ChecklistResponseSchema = z.object({
  data: z.array(ChecklistItemSchema),
  summary: z.object({
    total: z.number().int(),
    mandatory: z.number().int(),
    outstandingMandatory: z.number().int(),
    accepted: z.number().int(),
    rejected: z.number().int(),
    expired: z.number().int(),
    complete: z.boolean(),
  }),
});
export type ChecklistResponse = z.infer<typeof ChecklistResponseSchema>;
