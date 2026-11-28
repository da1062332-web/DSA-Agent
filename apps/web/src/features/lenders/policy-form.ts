// Lender policy editor helpers (owner: Dipanshu; task P1-04). Pure: form text ↔ API body. Rates and caps are typed as percentages
// and sent as basis points; money is typed in rupees and sent as { amount: "25000.00", currency: "INR" }; dates are business dates
// (India), sent as the instant midnight IST begins. The server validates again; these checks only give an early, field-level message.
import {
  LENDER_POLICY_EMPLOYMENT_TYPES,
  type LenderPolicy,
  type LenderPolicyCreate,
  type LenderPolicyEmploymentType,
  type LenderPolicyPatch,
} from '@dsa/contracts';

export interface PolicyForm {
  productVersionId: string;
  rateMin: string;
  rateMax: string;
  processingFee: string;
  foirCap: string;
  ltvCap: string;
  minBureauScore: string;
  minAge: string;
  maxAgeAtMaturity: string;
  minIncome: string;
  minVintageMonths: string;
  serviceablePincodes: string;
  allowedConstitutions: string;
  allowedEmployment: LenderPolicyEmploymentType[];
  effectiveFrom: string;
  effectiveTo: string;
}

export type PolicyFormErrors = Partial<Record<keyof PolicyForm, string>>;

export const EMPLOYMENT_LABELS: Record<LenderPolicyEmploymentType, string> = {
  SALARIED: 'Salaried',
  SELF_EMPLOYED_PROFESSIONAL: 'Self-employed professional',
  SELF_EMPLOYED_BUSINESS: 'Self-employed business',
  NON_INDIVIDUAL: 'Non-individual',
};
export const EMPLOYMENT_OPTIONS = LENDER_POLICY_EMPLOYMENT_TYPES;

export const EMPTY_POLICY_FORM: PolicyForm = {
  productVersionId: '',
  rateMin: '',
  rateMax: '',
  processingFee: '',
  foirCap: '',
  ltvCap: '',
  minBureauScore: '',
  minAge: '',
  maxAgeAtMaturity: '',
  minIncome: '',
  minVintageMonths: '',
  serviceablePincodes: '',
  allowedConstitutions: '',
  allowedEmployment: [],
  effectiveFrom: '',
  effectiveTo: '',
};

/** "10.5" → 1050. Up to two decimals, 0–100 %. Null when not a valid percentage. */
export function percentToBps(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const bps = Math.round(Number(t) * 100);
  return bps <= 10_000 ? bps : null;
}

/** 1050 → "10.5"; null → "". */
export const bpsToPercent = (bps: number | null | undefined): string =>
  bps === null || bps === undefined ? '' : String(bps / 100);

/** "25,000" or "25000.5" → "25000.50". Null when not a non-negative rupee amount. */
export function rupeesToAmount(text: string): string | null {
  const t = text.replace(/[,\s₹]/g, '');
  if (!/^\d{1,16}(\.\d{1,2})?$/.test(t)) return null;
  const [r, p = ''] = t.split('.');
  return `${String(Number(r))}.${p.padEnd(2, '0')}`;
}

const IST_OFFSET_MS = 330 * 60_000;

/** "2026-12-01" → "2026-11-30T18:30:00.000Z" (midnight in India). Null when not a calendar date. */
export function businessDateToInstant(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) return null;
  return new Date(ms - IST_OFFSET_MS).toISOString();
}

/** The business date (India) an instant falls on. */
export const instantToBusinessDate = (instant: string | null): string =>
  instant ? new Date(Date.parse(instant) + IST_OFFSET_MS).toISOString().slice(0, 10) : '';

const splitList = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

function intIn(text: string, min: number, max: number): number | null | 'bad' {
  const t = text.trim();
  if (t === '') return null;
  if (!/^\d+$/.test(t)) return 'bad';
  const n = Number(t);
  return n >= min && n <= max ? n : 'bad';
}

