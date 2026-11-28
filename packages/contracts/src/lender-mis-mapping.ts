// packages/contracts/src/lender-mis-mapping.ts — owner: Devyani (lender cases, finance lane). P1-07 / TASK-140.
// One saved mapping per lender: how that bank's daily status sheet is read. Set up once, used every morning.
import { z } from 'zod';
import { IdSchema } from './ids';
import { LenderCaseStatusEnum } from './lender-case';

/**
 * How the bank writes dates. Indian bank sheets are overwhelmingly day-first, and a day-first date read as
 * month-first is silently wrong for the twelve days of each month where both readings are valid dates —
 * which is why this is stated per lender rather than guessed per row.
 */
export const MIS_DATE_FORMATS = ['DD-MM-YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'DD-MMM-YYYY'] as const;
export type MisDateFormat = (typeof MIS_DATE_FORMATS)[number];
export const MisDateFormatEnum = z.enum(MIS_DATE_FORMATS);

/** The fields a status sheet can carry. Only `lenderReference` and `status` are required to move a case. */
export const MIS_TARGET_FIELDS = [
  'lenderReference',
  'status',
  'reasonText',
  'disbursedAmount',
  'disbursedOn',
] as const;
export type MisTargetField = (typeof MIS_TARGET_FIELDS)[number];

/** Column heading in the bank's sheet → the field it holds. */
export const MisColumnMapSchema = z.record(z.string().min(1).max(200), z.enum(MIS_TARGET_FIELDS));
export type MisColumnMap = z.infer<typeof MisColumnMapSchema>;

/**
 * The bank's own word for a stage → our status. Keys are compared case-insensitively and trimmed, because the
 * same bank writes "Disbursed", "DISBURSED" and "Disbursed " in one file.
 */
export const MisStatusMapSchema = z.record(z.string().min(1).max(200), LenderCaseStatusEnum);
export type MisStatusMap = z.infer<typeof MisStatusMapSchema>;

export const CreateLenderMisMappingInputSchema = z.object({
  lenderId: IdSchema('lnd'),
  columnMap: MisColumnMapSchema,
  statusMap: MisStatusMapSchema,
  dateFormat: MisDateFormatEnum.default('DD-MM-YYYY'),
});
export type CreateLenderMisMappingInput = z.input<typeof CreateLenderMisMappingInputSchema>;

/**
 * The body of PUT /v1/lenders/:lenderId/mis-mapping. Every field is required because the mapping is replaced whole:
 * a partial save that dropped half the status map would leave the import silently unable to read words it used to
 * understand, and that failure would only surface on the next morning's sheet.
 */
export const SaveLenderMisMappingInputSchema = CreateLenderMisMappingInputSchema.omit({ lenderId: true });
export type SaveLenderMisMappingInput = z.input<typeof SaveLenderMisMappingInputSchema>;

export const LenderMisMappingResponseSchema = z.object({
  id: IdSchema('mism'),
  lenderId: IdSchema('lnd'),
  columnMap: MisColumnMapSchema,
  statusMap: MisStatusMapSchema,
  dateFormat: MisDateFormatEnum,
  /** Bumped on every save, so an import can record which version of the mapping read it. */
  version: z.number().int(),
  lastImportAt: z.string().nullable(),
  lockVersion: z.number().int(),
  createdAt: z.string(),
  createdBy: z.string(),
});
export type LenderMisMappingResponse = z.infer<typeof LenderMisMappingResponseSchema>;

/** Why a row did not move a case. Each is a row on the exceptions list, never a reason to fail the batch. */
export const MIS_EXCEPTION_REASONS = [
  'UNMATCHED_REFERENCE',
  'UNKNOWN_STATUS_WORD',
  'ILLEGAL_TRANSITION',
  'MISSING_REFERENCE',
  'INVALID_AMOUNT',
  'INVALID_DATE',
  'NO_ACTIVE_SANCTION',
  /** The sanctions module refused the disbursement: over the sanctioned limit, expired, or no disbursement.record. */
  'TRANCHE_REFUSED',
] as const;
export type MisExceptionReason = (typeof MIS_EXCEPTION_REASONS)[number];
