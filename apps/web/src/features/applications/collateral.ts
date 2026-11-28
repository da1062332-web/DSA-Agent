// Form rules for property collateral on /applications/:id (owner: Bhushan, task P1-03). The API re-checks everything; these only
// keep the form from sending what it would refuse. The user types the value in rupees; the API takes { amount, currency } and
// stores whole paise.
import type {
  COLLATERAL_OCCUPANCY_TYPES,
  COLLATERAL_OWNERSHIP_TYPES,
  COLLATERAL_PROPERTY_TYPES,
  CollateralCreateInput,
} from '@dsa/contracts';
import { hasRestrictedNumber } from './rules';

export const PROPERTY_TYPE_LABELS: Record<(typeof COLLATERAL_PROPERTY_TYPES)[number], string> = {
  RESIDENTIAL_FLAT: 'Residential flat',
  RESIDENTIAL_PLOT: 'Residential plot',
  COMMERCIAL: 'Commercial',
  INDUSTRIAL: 'Industrial',
};
export const OWNERSHIP_LABELS: Record<(typeof COLLATERAL_OWNERSHIP_TYPES)[number], string> = {
  FREEHOLD: 'Freehold',
  LEASEHOLD: 'Leasehold',
};
export const OCCUPANCY_LABELS: Record<(typeof COLLATERAL_OCCUPANCY_TYPES)[number], string> = {
  SELF_OCCUPIED: 'Self-occupied',
  TENANTED: 'Tenanted',
  VACANT: 'Vacant',
};

/**
 * Rupees as typed ("50,00,000", "5000000.5") → the API's two-place amount ("5000000.50"), or null when it is not a positive amount
 * of at most 13 rupee digits. String arithmetic only, so no value is rounded through a float.
 */
export function rupeesToAmount(raw: string): string | null {
  const v = raw.trim().replace(/[,\s]/g, '').replace(/^₹/, '');
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(v);
  if (!m) return null;
  const rupees = m[1]!.replace(/^0+(?=\d)/, '');
  const paise = (m[2] ?? '').padEnd(2, '0');
  if (/^0+$/.test(rupees) && paise === '00') return null;
  return `${rupees}.${paise}`;
}

/** "5000000.00" → "50,00,000.00" (Indian grouping), for an edit box prefilled with the stored value. */
export function amountToRupees(amount: string): string {
  const [whole = '0', fraction = '00'] = amount.split('.');
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = rest ? `${rest},${last3}` : last3;
  return fraction === '00' ? grouped : `${grouped}.${fraction}`;
}

export interface CollateralForm {
  propertyType: CollateralCreateInput['propertyType'] | '';
  addressLine1: string;
  city: string;
  state: string;
  pincode: string;
  value: string;
  ownershipType: CollateralCreateInput['ownershipType'] | '';
  occupancyType: NonNullable<CollateralCreateInput['occupancyType']> | '';
  appraisalDate: string;
}

export const EMPTY_COLLATERAL: CollateralForm = {
  propertyType: '',
  addressLine1: '',
  city: '',
  state: '',
  pincode: '',
  value: '',
  ownershipType: '',
  occupancyType: '',
  appraisalDate: '',
};

/** The first thing wrong with the form, in the order the fields appear, or null when it can be sent. `today` is YYYY-MM-DD. */
export function collateralProblem(f: CollateralForm, today: string): string | null {
  if (!f.propertyType) return 'Choose the property type.';
  const line1 = f.addressLine1.trim();
  if (line1.length < 3 || line1.length > 200) return 'Enter the address (3 to 200 characters).';
  if ([f.addressLine1, f.city, f.state].some(hasRestrictedNumber))
    return 'Do not enter PAN, Aadhaar or account numbers in the address.';
  if (f.city.trim().length < 2) return 'Enter the city.';
  if (f.state.trim().length < 2) return 'Enter the state.';
  if (!/^[1-9][0-9]{5}$/.test(f.pincode.trim())) return 'Enter a six-digit pincode.';
  if (!rupeesToAmount(f.value)) return 'Enter the estimated market value in rupees (more than zero).';
  if (!f.ownershipType) return 'Choose freehold or leasehold.';
  if (f.appraisalDate && f.appraisalDate > today) return 'The appraisal date cannot be in the future.';
  return null;
}

/** The POST body for a valid form (call collateralProblem first). */
export function toCollateralBody(f: CollateralForm): CollateralCreateInput {
  return {
    propertyType: f.propertyType as CollateralCreateInput['propertyType'],
    addressLine1: f.addressLine1.trim(),
    city: f.city.trim(),
    state: f.state.trim(),
    pincode: f.pincode.trim(),
    estimatedMarketValue: { amount: rupeesToAmount(f.value)!, currency: 'INR' },
    ownershipType: f.ownershipType as CollateralCreateInput['ownershipType'],
    occupancyType: f.occupancyType || null,
    appraisalDate: f.appraisalDate || null,
  };
}
