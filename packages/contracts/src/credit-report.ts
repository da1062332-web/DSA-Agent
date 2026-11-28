// packages/contracts/src/credit-report.ts — owner: Prathamesh (MOD-VER, task P1-05 of the multi-lender plan; migration 0130). The credit-bureau
// soft pull: the request of POST /v1/customers/{id}/credit-reports and the stored summary. Added 2026-11-28 (additive, Contracts §15).
//
// Data handling. The PAN, date of birth and name are typed for ONE pull: they go to the bureau and are never stored, logged, echoed or put in
// an error. The stored summary (score, accounts, EMIs, days past due, enquiries) carries no identifier. A raw credit report is never kept.
import { z } from 'zod';
import { PAN_PATTERN, ageOn, isRealDate } from './customer-profile';
import { IdSchema } from './ids';
import { MoneySchema } from './money';
import { CursorQuery, listResponse } from './pagination';
import { freeTextNoS3 } from './s3-text';

/** The bureau whose report is pulled (not the vendor that carries the call). */
export const CREDIT_BUREAUS = ['CIBIL', 'CRIF', 'EXPERIAN', 'EQUIFAX'] as const;
export type CreditBureau = (typeof CREDIT_BUREAUS)[number];

/** SCORED: the bureau holds a history and returned a score. NO_HISTORY: it holds none for this person (a result, not an error; never score 0). */
export const CREDIT_REPORT_OUTCOMES = ['SCORED', 'NO_HISTORY'] as const;
export type CreditReportOutcome = (typeof CREDIT_REPORT_OUTCOMES)[number];

/** A second request for the same customer and bureau inside this window returns the stored report: the bureau is not called or paid again. */
export const CREDIT_REPORT_CACHE_HOURS = 24;
export const CREDIT_REPORT_MIN_AGE_YEARS = 18;
export const CREDIT_REPORT_MAX_AGE_YEARS = 100;

/**
 * A date of birth a pull may be made for: a real calendar date that makes the person 18 to 100 years old on `now` (a future date gives a
 * negative age and is refused). The clock is passed in. Uses ageOn and isRealDate of customer-profile.ts, so there is one age rule.
 */
export function isPullableDateOfBirth(dateOfBirth: string, now: Date): boolean {
  if (!isRealDate(dateOfBirth)) return false;
  const age = ageOn(dateOfBirth, now);
  return age >= CREDIT_REPORT_MIN_AGE_YEARS && age <= CREDIT_REPORT_MAX_AGE_YEARS;
}

/**
 * POST /v1/customers/{id}/credit-reports. `.strict()`: an unknown key (an Aadhaar number, a mobile, a result) is a 422, never ignored.
 * The age rule needs the clock, so the server applies isPullableDateOfBirth with the request time after this shape check.
 */
export const PullCreditReportSchema = z
  .object({
    bureau: z.enum(CREDIT_BUREAUS),
    /** The name as the bureau should match it. Free text: refused when it holds a PAN, Aadhaar or account-like number. */
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine((s) => !freeTextNoS3(s), 'must not contain identity or account numbers'),
    pan: z
      .string()
      .trim()
      .transform((s) => s.toUpperCase())
      .refine((s) => PAN_PATTERN.test(s), 'must be a valid PAN'),
    dateOfBirth: z
      .string()
      .refine((s) => isRealDate(s) && s >= '1900-01-01', 'must be a real date written YYYY-MM-DD'),
  })
  .strict();
/** What a caller sends. */
export type PullCreditReportInput = z.input<typeof PullCreditReportSchema>;
/** What the server works with after validation: the PAN upper-cased. */
export type PullCreditReport = z.output<typeof PullCreditReportSchema>;

/** The summary of one pull, as stored (ENT: credit_report, migration 0130). It holds no PAN, date of birth, name or raw report. */
export const CreditReportSchema = z.object({
  id: IdSchema('crp'),
  tenantId: z.string(),
  customerId: z.string(),
  consentRecordId: IdSchema('cnst'),
  bureau: z.enum(CREDIT_BUREAUS),
  /** The integration provider that carried the call, for example CRIF. */
  provider: z.string(),
  outcome: z.enum(CREDIT_REPORT_OUTCOMES),
  /** The date the bureau gives the report, YYYY-MM-DD. */
  reportDate: z.string(),
  /** 300 to 900 for SCORED; null for NO_HISTORY. Never a default. */
  score: z.number().int().min(300).max(900).nullable(),
  activeAccounts: z.number().int().nonnegative().nullable(),
  monthlyEmi: MoneySchema.nullable(),
  /** The highest days past due on any account in the last 12 months. */
  maxDpd12m: z.number().int().nonnegative().nullable(),
  enquiries6m: z.number().int().nonnegative().nullable(),
  /** The vendor's request id. */
  vendorRef: z.string().nullable(),
  /** What the bureau charged for the pull, from the connection's configuration; null when none is configured. Never invented. */
  cost: MoneySchema.nullable(),
  pulledBy: IdSchema('usr'),
  pulledAt: z.string().datetime(),
  lockVersion: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type CreditReport = z.infer<typeof CreditReportSchema>;

/** GET /v1/customers/{id}/credit-reports */
export const ListCreditReportsQuerySchema = CursorQuery.extend({
  bureau: z.enum(CREDIT_BUREAUS).optional(),
});
export type ListCreditReportsQuery = z.infer<typeof ListCreditReportsQuerySchema>;
export const ListCreditReportsResponseSchema = listResponse(CreditReportSchema);
export type ListCreditReportsResponse = z.infer<typeof ListCreditReportsResponseSchema>;

/** GET /v1/customers/{id}/credit-reports/latest: the newest report, of one bureau when `bureau` is given. */
export const LatestCreditReportQuerySchema = z.object({ bureau: z.enum(CREDIT_BUREAUS).optional() }).strict();
export type LatestCreditReportQuery = z.infer<typeof LatestCreditReportQuerySchema>;
