// What each stage of a loan file needs before the file moves on (owner: Bhushan, 2026-11-28). Pure, so the stage panel and its tests
// agree. Each item is ticked from the file's own data; nothing here decides anything the API decides (the API still refuses a
// transition whose rule is not met). An item the caller cannot see (no permission) reads as "not known", never as done.
import type { StageKey } from './loan-file';

export type CheckState = 'done' | 'todo' | 'optional' | 'unknown';

export interface StageCheck {
  label: string;
  state: CheckState;
  hint?: string;
}

/** Loan types that are lent against a property, so a property must be on the file. */
export const SECURED_CATEGORIES = ['HL', 'LAP'] as const;

export interface FileFacts {
  productCategory: string;
  productChosen: boolean;
  tenureMonths: number | null;
  purposeCode: string | null;
  /** The borrower's monthly income on record: true, false, or null when it cannot be read. */
  borrowerIncome: boolean | null;
  coApplicants: number;
  collateralItems: number | null;
  /** The document checklist: null when it cannot be read. */
  checklist: { total: number; outstandingMandatory: number; complete: boolean } | null;
  /** Lender matching: eligible lenders in the latest run, null when there is no run or it cannot be read. */
  eligibleLenders: number | null;
  /** Lender case statuses, null when they cannot be read. */
  lenderCases: string[] | null;
}

const has = (cases: string[] | null, ...statuses: string[]): CheckState =>
  cases === null ? 'unknown' : cases.some((s) => statuses.includes(s)) ? 'done' : 'todo';

const AFTER_SUBMISSION = [
  'SUBMITTED',
  'UNDER_PROCESSING',
  'QUERY_RAISED',
  'QUERY_RESPONDED',
  'SANCTIONED',
  'PARTIALLY_DISBURSED',
  'DISBURSED',
  'CLOSED',
];

export function stageChecks(stage: StageKey, f: FileFacts): StageCheck[] {
  switch (stage) {
    case 'draft': {
      const secured = (SECURED_CATEGORIES as readonly string[]).includes(f.productCategory);
      return [
        {
          label: "Borrower's monthly income recorded",
          state: f.borrowerIncome === null ? 'unknown' : f.borrowerIncome ? 'done' : 'todo',
          hint: 'On the customer profile. Lenders size the loan on it.',
        },
        {
          label: 'Loan request complete: amount, tenure and purpose',
          state: f.tenureMonths && f.purposeCode ? 'done' : 'todo',
        },
        {
          label: f.coApplicants > 0 ? `Co-applicants added (${f.coApplicants})` : 'Co-applicants added',
          state: f.coApplicants > 0 ? 'done' : 'optional',
          hint: 'An earning co-applicant raises the eligible amount: their income is clubbed.',
        },
        {
          label: secured ? 'Property pledged as collateral' : 'Property collateral',
          state:
            f.collateralItems === null
              ? 'unknown'
              : f.collateralItems > 0
                ? 'done'
                : secured
                  ? 'todo'
                  : 'optional',
          hint: secured
            ? 'A secured loan is lent against the property value (LTV).'
            : 'Not needed for an unsecured loan.',
        },
        {
          label: 'Product chosen',
          state: f.productChosen ? 'done' : 'todo',
          hint: 'Chosen when you start the documents.',
        },
      ];
    }
    case 'documents': {
      const c = f.checklist;
      return [
        {
          label: 'Document checklist made',
          state: c === null ? 'unknown' : c.total > 0 ? 'done' : 'todo',
        },
        {
          label:
            c && c.total > 0 && !c.complete
              ? `Every mandatory document accepted (${c.outstandingMandatory} still outstanding)`
              : 'Every mandatory document accepted',
          state: c === null ? 'unknown' : c.complete && c.total > 0 ? 'done' : 'todo',
          hint: 'Send the customer an upload link, or upload and review the documents here.',
        },
      ];
    }
    case 'review':
      return [
        {
          label: 'Documents verified',
          state: f.checklist === null ? 'unknown' : f.checklist.complete ? 'done' : 'todo',
        },
        {
          label:
            f.eligibleLenders && f.eligibleLenders > 0
              ? `Lender-wise eligibility worked out (${f.eligibleLenders} eligible)`
              : 'Lender-wise eligibility worked out',
          state: f.eligibleLenders === null ? 'unknown' : f.eligibleLenders > 0 ? 'done' : 'todo',
          hint: 'Run the lender match below: at least one lender must take the file.',
        },
      ];
    case 'ready':
      return [
        {
          label: 'Lender case opened',
          state: has(f.lenderCases, 'DRAFT', 'PACKAGE_READY', ...AFTER_SUBMISSION),
        },
        {
          label: 'Document package built and frozen',
          state: has(f.lenderCases, 'PACKAGE_READY', ...AFTER_SUBMISSION),
        },
        { label: 'Submitted to the lender', state: has(f.lenderCases, ...AFTER_SUBMISSION) },
      ];
    case 'lender':
      return [
        { label: 'Submitted to the lender', state: has(f.lenderCases, ...AFTER_SUBMISSION) },
        {
          label: 'Lender queries answered',
          state:
            f.lenderCases === null ? 'unknown' : f.lenderCases.includes('QUERY_RAISED') ? 'todo' : 'done',
        },
        {
          label: 'Lender decision: sanctioned',
          state: has(f.lenderCases, 'SANCTIONED', 'PARTIALLY_DISBURSED', 'DISBURSED', 'CLOSED'),
        },
      ];
    case 'sanctioned':
      return [
        {
          label: 'Sanction recorded',
          state: has(f.lenderCases, 'SANCTIONED', 'PARTIALLY_DISBURSED', 'DISBURSED', 'CLOSED'),
        },
        {
          label: 'Disbursement recorded',
          state: has(f.lenderCases, 'PARTIALLY_DISBURSED', 'DISBURSED', 'CLOSED'),
        },
      ];
    case 'disbursed':
      return [
        { label: 'Loan fully disbursed', state: has(f.lenderCases, 'DISBURSED', 'CLOSED') },
        {
          label: 'File closed',
          state: has(f.lenderCases, 'CLOSED'),
          hint: 'Close the file once the payout is confirmed.',
        },
      ];
  }
}

/** Items still to do on a stage (optional and unknown ones do not block). */
export const openChecks = (checks: readonly StageCheck[]): number =>
  checks.filter((c) => c.state === 'todo').length;
