// The DSA working behind a loan eligibility (owner: Bhushan, 2026-11-28): club the income of the borrower and the earning co-applicants,
// add up everyone's existing EMIs, and see how much of the income is already committed (FOIR before the new loan) and how the request
// compares with the property value (LTV). Lender-specific limits (FOIR cap, LTV cap, rate, tenure, age at maturity) are applied by the
// lender matching on the server; these figures only explain the inputs. Whole paise with BigInt, never floats.
import type { BorrowerIncomeLine } from '@dsa/contracts';

const toPaise = (amount: string): bigint => {
  const [whole = '0', fraction = ''] = amount.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
};
const toAmount = (paise: bigint): string => `${paise / 100n}.${String(paise % 100n).padStart(2, '0')}`;

/** A percentage of two paise amounts to one decimal place, rounded half up; null when the base is zero. */
const percent = (part: bigint, whole: bigint): number | null =>
  whole === 0n ? null : Number((part * 1000n + whole / 2n) / whole) / 10;

export interface IncomeTotals {
  /** Monthly income of everyone counted, as a two-place amount; null when no counted borrower has an income. */
  income: string | null;
  obligations: string | null;
  /** Existing EMIs as a share of the counted income (FOIR before the new loan). */
  existingFoirPercent: number | null;
  /** Counted borrowers with no income on record: the lender will ask for it. */
  missingIncome: string[];
}

export function incomeTotals(lines: readonly BorrowerIncomeLine[]): IncomeTotals {
  const counted = lines.filter((l) => l.counted);
  const incomes = counted.filter((l) => l.monthlyIncome).map((l) => toPaise(l.monthlyIncome!.amount));
  const obligations = counted
    .filter((l) => l.monthlyObligations)
    .map((l) => toPaise(l.monthlyObligations!.amount));
  const income = incomes.length ? incomes.reduce((a, b) => a + b, 0n) : null;
  const obl = obligations.length ? obligations.reduce((a, b) => a + b, 0n) : null;
  return {
    income: income === null ? null : toAmount(income),
    obligations: obl === null ? null : toAmount(obl),
    existingFoirPercent: income !== null && obl !== null ? percent(obl, income) : null,
    missingIncome: counted.filter((l) => !l.monthlyIncome).map((l) => l.customerId),
  };
}

/** Requested amount over the pledged value, one decimal; null without a value. */
export const ltvPercent = (requested: string, propertyValue: string | null): number | null =>
  propertyValue === null ? null : percent(toPaise(requested), toPaise(propertyValue));

/** How a borrower's line reads in the working. */
export function countedText(line: BorrowerIncomeLine): string {
  if (!line.counted) return 'Not counted: a guarantor backs the loan but their income is not clubbed.';
  if (line.role === 'CO_APPLICANT') return 'Income clubbed with the borrower';
  return 'Borrower';
}
