// packages/contracts/src/activity.ts — owner: Dev 1 / Dev 5
import { z } from 'zod';
import { IdSchema } from './ids';

export const ACTIVITY_KINDS = ['CALL', 'MEETING', 'VISIT', 'NOTE'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_OUTCOME_CODES = [
  'CONNECTED',
  'NO_ANSWER',
  'BUSY',
  'SWITCHED_OFF',
  'WRONG_NUMBER',
  'CALLBACK_REQUESTED',
  'NOT_INTERESTED',
  'OTHER',
] as const;
export type ActivityOutcomeCode = (typeof ACTIVITY_OUTCOME_CODES)[number];

export const SUBJECT_TYPES = ['LEAD', 'CUSTOMER', 'LOAN_APPLICATION'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

/**
 * Free-text fields reject PAN, Aadhaar and 9–18-digit account patterns with 422 VALIDATION_ERROR (Contracts §12).
 */
export function containsS2SensitiveData(text: string): boolean {
  if (!text) return false;
  // Indian PAN (5 letters, 4 digits, 1 letter)
  if (/[A-Za-z]{5}\d{4}[A-Za-z]/.test(text)) return true;
  // Indian Aadhaar (12 digits, starting with 2-9)
  if (/\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/.test(text)) return true;
  // 9–18-digit account / UTR patterns
  if (/\b\d{9,18}\b/.test(text)) return true;
  return false;
}

export const ActivitySubjectLinkSchema = z.object({
  type: z.enum(SUBJECT_TYPES),
  id: z.string().min(1),
});
export type ActivitySubjectLink = z.infer<typeof ActivitySubjectLinkSchema>;

export const CreateActivitySchema = z
  .object({
    kind: z.enum(ACTIVITY_KINDS),
    subjectType: z.enum(SUBJECT_TYPES).optional(),
    subjectId: z.string().min(1).optional(),
    links: z.array(ActivitySubjectLinkSchema).optional(),
    outcomeCode: z.enum(ACTIVITY_OUTCOME_CODES).optional().nullable(),
    occurredAt: z.string().datetime({ message: 'occurredAt must be an ISO 8601 UTC timestamp' }),
    durationSeconds: z.number().int().min(0).optional().nullable(),
    duration_s: z.number().int().min(0).optional().nullable(),
    note: z
      .string()
      .max(4000)
      .refine((n) => !containsS2SensitiveData(n), {
        message: 'Free-text fields must not contain PAN, Aadhaar, or account number patterns (S2 protection).',
      })
      .optional()
      .nullable(),
  })
  .superRefine((data, ctx) => {
    // Subject linkage check: either subjectType + subjectId, or links array
    const hasDirect = Boolean(data.subjectType && data.subjectId);
    const hasLinks = Boolean(data.links && data.links.length > 0);
    if (!hasDirect && !hasLinks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subjectId'],
        message: 'Must link to at least one valid subject (lead, customer, or loan application)',
      });
    }

    // Call outcome check: kind == CALL requires outcomeCode
    if (data.kind === 'CALL' && !data.outcomeCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['outcomeCode'],
        message: 'outcomeCode is required when kind is CALL',
      });
    }
  });

export type CreateActivityInput = z.infer<typeof CreateActivitySchema>;

export const UpdateActivitySchema = z
  .object({
    outcomeCode: z.enum(ACTIVITY_OUTCOME_CODES).optional().nullable(),
    durationSeconds: z.number().int().min(0).optional().nullable(),
    duration_s: z.number().int().min(0).optional().nullable(),
    note: z
      .string()
      .max(4000)
      .refine((n) => !containsS2SensitiveData(n), {
        message: 'Free-text fields must not contain PAN, Aadhaar, or account number patterns (S2 protection).',
      })
      .optional()
      .nullable(),
    isHidden: z.boolean().optional(),
  })
  .strict();

export type UpdateActivityInput = z.infer<typeof UpdateActivitySchema>;

export const ActivitySchema = z.object({
  id: IdSchema('act'),
  tenantId: z.string(),
  subjectType: z.enum(SUBJECT_TYPES),
  subjectId: z.string(),
  links: z.array(ActivitySubjectLinkSchema),
  kind: z.enum(ACTIVITY_KINDS),
  outcomeCode: z.enum(ACTIVITY_OUTCOME_CODES).nullable(),
  occurredAt: z.string(),
  durationSeconds: z.number().int().nullable(),
  note: z.string().nullable(),
  actorId: z.string(),
  actorBranchId: z.string(),
  actorTeamId: z.string().nullable(),
  lockVersion: z.number().int(),
  isHidden: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Activity = z.infer<typeof ActivitySchema>;
