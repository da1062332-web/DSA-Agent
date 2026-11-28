// Lender matches helpers (owner: Dipanshu; task P1-04). Pure: labels, the inputs form ↔ the run body, and the empanelment a new
// lender case uses. The server prefills the inputs and decides every outcome; the screen only edits the inputs and shows the result.
import type {
  LenderMatchField,
  LenderMatchInputValues,
  LenderMatchReason,
  LenderMatchRunRequest,
  LenderPolicyEmploymentType,
} from '@dsa/contracts';

export const REASON_TEXT: Record<LenderMatchReason, string> = {
  POLICY_NOT_EFFECTIVE: 'Policy not in force today',
  BUREAU_SCORE_BELOW_MIN: 'Bureau score below the minimum',
  AGE_BELOW_MIN: 'Below the minimum age',
  AGE_AT_MATURITY_ABOVE_MAX: 'Over the age limit at maturity',
  INCOME_BELOW_MIN: 'Income below the minimum',
  PINCODE_NOT_SERVICEABLE: 'Pincode not serviced',
  CONSTITUTION_NOT_ALLOWED: 'Constitution not accepted',
  EMPLOYMENT_NOT_ALLOWED: 'Applicant type not accepted',
  VINTAGE_BELOW_MIN: 'Vintage below the minimum',
  AMOUNT_BELOW_PRODUCT_MIN: 'Amount below the product minimum',
  TENURE_OUT_OF_RANGE: 'Tenure outside the product range',
  FOIR_EXCEEDED: 'Existing EMIs already use the FOIR limit',
  ELIGIBLE_AMOUNT_BELOW_PRODUCT_MIN: 'Eligible amount below the product minimum',
};

export const FIELD_TEXT: Record<LenderMatchField, string> = {
  requestedAmount: 'Requested amount',
  tenureMonths: 'Tenure',
  monthlyIncome: 'Monthly income',
  monthlyObligations: 'Existing EMIs',
  ageYears: 'Age',
  pincode: 'Pincode',
  bureauScore: 'Bureau score',
  collateralValue: 'Collateral value',
  employmentType: 'Applicant type',
  constitution: 'Constitution',
  vintageMonths: 'Vintage',
};

export const LIMIT_TEXT = {
  REQUESTED: 'the amount asked for',
  PRODUCT_MAX: 'the product maximum',
  FOIR: 'the FOIR cap',
  LTV: 'the LTV cap',
} as const;

/** The inputs form: every value as typed text. */
export type MatchForm = Record<LenderMatchField, string>;

const MONEY_FIELDS = ['requestedAmount', 'monthlyIncome', 'monthlyObligations', 'collateralValue'] as const;
const INT_FIELDS = {
  tenureMonths: [1, 480],
  ageYears: [18, 100],
  bureauScore: [300, 900],
  vintageMonths: [0, 1200],
} as const;

export function inputsToForm(v: LenderMatchInputValues): MatchForm {
  const money = (m: { amount: string } | null) => (m ? String(Number(m.amount)) : '');
  const int = (n: number | null) => (n === null ? '' : String(n));
  return {
    requestedAmount: money(v.requestedAmount),
    tenureMonths: int(v.tenureMonths),
    monthlyIncome: money(v.monthlyIncome),
    monthlyObligations: money(v.monthlyObligations),
    ageYears: int(v.ageYears),
    pincode: v.pincode ?? '',
    bureauScore: int(v.bureauScore),
    collateralValue: money(v.collateralValue),
    employmentType: v.employmentType ?? '',
    constitution: v.constitution ?? '',
    vintageMonths: int(v.vintageMonths),
  };
}

/** The run body: every field is sent, so an emptied box clears the prefilled value for this run. */
export function formToRun(form: MatchForm): {
  body: LenderMatchRunRequest | null;
  errors: Partial<Record<LenderMatchField, string>>;
} {
  const errors: Partial<Record<LenderMatchField, string>> = {};
  const body: Record<string, unknown> = {};
  for (const f of MONEY_FIELDS) {
    const t = form[f].replace(/[,\s₹]/g, '');
    if (t === '') body[f] = null;
    else if (!/^\d{1,16}(\.\d{1,2})?$/.test(t)) errors[f] = 'An amount in rupees.';
    else {
      const [r, p = ''] = t.split('.');
      body[f] = { amount: `${String(Number(r))}.${p.padEnd(2, '0')}`, currency: 'INR' };
    }
  }
  for (const [f, [min, max]] of Object.entries(INT_FIELDS) as [
    keyof typeof INT_FIELDS,
    readonly [number, number],
  ][]) {
    const t = form[f].trim();
    if (t === '') body[f] = null;
    else if (!/^\d+$/.test(t) || Number(t) < min || Number(t) > max)
      errors[f] = `A whole number from ${min} to ${max}.`;
    else body[f] = Number(t);
  }
  const pin = form.pincode.trim();
  if (pin === '') body.pincode = null;
  else if (!/^[1-9][0-9]{5}$/.test(pin)) errors.pincode = 'A 6-digit pincode.';
  else body.pincode = pin;
  body.employmentType =
    form.employmentType === '' ? null : (form.employmentType as LenderPolicyEmploymentType);
  const c = form.constitution.trim().toUpperCase();
  if (c === '') body.constitution = null;
  else if (!/^[A-Z][A-Z_]{1,39}$/.test(c)) errors.constitution = 'A code such as PROPRIETORSHIP.';
  else body.constitution = c;
  return Object.keys(errors).length
    ? { body: null, errors }
    : { body: body as LenderMatchRunRequest, errors };
}

/** ₹8,99,100.00 (Indian grouping); null for no amount. */
export function rupees(m: { amount: string } | null | undefined): string | null {
  if (!m) return null;
  const n = Number(m.amount);
  if (!Number.isFinite(n)) return null;
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const bpsText = (bps: number | null): string | null =>
  bps === null ? null : `${(bps / 100).toFixed(2)}%`;

/** The lender's empanelment a case is created under: ACTIVE, valid today and permitting the category. */
export function empanelmentFor<
  E extends {
    id: string;
    status: string;
    permittedCategories: string[];
    validFrom: string;
    validTo: string | null;
  },
>(empanelments: readonly E[] | undefined, category: string, today: string): E | null {
  return (
    (empanelments ?? []).find(
      (e) =>
        e.status === 'ACTIVE' &&
        e.permittedCategories.includes(category) &&
        e.validFrom.slice(0, 10) <= today &&
        (e.validTo === null || e.validTo.slice(0, 10) >= today),
    ) ?? null
  );
}
