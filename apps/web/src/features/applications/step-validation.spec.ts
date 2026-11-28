// TEST-WEB-STEPV "Save & next" validation on the steps of a loan file (2026-11-28). Synthetic values only.
import { describe, expect, it } from 'vitest';
import type { FileFacts } from './stage-checks';
import { loanRequestProblems, stepProblems, type LoanRequestForm } from './step-validation';

const facts = (over: Partial<FileFacts> = {}): FileFacts => ({
  productCategory: 'PL',
  productChosen: false,
  tenureMonths: 36,
  purposeCode: 'MEDICAL',
  borrowerIncome: true,
  coApplicants: 0,
  collateralItems: 0,
  checklist: null,
  eligibleLenders: null,
  lenderCases: null,
  ...over,
});
const form = (over: Partial<LoanRequestForm> = {}): LoanRequestForm => ({
  amount: '500000',
  tenure: '36',
  purpose: 'MEDICAL',
  applicantType: 'SALARIED',
  ...over,
});
const fields = (p: { field: string }[]) => p.map((x) => x.field);

describe('TEST-WEB-STEPV step validation', () => {
  it('TEST-WEB-STEPV-01 the loan request needs a positive amount, a 1-480 month tenure, a purpose and an applicant type', () => {
    expect(loanRequestProblems(form())).toEqual([]);
    expect(
      fields(loanRequestProblems(form({ amount: '0', tenure: '', purpose: '', applicantType: '' }))),
    ).toEqual(['amount', 'tenure', 'purpose', 'applicantType']);
    expect(loanRequestProblems(form({ tenure: '600' }))[0]!.message).toMatch(/1 to 480/);
  });

  it('TEST-WEB-STEPV-02 draft also needs the borrower income, the property for a secured loan, and a product while still a draft', () => {
    const base = { stage: 'draft' as const, status: 'DRAFT' as const, canMatch: false };
    expect(fields(stepProblems({ ...base, facts: facts(), form: form(), productVersionId: 'pv_1' }))).toEqual(
      [],
    );
    expect(
      fields(
        stepProblems({
          ...base,
          facts: facts({ borrowerIncome: false, productCategory: 'HL' }),
          form: form(),
          productVersionId: null,
        }),
      ),
    ).toEqual(['income', 'collateral', 'product']);
    // Past the draft, the product is already chosen: it is not asked again.
    expect(
      fields(stepProblems({ ...base, status: 'DOCUMENTS_PENDING', facts: facts(), form: form() })),
    ).toEqual([]);
  });

  it('TEST-WEB-STEPV-03 documents need every mandatory document; review needs an eligible lender when matching is allowed', () => {
    const docs = (complete: boolean) =>
      stepProblems({
        stage: 'documents',
        status: 'DOCUMENTS_PENDING',
        facts: facts({ checklist: { total: 6, outstandingMandatory: complete ? 0 : 4, complete } }),
        canMatch: false,
      });
    expect(docs(false)[0]!.message).toMatch(/4 mandatory/);
    expect(docs(true)).toEqual([]);
    const review = (eligible: number | null, canMatch: boolean) =>
      stepProblems({
        stage: 'review',
        status: 'UNDER_REVIEW',
        facts: facts({ eligibleLenders: eligible }),
        canMatch,
      });
    expect(fields(review(0, true))).toEqual(['eligibility']);
    expect(review(2, true)).toEqual([]);
    expect(review(null, false)).toEqual([]);
  });

  it('TEST-WEB-STEPV-04 ready and later are finished only once the file has moved past them', () => {
    expect(
      fields(
        stepProblems({ stage: 'ready', status: 'READY_FOR_SUBMISSION', facts: facts(), canMatch: false }),
      ),
    ).toEqual(['stage']);
    expect(stepProblems({ stage: 'ready', status: 'SUBMITTED', facts: facts(), canMatch: false })).toEqual(
      [],
    );
    expect(
      stepProblems({ stage: 'disbursed', status: 'DISBURSED', facts: facts(), canMatch: false }),
    ).toEqual([]);
  });
});
