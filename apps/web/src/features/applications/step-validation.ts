// What "Save & next" checks on each step of completing a loan file (owner: Bhushan, 2026-11-28). Pure, so the step form and its tests
// agree. A step passes only when everything it needs is there; the messages say what to fix. The API re-checks every rule when the
// file moves on, so these are for the person filling the file in, not a security control.
import type { ApplicationStatus } from './rules';
import { isValidAmount, isValidTenure } from './rules';
import { JOURNEY, type StageKey } from './loan-file';
import { SECURED_CATEGORIES, type FileFacts } from './stage-checks';

export interface LoanRequestForm {
  amount: string;
  tenure: string;
  purpose: string;
  applicantType: string;
}

export interface StepProblem {
  /** The field or section the problem belongs to, for highlighting. */
  field:
    | 'amount'
    | 'tenure'
    | 'purpose'
    | 'applicantType'
    | 'product'
    | 'income'
    | 'collateral'
    | 'documents'
    | 'eligibility'
    | 'stage';
  message: string;
}

/** The transition "Save & next" runs from a step, when the file is at that step's status, and the permission it needs. */
export const FORWARD: Partial<
  Record<StageKey, { code: 'T-APP-01' | 'T-APP-02' | 'T-APP-04'; permission: string }>
> = {
  draft: { code: 'T-APP-01', permission: 'application.update' },
  documents: { code: 'T-APP-02', permission: 'application.review' },
  review: { code: 'T-APP-04', permission: 'application.review' },
};

/** Problems with the loan request form on its own (shown under the fields as they are typed). */
export function loanRequestProblems(f: LoanRequestForm): StepProblem[] {
  const out: StepProblem[] = [];
  if (!isValidAmount(f.amount)) {
    out.push({
      field: 'amount',
      message: 'Enter the loan amount in rupees, more than zero (for example 500000).',
    });
  }
  if (!f.tenure.trim()) out.push({ field: 'tenure', message: 'Enter the tenure in months.' });
  else if (!isValidTenure(f.tenure))
    out.push({ field: 'tenure', message: 'The tenure must be 1 to 480 months.' });
  if (!f.purpose) out.push({ field: 'purpose', message: 'Choose the purpose of the loan.' });
  if (!f.applicantType) out.push({ field: 'applicantType', message: 'Choose the applicant type.' });
  return out;
}

/**
 * Everything that stops "Save & next" on a step. `status` is where the file is; `productVersionId` is the product chosen on the Draft
 * step (needed only while the file is still a draft).
 */
export function stepProblems(input: {
  stage: StageKey;
  status: ApplicationStatus;
  facts: FileFacts;
  form?: LoanRequestForm;
  productVersionId?: string | null;
  canMatch: boolean;
}): StepProblem[] {
  const { stage, status, facts, form } = input;
  const out: StepProblem[] = [];
  const stageIndex = JOURNEY.findIndex((j) => j.key === stage);
  const fileIndex = JOURNEY.findIndex((j) => j.status === status);
  const fileIsPast = fileIndex > stageIndex || status === 'PARTIALLY_DISBURSED' || status === 'CLOSED';

  switch (stage) {
    case 'draft':
      if (form) out.push(...loanRequestProblems(form));
      if (facts.borrowerIncome === false) {
        out.push({
          field: 'income',
          message:
            "Record the borrower's monthly income on their customer profile: lenders size the loan on it.",
        });
      }
      if (
        (SECURED_CATEGORIES as readonly string[]).includes(facts.productCategory) &&
        facts.collateralItems === 0
      ) {
        out.push({ field: 'collateral', message: 'Add the property pledged: this loan is lent against it.' });
      }
      if (status === 'DRAFT' && !input.productVersionId) {
        out.push({ field: 'product', message: 'Choose the product and the version in force today.' });
      }
      break;
    case 'documents':
      if (!fileIsPast && facts.checklist && !facts.checklist.complete) {
        out.push({
          field: 'documents',
          message:
            facts.checklist.total === 0
              ? 'The document checklist has not been made yet.'
              : `${facts.checklist.outstandingMandatory} mandatory document(s) still to be accepted.`,
        });
      }
      break;
    case 'review':
      if (!fileIsPast && input.canMatch && (facts.eligibleLenders ?? 0) === 0) {
        out.push({
          field: 'eligibility',
          message: 'Run the lender match: at least one lender must take the file before it is ready.',
        });
      }
      break;
    default:
      // Ready and later move on by the lender case, not by a form: the step is finished once the file has moved past it.
      if (!fileIsPast && stage !== 'disbursed') {
        out.push({ field: 'stage', message: JOURNEY[stageIndex]!.movesOn });
      }
  }
  return out;
}
