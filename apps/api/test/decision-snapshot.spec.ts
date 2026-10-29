// What a decision record stores of its facts (owner: Dev 2 rules module; MOD-ELG change 2026-10-28). Pure: no database.
import { describe, expect, it } from 'vitest';
import { REDACTED, snapshotForRecord } from '../src/modules/rules/engine/snapshot';

const eligibilityFacts = () => ({
  applicant: {
    employment_type: 'SALARIED',
    credit_score: 790,
    monthly_income: { amount: '80000.00', currency: 'INR' },
  },
  application: { requested_amount: { amount: '300000.00', currency: 'INR' }, tenure_months: 36 },
  product: {
    min_amount: { amount: '50000.00', currency: 'INR' },
    max_amount: { amount: '1000000.00', currency: 'INR' },
  },
});

describe('decision records: stored facts (TEST-ELG-SNAP-001)', () => {
  it('for the eligibility decision the credit score and the income are kept out of the stored snapshot', () => {
    const stored = snapshotForRecord('DK-application.eligibility', eligibilityFacts());
    expect(stored).toMatchObject({
      applicant: { employment_type: 'SALARIED', credit_score: REDACTED, monthly_income: REDACTED },
      application: { requested_amount: { amount: '300000.00', currency: 'INR' }, tenure_months: 36 },
    });
    expect(JSON.stringify(stored)).not.toContain('790');
    expect(JSON.stringify(stored)).not.toContain('80000.00');
  });

  it('the facts the decision itself uses are not changed by storing a redacted copy', () => {
    const facts = eligibilityFacts();
    snapshotForRecord('DK-application.eligibility', facts);
    expect(facts.applicant.credit_score).toBe(790);
    expect(facts.applicant.monthly_income).toEqual({ amount: '80000.00', currency: 'INR' });
  });

  it('other decision keys store their facts unchanged, and so does a record with no sensitive fact in it', () => {
    const facts = { lead: { source: 'WEB' } };
    expect(snapshotForRecord('DK-lead.routing', facts)).toBe(facts);
    const noApplicant = { application: { requested_amount: { amount: '1.00', currency: 'INR' } } };
    expect(snapshotForRecord('DK-application.eligibility', noApplicant)).toEqual(noApplicant);
  });
});