/** The terms in the form, checked. `body` is set only when there are no errors. */
export function formToTerms(form: PolicyForm): {
  body: Omit<LenderPolicyCreate, 'lenderId' | 'productVersionId'> | null;
  errors: PolicyFormErrors;
} {
  const errors: PolicyFormErrors = {};
  const pct = (field: keyof PolicyForm, required: boolean, minBps = 0): number | null => {
    const text = String(form[field]).trim();
    if (text === '') {
      if (required) errors[field] = 'Required.';
      return null;
    }
    const bps = percentToBps(text);
    if (bps === null || bps < minBps) errors[field] = 'A percentage from 0 to 100, at most two decimals.';
    return bps;
  };
  const int = (field: keyof PolicyForm, min: number, max: number): number | null => {
    const v = intIn(String(form[field]), min, max);
    if (v === 'bad') {
      errors[field] = `A whole number from ${min} to ${max}.`;
      return null;
    }
    return v;
  };

  const rateMinBps = pct('rateMin', true);
  const rateMaxBps = pct('rateMax', true);
  if (rateMinBps !== null && rateMaxBps !== null && rateMaxBps < rateMinBps)
    errors.rateMax = 'Must be at least the lowest rate.';
  const processingFeeBps = pct('processingFee', false);
  const foirCapBps = pct('foirCap', false, 1);
  const ltvCapBps = pct('ltvCap', false, 1);
  const minBureauScore = int('minBureauScore', 300, 900);
  const minAge = int('minAge', 18, 100);
  const maxAgeAtMaturity = int('maxAgeAtMaturity', 18, 100);
  if (minAge !== null && maxAgeAtMaturity !== null && maxAgeAtMaturity < minAge)
    errors.maxAgeAtMaturity = 'Must be at least the minimum age.';
  const minVintageMonths = int('minVintageMonths', 0, 1200);

  let minIncome: { amount: string; currency: 'INR' } | null = null;
  if (form.minIncome.trim() !== '') {
    const amount = rupeesToAmount(form.minIncome);
    if (amount === null) errors.minIncome = 'An amount in rupees.';
    else minIncome = { amount, currency: 'INR' };
  }

  const serviceablePincodes = splitList(form.serviceablePincodes);
  if (serviceablePincodes.some((p) => !/^[1-9][0-9]{1,5}$/.test(p)))
    errors.serviceablePincodes = 'Pincodes (6 digits) or prefixes (2–5 digits), separated by commas.';
  const allowedConstitutions = splitList(form.allowedConstitutions).map((c) => c.toUpperCase());
  if (allowedConstitutions.some((c) => !/^[A-Z][A-Z_]{1,39}$/.test(c)))
    errors.allowedConstitutions = 'Codes such as PROPRIETORSHIP, PVT_LTD, separated by commas.';

  const effectiveFrom = businessDateToInstant(form.effectiveFrom);
  if (effectiveFrom === null) errors.effectiveFrom = 'Pick the date the policy starts.';
  let effectiveTo: string | null = null;
  if (form.effectiveTo !== '') {
    effectiveTo = businessDateToInstant(form.effectiveTo);
    if (effectiveTo === null) errors.effectiveTo = 'Pick a valid date.';
    else if (effectiveFrom !== null && effectiveTo <= effectiveFrom)
      errors.effectiveTo = 'Must be after the start date.';
  }

  if (Object.keys(errors).length > 0) return { body: null, errors };
  return {
    body: {
      rateMinBps: rateMinBps!,
      rateMaxBps: rateMaxBps!,
      processingFeeBps,
      foirCapBps,
      ltvCapBps,
      minBureauScore,
      minAge,
      maxAgeAtMaturity,
      minIncome,
      minVintageMonths,
      serviceablePincodes,
      allowedConstitutions,
      allowedEmployment: form.allowedEmployment,
      documentProfileId: null,
      effectiveFrom: effectiveFrom!,
      effectiveTo,
    },
    errors,
  };
}

/** A new draft: the terms plus the lender and product version it is for. */
export function formToCreate(
  lenderId: string,
  form: PolicyForm,
): { body: LenderPolicyCreate | null; errors: PolicyFormErrors } {
  const { body, errors } = formToTerms(form);
  if (!form.productVersionId) errors.productVersionId = 'Pick a product version.';
  if (!body || errors.productVersionId) return { body: null, errors };
  return { body: { lenderId, productVersionId: form.productVersionId, ...body }, errors };
}

/** An edit of a draft: every term is sent, so the draft becomes exactly what the form shows. */
export function formToPatch(form: PolicyForm): { body: LenderPolicyPatch | null; errors: PolicyFormErrors } {
  const { body, errors } = formToTerms(form);
  if (!body) return { body: null, errors };
  const { documentProfileId: _unused, ...terms } = body;
  return { body: terms, errors };
}

export function policyToForm(p: LenderPolicy): PolicyForm {
  const int = (n: number | null) => (n === null ? '' : String(n));
  return {
    productVersionId: p.productVersionId,
    rateMin: bpsToPercent(p.rateMinBps),
    rateMax: bpsToPercent(p.rateMaxBps),
    processingFee: bpsToPercent(p.processingFeeBps),
    foirCap: bpsToPercent(p.foirCapBps),
    ltvCap: bpsToPercent(p.ltvCapBps),
    minBureauScore: int(p.minBureauScore),
    minAge: int(p.minAge),
    maxAgeAtMaturity: int(p.maxAgeAtMaturity),
    minIncome: p.minIncome ? String(Number(p.minIncome.amount)) : '',
    minVintageMonths: int(p.minVintageMonths),
    serviceablePincodes: p.serviceablePincodes.join(', '),
    allowedConstitutions: p.allowedConstitutions.join(', '),
    allowedEmployment: [...p.allowedEmployment],
    effectiveFrom: instantToBusinessDate(p.effectiveFrom),
    effectiveTo: instantToBusinessDate(p.effectiveTo),
  };
}

/** Why the current user cannot activate this draft, or null when they can (the server decides; this explains the disabled button). */
export function activationBlocker(
  policy: Pick<LenderPolicy, 'status' | 'editors'>,
  me: { id: string } | undefined,
  canApprove: boolean,
): string | null {
  if (policy.status !== 'DRAFT') return 'Only a draft can be activated.';
  if (!canApprove) return 'Activating needs the rule approval permission.';
  if (me && policy.editors.includes(me.id))
    return 'You drafted or edited this version, so someone else must approve it (maker-checker).';
  return null;
}

/** "10.5 – 12%" for a rate band. */
export const rateBand = (minBps: number, maxBps: number): string =>
  minBps === maxBps ? `${bpsToPercent(minBps)}%` : `${bpsToPercent(minBps)} – ${bpsToPercent(maxBps)}%`;
