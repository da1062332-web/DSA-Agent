// Lead form rules (DSA Notion MODULE 7, API-LEAD-001). Each rule mirrors the API (apps/api/src/modules/crm/leads/types.ts
// and normalizer.ts) so the form catches problems before sending. The API stays the authority and re-checks everything.

// The option lists the API accepts. Anything else is refused with 422.
export const PRODUCT_CATEGORIES = [
  { value: 'PL', label: 'Personal loan (PL)' },
  { value: 'BL', label: 'Business loan (BL)' },
  { value: 'MSME', label: 'MSME loan' },
  { value: 'LAP', label: 'Loan against property (LAP)' },
  { value: 'HL', label: 'Home loan (HL)' },
  { value: 'VL', label: 'Vehicle loan (VL)' },
  { value: 'GL', label: 'Gold loan (GL)' },
  { value: 'EL', label: 'Education loan (EL)' },
  { value: 'OTHER', label: 'Other' },
] as const;

export const LEAD_SOURCES = [
  { value: 'WALK_IN', label: 'Walk-in' },
  { value: 'PHONE', label: 'Phone' },
  { value: 'WEBSITE', label: 'Website' },
  { value: 'REFERRAL', label: 'Referral' },
  { value: 'CAMPAIGN', label: 'Campaign' },
  { value: 'API', label: 'API' },
  { value: 'OTHER', label: 'Other' },
] as const;

export const CONSENT_PURPOSES = [
  { value: 'CONTACT', label: 'Contact' },
  { value: 'LOAN_PROCESSING', label: 'Loan processing' },
  { value: 'SHARE_WITH_LENDER', label: 'Share with lender' },
  { value: 'VERIFICATION_CHECK', label: 'Verification check' },
  { value: 'MARKETING', label: 'Marketing' },
] as const;

export const CONSENT_CHANNELS = [
  { value: 'IN_PERSON', label: 'In person' },
  { value: 'PHONE', label: 'Phone' },
  { value: 'WEB_FORM', label: 'Web form' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'OTP', label: 'OTP verified' },
  { value: 'DOCUMENT', label: 'Signed document' },
] as const;

export interface LeadForm {
  fullName: string;
  mobile: string;
  email: string;
  pincode: string;
  amount: string;
  branchId: string;
  subSource: string;
  campaign: string;
  noticeVersion: string;
}

export type LeadFieldErrors = Partial<Record<keyof LeadForm, string>>;

/** Same formats the API's normalizer accepts: 10 digits from 6-9, with optional 0, 91 or +91 in front, or E.164. */
export function isValidMobile(raw: string): boolean {
  const m = raw.trim().replace(/[\s\-()]/g, '');
  return (
    /^\+[1-9][0-9]{7,14}$/.test(m) ||
    /^[6-9][0-9]{9}$/.test(m) ||
    /^0[6-9][0-9]{9}$/.test(m) ||
    /^91[6-9][0-9]{9}$/.test(m)
  );
}

/** The API takes a decimal string with exactly two places. "300000" and "300000.5" become "300000.00" and "300000.50". */
export function normalizeAmount(raw: string): string | null {
  const v = raw.trim().replace(/,/g, '');
  if (!/^\d{1,16}(\.\d{1,2})?$/.test(v) || Number(v) <= 0) return null;
  return Number(v).toFixed(2);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLead(f: LeadForm): LeadFieldErrors {
  const e: LeadFieldErrors = {};
  const name = f.fullName.trim();
  if (name.length < 2) e.fullName = 'Enter the full name (at least 2 characters).';
  else if (name.length > 200) e.fullName = 'Keep the name under 200 characters.';

  if (!f.mobile.trim()) e.mobile = 'Enter a mobile number.';
  else if (!isValidMobile(f.mobile)) e.mobile = 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9.';

  if (f.email.trim() && !EMAIL.test(f.email.trim()))
    e.email = 'Enter a valid email address, or leave it blank.';

  if (f.pincode.trim() && !/^[1-9][0-9]{5}$/.test(f.pincode.trim()))
    e.pincode = 'Enter a 6-digit pincode that does not start with 0.';

  if (f.amount.trim() && normalizeAmount(f.amount) === null)
    e.amount = 'Enter an amount greater than zero, for example 300000 or 300000.00.';

  if (!f.branchId.trim()) e.branchId = 'Choose the branch the lead belongs to.';

  if (f.subSource.trim().length > 100) e.subSource = 'Keep this under 100 characters.';
  if (f.campaign.trim().length > 100) e.campaign = 'Keep this under 100 characters.';

  if (!/^[a-zA-Z0-9._-]{2,40}$/.test(f.noticeVersion.trim()))
    e.noticeVersion = 'Use 2 to 40 letters, digits, dots, dashes or underscores, for example v1.0.';

  return e;
}

/** Maps an API detail field (for example "consent.noticeVersion") to the form field it belongs to. */
export function formFieldFor(apiField: string | undefined): keyof LeadForm | undefined {
  if (!apiField) return undefined;
  const map: Record<string, keyof LeadForm> = {
    fullName: 'fullName',
    mobile: 'mobile',
    email: 'email',
    pincode: 'pincode',
    indicativeAmount: 'amount',
    'indicativeAmount.amount': 'amount',
    branchId: 'branchId',
    subSource: 'subSource',
    campaign: 'campaign',
    'consent.noticeVersion': 'noticeVersion',
    noticeVersion: 'noticeVersion',
  };
  return map[apiField];
}
