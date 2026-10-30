// Origination flow for the demo seed — owner: Dev 3/4 lane, folded into the flow seed. Synthetic data only.
// Flow per cohort: lead → qualification → customer → loan application → documents and checklist → verification
// → lender case → submission → query → sanction → disbursement tranches. Ten leads and ten applications per tenant
// are shaped so every status the CHECK constraints allow is reached by at least one row.
import type {
  Tables} from './types';
import {
  FIRMS,
  FIRST_NAMES,
  LAST_NAMES,
  ANCHOR,
  at,
  emailFor,
  ix,
  mobileFor,
  onDate,
  pad,
  sha256Bytes,
  sha256Hex,
} from './types';
import { type Tenant, connectorId, idOf } from './tenant-core';

export interface Origination {
  leads: string[];
  customers: string[];
  apps: string[];
  lenders: string[];
  productVersions: string[];
  lenderCases: string[];
  caseApps: string[];
  submissionPackages: string[];
  sanctions: { id: string; lenderCase: number; lender: number; status: string; amount: number }[];
  tranches: {
    id: string;
    sanction: string;
    amount: number;
    status: string;
    lender: number;
    lenderCase: string;
    disbursedOn: string;
  }[];
  consentIds: string[];
  customerConsentIds: string[][];
  documents: string[];
  checklistIds: string[];
  decisionIds: string[];
  importBatches: string[];
  partyIds: string[];
}

const LEAD_STATES = [
  'CONVERTED',
  'CONVERTED',
  'CONVERTED',
  'QUALIFIED',
  'IN_PROGRESS',
  'CONTACT_ATTEMPTED',
  'DISQUALIFIED',
  'NOT_CONTACTABLE',
  'MERGED',
  'ARCHIVED',
] as const;
const PRODUCT_CATS = ['PL', 'PL', 'BL', 'LAP', 'HL', 'PL', 'MSME', 'VL', 'PL', 'BL'] as const;
const LENDER_DEFS = [
  { name: 'Northstar Housing Finance', type: 'HFC', ref: 'NSHF-001' },
  { name: 'Bharat Commercial Bank', type: 'BANK', ref: 'BCB-002' },
  { name: 'Sunrise Small Finance Bank', type: 'SFB', ref: 'SSFB-003' },
  { name: 'Meridian NBFC Ltd', type: 'NBFC', ref: 'MNBFC-004' },
  { name: 'Vanguard Home Finance', type: 'HFC', ref: 'VHF-005' },
  { name: 'Cedar Credit Finance', type: 'NBFC', ref: 'CCF-006' },
  { name: 'Lakeview Micro Finance', type: 'OTHER', ref: 'LMF-007' },
  { name: 'Coastal Capital NBFC', type: 'NBFC', ref: 'CCN-008' },
] as const;
const PRODUCTS = [
  { name: 'Personal Loan - Salaried', cat: 'PL', secured: false },
  { name: 'Personal Loan - Plus', cat: 'PL', secured: false },
  { name: 'Business Loan - Starter', cat: 'BL', secured: false },
  { name: 'Loan Against Property', cat: 'LAP', secured: true },
  { name: 'Home Loan - Smart', cat: 'HL', secured: true },
  { name: 'Vehicle Loan - Two Wheeler', cat: 'VL', secured: true },
  { name: 'MSME Working Capital', cat: 'MSME', secured: false },
  { name: 'Business Loan - Growth', cat: 'BL', secured: false },
] as const;
const DOC_TYPES = [
  {
    code: 'KYC_ID',
    name: 'Identity proof',
    category: 'IDENTITY',
    sensitivity: 'S3',
    retention: 'R-LOAN',
    validity: null,
  },
  {
    code: 'ADDRESS_PROOF',
    name: 'Address proof',
    category: 'ADDRESS',
    sensitivity: 'S2',
    retention: 'R-LOAN',
    validity: null,
  },
  {
    code: 'BANK_STATEMENT',
    name: 'Bank statement (6 months)',
    category: 'BANKING',
    sensitivity: 'S3',
    retention: 'R-FIN',
    validity: 3,
  },
  {
    code: 'SALARY_SLIP',
    name: 'Salary slip',
    category: 'INCOME',
    sensitivity: 'S2',
    retention: 'R-LOAN',
    validity: 3,
  },
  {
    code: 'ITR_ACK',
    name: 'Income tax return acknowledgement',
    category: 'INCOME',
    sensitivity: 'S2',
    retention: 'R-FIN',
    validity: 12,
  },
  {
    code: 'GST_CERT',
    name: 'GST registration certificate',
    category: 'BUSINESS',
    sensitivity: 'S1',
    retention: 'R-FIN',
    validity: null,
  },
  {
    code: 'PROPERTY_PAPERS',
    name: 'Property papers',
    category: 'PROPERTY',
    sensitivity: 'S3',
    retention: 'R-AUD',
    validity: null,
  },
  {
    code: 'EMPLOYMENT_LETTER',
    name: 'Employment letter',
    category: 'INCOME',
    sensitivity: 'S2',
    retention: 'R-LOAN',
    validity: 6,
  },
] as const;

/** Lender used by each application index; the seventh lender stays PAUSED and has no cases. */
const APP_LENDER = [0, 1, 2, 3, 4, 5, 6, 0, 1, 2];
/** Lender case status per application (null means no case). */
const APP_CASE_STATUS: (string | null)[] = [
  'DISBURSED',
  'PARTIALLY_DISBURSED',
  'SANCTIONED',
  'SANCTIONED',
  'SUBMITTED',
  'QUERY_RAISED',
  null,
  'PACKAGE_READY',
  'REJECTED',
  'WITHDRAWN',
];
const APP_STATUS = [
  'DISBURSED',
  'PARTIALLY_DISBURSED',
  'SANCTIONED',
  'SANCTIONED',
  'SUBMITTED',
  'UNDER_REVIEW',
  'DOCUMENTS_PENDING',
  'READY_FOR_SUBMISSION',
  'REJECTED',
  'CANCELLED',
] as const;
const APP_AMOUNT = [1500000, 800000, 1200000, 600000, 2500000, 900000, 400000, 1800000, 700000, 350000];

export function buildOrigination(
  t: Tenant,
  out: Tables,
  staff: { rm1: string; rm2: string; loanops: string; owner: string; branchmgr: string; compliance: string },
): Origination {
  const d = ANCHOR;
  const rm = [staff.rm1, staff.rm2];
  const created = (by: string) => ({ created_by: by, updated_by: by });

  // Lenders, empanelments, products and versions ------------------------------------------------------------
  const lenders = LENDER_DEFS.map((l, i) => idOf(t, 'lnd', i + 1));
  LENDER_DEFS.forEach((l, i) =>
    out.add('lender', {
      id: ix(lenders, i),
      tenant_id: t.id,
      name: l.name,
      lender_type: l.type,
      regulator_ref: `RBI-${l.ref}`,
      status: i === 7 ? 'PAUSED' : 'ACTIVE',
      status_reason: i === 7 ? 'Panel review in progress (synthetic)' : null,
      global_lender_ref: l.ref,
      reason_map: [
        { code: 'INCOME', label: 'Income below policy' },
        { code: 'CREDIT_HISTORY', label: 'Credit history' },
      ],
      ...created(staff.owner),
    }),
  );

  // Lender contacts, two per lender: the credit desk and an escalation contact.
  lenders.forEach((lid, i) => {
    out.add('lender_contact', {
      id: idOf(t, 'lct', i * 2 + 1),
      tenant_id: t.id,
      lender_id: lid,
      name: `${ix(FIRST_NAMES, i)} ${ix(LAST_NAMES, i)} (credit desk)`,
      role: 'Credit desk',
      email: `creditdesk${i + 1}@lender.example.com`,
      phone: mobileFor(t.tagDigit, 500 + i),
      channel: 'EMAIL',
      escalation_level: 1,
      created_by: staff.owner,
      updated_by: staff.owner,
    });
    out.add('lender_contact', {
      id: idOf(t, 'lct', i * 2 + 2),
      tenant_id: t.id,
      lender_id: lid,
      name: `${ix(LAST_NAMES, (i + 5) % 20)} (zonal head)`,
      role: 'Zonal head',
      email: `zonal${i + 1}@lender.example.com`,
      phone: null,
      channel: 'PHONE',
      escalation_level: 2,
      created_by: staff.owner,
      updated_by: staff.owner,
    });
  });

  const empanelments = lenders.map((lid, i) => idOf(t, 'emp', i + 1));
  LENDER_DEFS.forEach((_, i) =>
    out.add('empanelment', {
      id: ix(empanelments, i),
      tenant_id: t.id,
      organisation_id: ix(t.orgs, 0),
      lender_id: ix(lenders, i),
      dsa_code: `DSA-${t.tag.toUpperCase()}-${pad(i + 1)}`,
      valid_range: i === 6 ? '[2025-04-01,2026-03-31]' : '[2026-04-01,2027-03-31]',
      permitted_categories: ['PL', 'BL', 'LAP', 'HL'],
      permitted_geos: ['MH', 'KA', 'DL', 'TS'],
      status: i === 6 ? 'EXPIRED' : i === 7 ? 'SUSPENDED' : 'ACTIVE',
      ...created(staff.owner),
    }),
  );

  const products = PRODUCTS.map((p, i) => idOf(t, 'prd', i + 1));
  PRODUCTS.forEach((p, i) =>
    out.add('loan_product', {
      id: ix(products, i),
      tenant_id: t.id,
      lender_id: ix(lenders, i),
      name: p.name,
      category: p.cat,
      applicant_types: ['SALARIED', 'SELF_EMPLOYED_PROFESSIONAL', 'SELF_EMPLOYED_BUSINESS'],
      secured: p.secured,
      owner_user_id: staff.loanops,
      next_review_at: onDate('2026-12-31'),
      status: i === 7 ? 'INACTIVE' : 'ACTIVE',
      ...created(staff.owner),
    }),
  );

  // Product versions: product 1 has a retired version 1 and an active version 2 (the terms are immutable after publish).
  const productVersions: string[] = [];
  PRODUCTS.forEach((p, i) => {
    productVersions.push(idOf(t, 'prv', i + 1));
    out.add('loan_product_version', {
      id: ix(productVersions, i),
      tenant_id: t.id,
      product_id: ix(products, i),
      version_no: 1,
      effective_from: at(d, 0),
      amount_min: 100000,
      amount_max: 5000000,
      currency: 'INR',
      tenure_min_months: 12,
      tenure_max_months: 84,
      illustrative_rate_text: 'From 10.5% p.a. (illustrative)',
      status: i === 0 ? 'RETIRED' : 'ACTIVE',
      fee_text: 'Processing fee 1% + GST (illustrative)',
      geo_rules: [
        { state: 'MH', allowed: true },
        { state: 'KA', allowed: true },
      ],
      workflow_profile: { checklist: 'standard', lenderRouting: 'manual' },
      eligibility_scope: { minAge: 21, maxAge: 60, minIncome: 25000 },
      created_by: staff.owner,
    });
  });
  // The retired version of product 1 is version 1 above; version 2 is the one in force from October.
  out.add('loan_product_version', {
    id: idOf(t, 'prv', 99),
    tenant_id: t.id,
    product_id: ix(products, 0),
    version_no: 2,
    effective_from: at(d, 20),
    amount_min: 100000,
    amount_max: 3000000,
    currency: 'INR',
    tenure_min_months: 12,
    tenure_max_months: 72,
    illustrative_rate_text: 'From 11.0% p.a. (illustrative)',
    status: 'ACTIVE',
    fee_text: 'Processing fee 1.5% + GST (illustrative)',
    geo_rules: [{ state: 'MH', allowed: true }],
    workflow_profile: { checklist: 'standard', lenderRouting: 'auto' },
    eligibility_scope: { minAge: 21, maxAge: 58, minIncome: 30000 },
    created_by: staff.owner,
  });

  // Customers, contact points and consents ------------------------------------------------------------------------
  const customers = Array.from({ length: 10 }, (_, i) => idOf(t, 'cus', i + 1));
  const customerNames = Array.from({ length: 10 }, (_, i) => ({
    first: ix(FIRST_NAMES, (i * 3) % FIRST_NAMES.length),
    last: ix(LAST_NAMES, (i * 7) % LAST_NAMES.length),
  }));
  customers.forEach((cid, i) => {
    const { first, last } = ix(customerNames, i);
    const entity = i === 9;
    out.add('customer', {
      id: cid,
      tenant_id: t.id,
      party_type: entity ? 'ENTITY' : 'INDIVIDUAL',
      full_name: entity ? ix(FIRMS, i) : `${first} ${last}`,
      home_branch_id: ix(t.branches, i % 2 === 0 ? 'MUM01' : 'PUN01'),
      status: i === 9 ? 'MERGED' : 'ACTIVE',
      merged_into_id: i === 9 ? ix(customers, 0) : null,
      ...created(staff.owner),
    });
  });
  customers.forEach((cid, i) => {
    const { first, last } = ix(customerNames, i);
    const phone = mobileFor(t.tagDigit, 200 + i);
    out.add('customer_contact_point', {
      id: idOf(t, 'ccp', i * 2 + 1),
      tenant_id: t.id,
      customer_id: cid,
      kind: 'MOBILE',
      value: phone,
      value_hash: sha256Bytes(phone),
      is_primary: true,
      verified_at: at(d, 3, i),
      created_by: staff.owner,
    });
    const email = emailFor(first, last, i + 1);
    out.add('customer_contact_point', {
      id: idOf(t, 'ccp', i * 2 + 2),
      tenant_id: t.id,
      customer_id: cid,
      kind: 'EMAIL',
      value: email,
      value_hash: sha256Bytes(email),
      is_primary: false,
      verified_at: null,
      created_by: staff.owner,
    });
  });

  // Consent: one per customer (purpose depends on the flow), plus two lead consents for contact.
  const consentIds: string[] = [];
  const customerConsentIds: string[][] = customers.map(() => []);
  customers.forEach((cid, i) => {
    const id = idOf(t, 'cns', i + 1);
    consentIds.push(id);
    ix(customerConsentIds, i).push(id);
    const withdrawn = i === 8;
    out.add('consent_record', {
      id,
      tenant_id: t.id,
      subject_type: 'CUSTOMER',
      subject_id: cid,
      purpose: i < 5 ? 'SHARE_WITH_LENDER' : 'LOAN_PROCESSING',
      purpose_target: i < 5 ? ix(lenders, ix(APP_LENDER, i)) : null,
      notice_version: 'NOTICE-V3.2',
      channel: i % 2 === 0 ? 'WEB_FORM' : 'OTP',
      evidence_ref: `evidence/consent/${t.tag}/${pad(i + 1)}.pdf`,
      captured_by: ix(rm, i % 2),
      captured_at: at(d, 2, i),
      status: withdrawn ? 'WITHDRAWN' : 'ACTIVE',
      withdrawn_at: withdrawn ? at(d, 25) : null,
      withdrawn_by: withdrawn ? ix(rm, 0) : null,
      withdrawal_reason: withdrawn ? 'Customer asked to stop sharing (synthetic)' : null,
      expires_at: at(d, 365),
    });
  });
  [3, 4].forEach((i, k) => {
    const id = idOf(t, 'cns', 100 + k);
    consentIds.push(id);
    out.add('consent_record', {
      id,
      tenant_id: t.id,
      subject_type: 'LEAD',
      subject_id: idOf(t, 'lead', i + 1),
      purpose: 'CONTACT',
      purpose_target: null,
      notice_version: 'NOTICE-V3.2',
      channel: 'PHONE',
      evidence_ref: `evidence/consent/${t.tag}/lead-${pad(i + 1)}.pdf`,
      captured_by: staff.compliance,
      captured_at: at(d, 1, i),
      status: 'ACTIVE',
      expires_at: at(d, 180),
    });
  });

  // Leads ---------------------------------------------------------------------------------------------------------
  const leads = Array.from({ length: 10 }, (_, i) => idOf(t, 'lead', i + 1));
  const apps = Array.from({ length: 10 }, (_, i) => idOf(t, 'app', i + 1));
  const batches = [idOf(t, 'imp', 1), idOf(t, 'imp', 2)];
  const leadConnector = (i: number) => connectorId(t, (i % 8) + 1);
  LEAD_STATES.forEach((state, i) => {
    const owner = i % 2 === 0 ? ix(rm, 0) : ix(rm, 1);
    const converted = state === 'CONVERTED';
    const qualified = state === 'QUALIFIED' || converted;
    const row: Record<string, unknown> = {
      id: ix(leads, i),
      tenant_id: t.id,
      branch_id: ix(t.branches, i % 3 === 0 ? 'PUN01' : 'MUM01'),
      full_name: `${ix(customerNames, i).first} ${ix(customerNames, i).last}`,
      mobile_e164: mobileFor(t.tagDigit, 300 + i),
      mobile_hash: sha256Bytes(mobileFor(t.tagDigit, 300 + i)),
      email: emailFor(ix(customerNames, i).first, ix(customerNames, i).last, 300 + i),
      email_hash: sha256Bytes(emailFor(ix(customerNames, i).first, ix(customerNames, i).last, 300 + i)),
      product_category: ix(PRODUCT_CATS, i),
      indicative_amount: ix(APP_AMOUNT, i),
      amount_currency: 'INR',
      pincode: i % 3 === 0 ? '411001' : '400008',
      source: i % 3 === 0 ? 'REFERRAL' : i % 2 === 0 ? 'WEBSITE' : 'PHONE',
      sub_source: i % 3 === 0 ? 'connector-referral' : 'web-form',
      campaign: i % 4 === 1 ? 'OCT-PL-PUSH' : null,
      utm: i % 4 === 1 ? { source: 'google', medium: 'cpc', campaign: 'OCT-PL-PUSH' } : null,
      connector_id: i % 3 === 0 ? leadConnector(i) : null,
      referred_at: i % 3 === 0 ? at(d, i) : null,
      state,
      priority: i % 3 === 0 ? 'HIGH' : 'MEDIUM',
      contact_attempts: [0, 1, 2, 3, 2, 3, 1, 2, 2, 1][i],
      tags: i % 2 === 0 ? ['priority-call'] : [],
      next_follow_up_at: qualified || state === 'IN_PROGRESS' ? at(d, 22, 4) : null,
      import_batch_id: i < 4 ? ix(batches, 0) : i < 8 ? ix(batches, 1) : null,
      owner_user_id: converted || state === 'MERGED' || state === 'ARCHIVED' ? null : owner,
      owner_queue_id: null,
      archived_at: state === 'ARCHIVED' ? at(d, 18) : null,
      merged_into_id: state === 'MERGED' ? ix(leads, 0) : null,
      disqualification_reason: state === 'DISQUALIFIED' ? 'NOT_ELIGIBLE' : null,
      duplicate_flag: state === 'MERGED' ? 'EXACT' : i === 5 ? 'POSSIBLE' : 'NONE',
      duplicate_candidate_ids: state === 'MERGED' ? [ix(leads, 0)] : [],
      created_at: at(d, i),
      created_by: staff.branchmgr,
      updated_at: at(d, i + 5),
      updated_by: staff.branchmgr,
    };
    if (converted) {
      // Converted leads point at their customer and application (CHECK: both must be set).
      row.customer_id = ix(customers, i);
      row.application_id = ix(apps, i);
    }
    if (qualified) {
      row.qual_applicant_type = i % 2 === 0 ? 'SALARIED' : 'SELF_EMPLOYED_PROFESSIONAL';
      row.qual_requested_amount = ix(APP_AMOUNT, i);
      row.qual_tenure_months = 60;
      row.qual_purpose_code = i % 2 === 0 ? 'PERSONAL_NEEDS' : 'WORKING_CAPITAL';
    }
    out.add('lead', row);
  });

  // Applications: 0–2 come from converted leads 0–2; the rest are direct applications.
  const partyIds: string[] = [];
  APP_STATUS.forEach((status, i) => {
    const lenderIdx = ix(APP_LENDER, i);
    const pv = ix(productVersions, lenderIdx);
    const hasProduct = status !== 'CANCELLED';
    const customer = ix(customers, i);
    const cancelled = status === 'CANCELLED';
    out.add('loan_application', {
      id: ix(apps, i),
      tenant_id: t.id,
      branch_id: ix(t.branches, i % 3 === 0 ? 'PUN01' : 'MUM01'),
      customer_id: customer,
      lead_id: i < 3 ? ix(leads, i) : null,
      product_category: ix(PRODUCT_CATS, i),
      product_version_id: hasProduct ? pv : null,
      requested_amount: ix(APP_AMOUNT, i),
      currency: 'INR',
      tenure_months: 60,
      purpose_code: i % 2 === 0 ? 'PERSONAL_NEEDS' : 'WORKING_CAPITAL',
      applicant_type:
        i === 7 ? 'SELF_EMPLOYED_PROFESSIONAL' : i === 8 ? 'SELF_EMPLOYED_BUSINESS' : 'SALARIED',
      status,
      sub_status: status === 'UNDER_REVIEW' ? 'QUERY_PENDING' : null,
      cancel_reason: cancelled ? 'DUPLICATE' : null,
      rework_reason: status === 'DOCUMENTS_PENDING' ? 'Bank statement unreadable (synthetic)' : null,
      sales_owner_id: ix(rm, i % 2),
      ops_owner_id: staff.loanops,
      ops_queue_id: ix(t.queues, 'MUM01-LOANOPS'),
      last_completeness_result: i < 7 ? 'COMPLETE' : 'INCOMPLETE',
      tags: i % 2 === 0 ? ['fast-track'] : [],
      on_hold: i === 6,
      hold_reason: i === 6 ? 'Awaiting salary slip from employer (synthetic)' : null,
      hold_until: i === 6 ? at(d, 25) : null,
      created_at: at(d, 2 + i),
      created_by: staff.branchmgr,
      updated_at: at(d, 6 + i),
      updated_by: staff.branchmgr,
    });
    // The primary applicant for each application.
    const partyId = idOf(t, 'par', i + 1);
    partyIds.push(partyId);
    out.add('application_party', {
      id: partyId,
      tenant_id: t.id,
      application_id: ix(apps, i),
      customer_id: customer,
      role: 'PRIMARY',
      party_type: 'INDIVIDUAL',
      created_by: ix(rm, i % 2),
    });
  });
  // Co-applicants on two applications, one of them later removed.
  [
    { app: 4, customer: 5, role: 'CO_APPLICANT', rel: 'SPOUSE', removed: false },
    { app: 5, customer: 6, role: 'GUARANTOR', rel: 'PARENT', removed: true },
  ].forEach((c, k) => {
    const id = idOf(t, 'par', 100 + k);
    partyIds.push(id);
    out.add('application_party', {
      id,
      tenant_id: t.id,
      application_id: ix(apps, c.app),
      customer_id: ix(customers, c.customer),
      role: c.role,
      party_type: 'INDIVIDUAL',
      relationship_to_primary: c.rel,
      removed_at: c.removed ? at(d, 24) : null,
      removed_by: c.removed ? staff.loanops : null,
      created_by: ix(rm, 0),
    });
  });

  // Application status history: CREATE, then the manual transitions the API builds (T-APP-01/02/03/04/10) and the
  // lender roll-ups (ROLLUP-1 submitted, ROLLUP-4 sanctioned, ROLLUP-5 disbursed, ROLLUP-6 lender rejection), as in
  // apps/api/src/modules/origination/applications/transitions.ts and docs/PENDING_APPROVALS.md §2.
  const appHistory: [number, string | null, string, string][] = [
    [0, null, 'CREATE', 'DRAFT'],
    [0, 'DRAFT', 'T-APP-01', 'DOCUMENTS_PENDING'],
    [0, 'DOCUMENTS_PENDING', 'T-APP-02', 'UNDER_REVIEW'],
    [0, 'UNDER_REVIEW', 'T-APP-04', 'READY_FOR_SUBMISSION'],
    [0, 'READY_FOR_SUBMISSION', 'ROLLUP-1', 'SUBMITTED'],
    [0, 'SUBMITTED', 'ROLLUP-4', 'SANCTIONED'],
    [0, 'SANCTIONED', 'ROLLUP-5', 'DISBURSED'],
    [4, null, 'CREATE', 'DRAFT'],
    [4, 'DRAFT', 'T-APP-01', 'DOCUMENTS_PENDING'],
    [4, 'DOCUMENTS_PENDING', 'T-APP-02', 'UNDER_REVIEW'],
    [4, 'UNDER_REVIEW', 'T-APP-04', 'READY_FOR_SUBMISSION'],
    [4, 'READY_FOR_SUBMISSION', 'ROLLUP-1', 'SUBMITTED'],
    [5, 'DRAFT', 'T-APP-01', 'DOCUMENTS_PENDING'],
    [5, 'DOCUMENTS_PENDING', 'T-APP-02', 'UNDER_REVIEW'],
    [6, 'UNDER_REVIEW', 'T-APP-03', 'DOCUMENTS_PENDING'],
    [8, 'SUBMITTED', 'ROLLUP-6', 'REJECTED'],
    [9, 'DRAFT', 'T-APP-10', 'CANCELLED'],
  ];
  appHistory.forEach(([appIdx, from, code, to], i) =>
    out.add('application_status_history', {
      id: idOf(t, 'ash', i + 1),
      tenant_id: t.id,
      application_id: ix(apps, appIdx),
      from_status: from,
      to_status: to,
      transition_code: code,
      reason_code:
        to === 'REJECTED'
          ? 'INCOME'
          : to === 'CANCELLED'
            ? 'DUPLICATE'
            : code === 'T-APP-03'
              ? 'Bank statement unreadable (synthetic)'
              : null,
      actor: ix(rm, appIdx % 2),
      occurred_at: at(d, 3 + i),
    }),
  );

  // Lead status history: CREATE and the lead transitions the DB allows (T-LEAD-01..09).
  const leadHistory: [number, string | null, string, string][] = [
    [0, null, 'CREATE', 'NEW'],
    [0, 'NEW', 'T-LEAD-01', 'CONTACT_ATTEMPTED'],
    [0, 'CONTACT_ATTEMPTED', 'T-LEAD-02', 'IN_PROGRESS'],
    [0, 'IN_PROGRESS', 'T-LEAD-03', 'QUALIFIED'],
    [0, 'QUALIFIED', 'T-LEAD-04', 'CONVERTED'],
    [6, 'IN_PROGRESS', 'T-LEAD-05', 'DISQUALIFIED'],
    [7, 'CONTACT_ATTEMPTED', 'T-LEAD-06', 'NOT_CONTACTABLE'],
    [8, 'NEW', 'T-LEAD-07', 'MERGED'],
    [9, 'IN_PROGRESS', 'T-LEAD-08', 'ARCHIVED'],
    [3, 'IN_PROGRESS', 'T-LEAD-03', 'QUALIFIED'],
  ];
  leadHistory.forEach(([leadIdx, from, code, to], i) =>
    out.add('lead_status_history', {
      id: idOf(t, 'lsh', i + 1),
      tenant_id: t.id,
      lead_id: ix(leads, leadIdx),
      from_state: from,
      to_state: to,
      transition_code: code,
      reason_code: to === 'DISQUALIFIED' ? 'NOT_ELIGIBLE' : null,
      actor: ix(rm, leadIdx % 2),
      occurred_at: at(d, 1 + i),
    }),
  );

  // Lead assignments (routing history) and duplicate reviews between lead pairs.
  for (let i = 0; i < 10; i += 1) {
    const toQueue = i % 4 === 0;
    out.add('lead_assignment', {
      id: idOf(t, 'las', i + 1),
      tenant_id: t.id,
      lead_id: ix(leads, i),
      from_user_id: null,
      from_queue_id: toQueue ? ix(t.queues, 'MUM01-INTAKE') : null,
      to_user_id: toQueue ? null : ix(rm, i % 2),
      to_queue_id: toQueue ? ix(t.queues, 'MUM01-INTAKE') : null,
      reason_code: i % 3 === 0 ? 'AUTO_ROUTING' : i % 3 === 1 ? 'MANUAL' : 'REBALANCE',
      actor: staff.branchmgr,
      decision_record_id: null,
      assigned_at: at(d, i),
    });
  }
  const dupPairs: [number, number, string][] = [
    [0, 3, 'POSSIBLE'],
    [1, 5, 'EXACT'],
    [2, 6, 'ATTRIBUTION_CONFLICT'],
    [4, 7, 'POSSIBLE'],
    [6, 9, 'POSSIBLE'],
    [8, 0, 'EXACT'],
    [5, 9, 'POSSIBLE'],
    [7, 2, 'ATTRIBUTION_CONFLICT'],
  ];
  dupPairs.forEach(([a, b, cls], i) => {
    const resolved = i >= 4;
    const merged = i === 5 || i === 7;
    out.add('duplicate_review', {
      id: idOf(t, 'dup', i + 1),
      tenant_id: t.id,
      left_type: 'LEAD',
      left_id: ix(leads, a),
      right_type: 'LEAD',
      right_id: ix(leads, b),
      classification: cls,
      pair_hash: sha256Hex([ix(leads, a), ix(leads, b)].sort().join('|')),
      status: resolved ? (merged ? 'MERGED' : 'DISMISSED') : 'OPEN',
      resolution: resolved ? (merged ? 'MERGE' : 'DISMISS') : null,
      survivor_id: merged ? ix(leads, a) : null,
      reason: 'Same mobile number and product (synthetic)',
      decision_record_id: null,
      resolved_by: resolved ? staff.branchmgr : null,
      resolved_at: resolved ? at(d, 12 + i) : null,
      created_by: staff.branchmgr,
      updated_by: staff.branchmgr,
    });
  });

  // Activities on leads and applications (calls must carry an outcome code).
  const activityRows: [string, string, string, string | null][] = [
    ['LEAD', ix(leads, 0), 'CALL', 'CONNECTED'],
    ['LEAD', ix(leads, 1), 'CALL', 'NO_ANSWER'],
    ['LEAD', ix(leads, 2), 'MEETING', null],
    ['LEAD', ix(leads, 3), 'CALL', 'CALLBACK_REQUESTED'],
    ['LEAD', ix(leads, 4), 'VISIT', null],
    ['LEAD', ix(leads, 5), 'CALL', 'BUSY'],
    ['CUSTOMER', ix(customers, 0), 'NOTE', null],
    ['LOAN_APPLICATION', ix(apps, 4), 'CALL', 'CONNECTED'],
    ['LOAN_APPLICATION', ix(apps, 5), 'NOTE', null],
    ['LOAN_APPLICATION', ix(apps, 7), 'CALL', 'NOT_INTERESTED'],
  ];
  activityRows.forEach(([subjectType, subjectId, kind, outcome], i) =>
    out.add('activity', {
      id: idOf(t, 'act', i + 1),
      tenant_id: t.id,
      subject_type: subjectType,
      subject_id: subjectId,
      kind,
      outcome_code: outcome,
      occurred_at: at(d, 4, i),
      duration_s: kind === 'CALL' ? 60 + i * 15 : null,
      note: `${kind.toLowerCase()} logged during the demo cohort run (synthetic)`,
      actor_id: ix(rm, i % 2),
      actor_branch_id: ix(t.branches, 'MUM01'),
      created_at: at(d, 4, i),
      updated_at: at(d, 4, i),
      updated_by: ix(rm, i % 2),
    }),
  );

  // Attribution: change requests and a dispute on one of the referred leads.
  for (let i = 0; i < 8; i += 1) {
    const approved = i < 3;
    out.add('attribution_change_request', {
      id: idOf(t, 'acr', i + 1),
      tenant_id: t.id,
      lead_id: ix(leads, (i * 3) % 10),
      previous_connector_id: connectorId(t, (i % 8) + 1),
      proposed_connector_id: connectorId(t, ((i + 3) % 8) + 1),
      reason: 'Lead was referred by two connectors within 24 hours (synthetic)',
      evidence_ref: `evidence/attribution/${t.tag}/${pad(i + 1)}.pdf`,
      recalculation_proposal: null,
      status: approved ? 'APPROVED' : i === 3 ? 'REJECTED' : i === 4 ? 'CANCELLED' : 'PENDING',
      requester_id: ix(rm, 0),
      approver_id: approved || i === 3 ? staff.branchmgr : null,
      approved_at: approved ? at(d, 14, i) : null,
      created_by: ix(rm, 0),
      updated_by: ix(rm, 0),
    });
  }
  for (let i = 0; i < 8; i += 1) {
    const resolved = i % 2 === 0;
    out.add('attribution_dispute', {
      id: idOf(t, 'adp', i + 1),
      tenant_id: t.id,
      lead_id: ix(leads, (i * 3) % 10),
      claimant_connector_ids: [connectorId(t, (i % 8) + 1), connectorId(t, ((i + 4) % 8) + 1)],
      resolved_connector_id: resolved ? connectorId(t, (i % 8) + 1) : null,
      resolution: resolved ? 'SPLIT_COMMISSION' : null,
      status: resolved ? 'RESOLVED' : i === 5 ? 'UNDER_REVIEW' : 'OPEN',
      resolver_user_id: resolved ? staff.owner : null,
      resolution_notes: resolved ? 'Split 50:50 pending the lender sanction (synthetic)' : null,
      created_by: staff.branchmgr,
      updated_by: staff.branchmgr,
    });
  }

  // Document types, documents, versions, reviews, checklist and uploads -------------------------------------------
  DOC_TYPES.forEach((dt, i) =>
    out.add('document_type', {
      id: idOf(t, 'dt', i + 1),
      tenant_id: t.id,
      code: dt.code,
      name: dt.name,
      category: dt.category,
      allowed_mime: ['application/pdf', 'image/jpeg', 'image/png'],
      max_size_bytes: 5242880,
      validity_months: dt.validity,
      sensitivity: dt.sensitivity,
      retention_class: dt.retention,
      instructions: `Upload a clear, legible copy of the ${dt.name.toLowerCase()} (synthetic).`,
      active: true,
      ...created(staff.owner),
    }),
  );

  // Checklist: a KYC item for every application; a bank statement item for the first eight.
  const documents: string[] = [];
  const checklistIds: string[] = [];
  const checklistFor: { id: string; app: number; code: string }[] = [];
  apps.forEach((appId, i) => {
    const items = i < 8 ? ['KYC_ID', 'BANK_STATEMENT'] : ['KYC_ID'];
    items.forEach((code, k) => {
      const id = idOf(t, 'chk', checklistIds.length + 1);
      checklistIds.push(id);
      checklistFor.push({ id, app: i, code });
      const status =
        k === 0 ? (i % 3 === 0 ? 'ACCEPTED' : 'SUBMITTED') : i % 2 === 0 ? 'PENDING' : 'REJECTED';
      out.add('checklist_item', {
        id,
        tenant_id: t.id,
        application_id: appId,
        party_id: ix(partyIds, i),
        document_type_code: code,
        ordinal: k + 1,
        mandatory: true,
        required_count: 1,
        period_months: code === 'BANK_STATEMENT' ? 6 : null,
        status,
        source_decision_id: idOf(t, 'dr', 400 + i),
        attestation_note: null,
        reviewed_by: status === 'ACCEPTED' || status === 'REJECTED' ? staff.loanops : null,
        reviewed_at: status === 'ACCEPTED' || status === 'REJECTED' ? at(d, 8, i) : null,
        reject_reason: status === 'REJECTED' ? 'ILLEGIBLE' : null,
        document_id: null,
        created_by: staff.branchmgr,
        updated_by: staff.branchmgr,
      });
    });
  });

  // Documents: one per checklist item, with a version and a review for each.
  checklistFor.forEach((c, i) => {
    const docId = idOf(t, 'doc', i + 1);
    documents.push(docId);
    const versionId = idOf(t, 'dv', i + 1);
    out.add('document', {
      id: docId,
      tenant_id: t.id,
      owner_type: 'APPLICATION',
      owner_id: ix(apps, c.app),
      application_id: ix(apps, c.app),
      checklist_item_id: c.id,
      document_type_code: c.code,
      status: i === 3 ? 'EXPIRED' : 'ACTIVE',
      current_version_id: versionId,
      created_by: ix(rm, 0),
      updated_by: ix(rm, 0),
    });
    const sha = sha256Hex(`${t.tag}-${docId}-v1`);
    out.add('document_version', {
      id: versionId,
      tenant_id: t.id,
      document_id: docId,
      version_no: 1,
      object_key: `docs/${t.tag}/${ix(apps, c.app)}/${docId}/v1.pdf`,
      file_name: `${c.code.toLowerCase()}-${pad(i + 1)}.pdf`,
      sha256: sha,
      size_bytes: 180000 + i * 1000,
      detected_mime: 'application/pdf',
      scan_status: 'CLEAN',
      review_status: i === 2 ? 'REJECTED' : i === 3 ? 'EXPIRED' : 'ACCEPTED',
      valid_until: c.code === 'BANK_STATEMENT' ? onDate('2026-12-31') : null,
      uploaded_by: ix(rm, 0),
      uploaded_via: i % 3 === 0 ? 'CUSTOMER_LINK' : 'STAFF',
    });
    out.add('document_review', {
      id: idOf(t, 'drv', i + 1),
      tenant_id: t.id,
      version_id: versionId,
      decision: i === 2 ? 'REJECT' : 'ACCEPT',
      reason_code: i === 2 ? 'ILLEGIBLE' : null,
      comment:
        i === 2 ? 'Scan is blurred; ask for a fresh copy (synthetic)' : 'Matches the application (synthetic)',
      valid_until: c.code === 'BANK_STATEMENT' ? onDate('2026-12-31') : null,
      reviewer_id: staff.loanops,
    });
    out.add('document_access_log', {
      id: idOf(t, 'dal', i + 1),
      tenant_id: t.id,
      version_id: versionId,
      action: i % 3 === 0 ? 'DOWNLOAD' : 'VIEW',
      principal_id: staff.loanops,
      purpose: 'Application review (synthetic)',
      ip: '203.0.113.20',
      at: at(d, 9, i),
    });
  });

  // Document archives: one per application, in different states.
  apps.forEach((appId, i) => {
    const status = i < 3 ? 'READY' : i === 5 ? 'FAILED' : 'QUEUED';
    out.add('document_archive', {
      id: idOf(t, 'arc', i + 1),
      tenant_id: t.id,
      application_id: appId,
      status,
      object_key: status === 'READY' ? `archives/${t.tag}/${appId}.zip` : null,
      document_count: 2,
      failure_reason: status === 'FAILED' ? 'Object store timeout (synthetic)' : null,
      requested_by: staff.loanops,
      completed_at: status === 'READY' || status === 'FAILED' ? at(d, 15, i) : null,
    });
  });

  // Upload links, intents and uploaded files for the applicants’ document requests.
  for (let i = 0; i < 8; i += 1) {
    out.add('upload_link', {
      id: idOf(t, 'upl', i + 1),
      tenant_id: t.id,
      application_id: ix(apps, i),
      token_hash: sha256Hex(`${t.tag}-upload-${i}`),
      items: i < 8 ? ['KYC_ID', 'BANK_STATEMENT'] : ['KYC_ID'],
      recipient_contact_id: ix(customers, i),
      recipient_contact_hint: '+91 ****** 1234',
      expires_at: at(d, 20 + i),
      otp_required: true,
      otp_hash: sha256Hex(`otp-${i}`),
      otp_expires_at: at(d, 19),
      failed_attempts: i % 3,
      max_uses: 5,
      uses: i % 4,
      revoked_at: i === 7 ? at(d, 16) : null,
      revoked_by: i === 7 ? staff.loanops : null,
      locked_at: null,
      created_by: ix(rm, 0),
      updated_by: ix(rm, 0),
    });
    const sha = sha256Hex(`intent-${t.tag}-${i}`);
    out.add('upload_intent', {
      id: idOf(t, 'uin', i + 1),
      tenant_id: t.id,
      checklist_item_id: ix(checklistFor, Math.min(i, checklistFor.length - 1)).id,
      application_id: ix(apps, i),
      document_type_code: 'KYC_ID',
      file_name: `kyc-id-upload-${pad(i + 1)}.pdf`,
      size_bytes: 204800,
      mime_type: 'application/pdf',
      sha256: sha,
      token_hash: sha256Hex(`intent-token-${t.tag}-${i}`),
      object_key: `uploads/${t.tag}/${pad(i + 1)}.pdf`,
      status: i < 4 ? 'COMPLETED' : i < 6 ? 'UPLOADED' : i === 6 ? 'PENDING' : 'EXPIRED',
      expires_at: at(d, 21),
      document_id: i < 4 ? ix(documents, i) : null,
      version_id: i < 4 ? idOf(t, 'dv', i + 1) : null,
      created_by: ix(rm, 0),
    });
    out.add('uploaded_document', {
      id: idOf(t, 'udc', i + 1),
      tenant_id: t.id,
      application_id: ix(apps, i),
      checklist_item_id: ix(checklistFor, Math.min(i, checklistFor.length - 1)).id,
      upload_link_id: idOf(t, 'upl', i + 1),
      file_name: `kyc-id-upload-${pad(i + 1)}.pdf`,
      file_size_bytes: 204800,
      mime_type: 'application/pdf',
      storage_path: `uploads/${t.tag}/${pad(i + 1)}.pdf`,
      sha256_hash: sha,
      scan_status: i === 5 ? 'QUARANTINED' : 'CLEAN',
      created_by: ix(rm, 0),
      updated_by: ix(rm, 0),
    });
  }

  // Public entry points and apply links for the branches.
  const kinds = ['WEBHOOK', 'UPLOAD_LINK', 'STATUS_PORTAL'] as const;
  for (let i = 0; i < 8; i += 1) {
    out.add('public_entry_index', {
      connection_path_id: `cpath-${t.tag}-${pad(i + 1)}`,
      tenant_id: t.id,
      provider: i % 2 === 0 ? 'karza' : 'digio',
      connection_id: idOf(t, 'ic', i + 1),
      signing_secret: `synthetic-signing-secret-${t.tag}-${pad(i + 1)}`,
      status: i === 5 ? 'INACTIVE' : 'ACTIVE',
      kind: ix(kinds, i % 3),
      target_id: i % 3 === 1 ? idOf(t, 'upl', (i % 8) + 1) : null,
    });
    out.add('apply_link', {
      id: idOf(t, 'apl', i + 1),
      tenant_id: t.id,
      token_hash: sha256Hex(`apply-${t.tag}-${i}`),
      branch_id: ix(t.branches, i % 2 === 0 ? 'MUM01' : 'PUN01'),
      product_category: ix(PRODUCT_CATS, i),
      campaign: i % 2 === 0 ? 'OCT-PL-PUSH' : null,
      employee_id: ix(rm, i % 2),
      connector_id: i % 3 === 0 ? connectorId(t, (i % 8) + 1) : null,
      notice_version: 'NOTICE-V3.2',
      expires_at: at(d, 40 + i),
      active: i !== 6,
      submissions: i % 4,
      created_by: staff.branchmgr,
      updated_by: staff.branchmgr,
    });
  }

  // Eligibility and verification ----------------------------------------------------------------------------------
  const decisionIds: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const dr = idOf(t, 'dr', 400 + i);
    decisionIds.push(dr);
    out.add('eligibility_assessment', {
      id: idOf(t, 'ela', i + 1),
      tenant_id: t.id,
      application_id: ix(apps, i),
      assessed_at: at(d, 7, i),
      results: [
        { rule: 'MIN_AGE', outcome: 'PASS' },
        { rule: 'MIN_INCOME', outcome: i === 8 ? 'FAIL' : 'PASS' },
        { rule: 'BUREAU_SCORE', outcome: i === 6 ? 'MANUAL' : 'PASS' },
      ],
      decision_record_ids: [dr],
      overrides:
        i === 6
          ? [{ rule: 'BUREAU_SCORE', by: staff.owner, reason: 'Salary credit confirmed (synthetic)' }]
          : [],
      created_by: staff.loanops,
      updated_by: staff.loanops,
    });
  }
  // Verifications: each request ties to one consent; results are append-only once written.
  const verifyTypes = [
    'IDENTITY_KYC',
    'RESIDENCE_FI',
    'OFFICE_FI',
    'EMPLOYMENT',
    'BANK_STATEMENT',
    'DOCUMENT_REVIEW',
  ] as const;
  const checkTypes = [
    'IDENTITY_DOCUMENT',
    'ADDRESS',
    'EMPLOYMENT',
    'BANK_STATEMENT',
    'BUREAU',
    'ITR',
    'PAN',
    'GST',
  ] as const;
  for (let i = 0; i < 8; i += 1) {
    const result = i === 2 ? 'REJECTED' : i === 5 ? 'FLAGGED' : i === 6 ? 'INCONCLUSIVE' : 'VERIFIED';
    out.add('verification', {
      id: idOf(t, 'ver', i + 1),
      tenant_id: t.id,
      subject_type: 'CUSTOMER',
      subject_id: ix(customers, i),
      check_type: ix(checkTypes, i),
      method: i % 3 === 0 ? 'PROVIDER_AUTOMATED' : 'MANUAL',
      purpose: i % 2 === 0 ? 'KYC' : 'FINANCIAL_UNDERWRITING',
      consent_record_id: ix(customerConsentIds, i)[0],
      result,
      minimal_result: { match: result === 'VERIFIED', checkedAt: at(d, 10, i) },
      evidence_ref: `evidence/verify/${t.tag}/${pad(i + 1)}.pdf`,
      validity_expires_at: at(d, 180),
      performed_by: staff.compliance,
      performed_at: at(d, 10, i),
      notes: result === 'VERIFIED' ? null : 'Follow-up call scheduled with the applicant (synthetic)',
    });
  }
  for (let i = 0; i < 10; i += 1) {
    const status =
      i < 3
        ? 'VERIFIED'
        : i === 4
          ? 'REJECTED'
          : i === 5
            ? 'IN_PROGRESS'
            : i === 6
              ? 'ASSIGNED'
              : i === 7
                ? 'INITIATED'
                : i === 8
                  ? 'WAIVED'
                  : 'IN_PROGRESS';
    out.add('verification_request', {
      id: idOf(t, 'vrq', i + 1),
      tenant_id: t.id,
      application_id: ix(apps, i),
      party_id: ix(partyIds, i),
      customer_id: ix(customers, i),
      verification_type: ix(verifyTypes, i % verifyTypes.length),
      status,
      outcome: status === 'VERIFIED' ? 'POSITIVE' : status === 'WAIVED' ? 'WAIVED' : null,
      assigned_to_user_id: status === 'INITIATED' ? null : staff.compliance,
      assigned_to_queue_id: status === 'INITIATED' ? ix(t.queues, 'MUM01-VERIFY') : null,
      branch_id: ix(t.branches, 'MUM01'),
      priority: i % 3 === 0 ? 'HIGH' : 'MEDIUM',
      scheduled_at: at(d, 11, i),
      completed_at: status === 'VERIFIED' || status === 'WAIVED' ? at(d, 12, i) : null,
      verified_by: status === 'VERIFIED' ? staff.compliance : null,
      findings_summary:
        status === 'VERIFIED' ? 'Address and employment match the documents (synthetic)' : null,
      rejection_reason: status === 'REJECTED' ? 'ADDRESS_NOT_FOUND' : null,
      checklist_item_ids: checklistFor.filter((c) => c.app === i).map((c) => c.id),
      created_by: staff.branchmgr,
      updated_by: staff.compliance,
    });
  }

  // Complaints, data sharing and external shares.
  for (let i = 0; i < 8; i += 1) {
    const resolved = i < 3;
    out.add('complaint', {
      id: idOf(t, 'cmp', i + 1),
      tenant_id: t.id,
      complainant_type: i % 2 === 0 ? 'LEAD' : 'APPLICATION',
      complainant_id: i % 2 === 0 ? ix(leads, i) : ix(apps, i),
      channel: ['PHONE', 'EMAIL', 'BRANCH', 'WEB', 'LENDER', 'OTHER', 'EMAIL', 'PHONE'][i] as string,
      category: [
        'SERVICE',
        'PROCESS',
        'CHARGES',
        'COLLECTION',
        'DATA_PRIVACY',
        'OTHER',
        'SERVICE',
        'PROCESS',
      ][i] as string,
      description: `Applicant reports a delay in call-back on the ${i + 1}th request; details recorded for review (synthetic).`,
      status: resolved ? 'RESOLVED' : i === 4 ? 'IN_PROGRESS' : 'OPEN',
      owner_user_id: staff.branchmgr,
      due_at: at(d, 15 + i),
      ack_ref: `ACK-${t.tag.toUpperCase()}-${pad(i + 1)}`,
      lender_referral: i === 5 ? { lenderId: ix(lenders, 5), referredAt: at(d, 9) } : {},
      resolution: resolved ? 'Call-back completed and the process was explained (synthetic).' : null,
      resolved_at: resolved ? at(d, 14, i) : null,
      created_by: staff.branchmgr,
      updated_by: staff.branchmgr,
    });
  }
  // Lender cases are created below; data sharing and external share reference them.

  // Lender cases, submission packages and queries -----------------------------------------------------------------
  const lenderCases: string[] = [];
  const caseApp: number[] = []; // lender case index -> application index
  const submissionPackages: string[] = [];
  const pkgCase: string[] = []; // submission package index -> lender case id
  APP_CASE_STATUS.forEach((status, i) => {
    if (!status) return;
    const lenderIdx = ix(APP_LENDER, i);
    const id = idOf(t, 'lc', i + 1);
    lenderCases.push(id);
    caseApp.push(i);
    const submitted = !['DRAFT', 'PACKAGE_READY', 'WITHDRAWN'].includes(status);
    const pkgId = submitted ? idOf(t, 'pkg', submissionPackages.length + 1) : null;
    if (pkgId) {
      submissionPackages.push(pkgId);
      pkgCase.push(id);
    }
    out.add('lender_case', {
      id,
      tenant_id: t.id,
      application_id: ix(apps, i),
      lender_id: ix(lenders, lenderIdx),
      product_version_id: ix(productVersions, lenderIdx),
      empanelment_id: ix(empanelments, lenderIdx),
      attempt_no: 1,
      status,
      lender_reference: submitted ? `LR-${t.tag.toUpperCase()}-${pad(i + 1)}` : null,
      submission_channel: submitted ? (i % 2 === 0 ? 'PORTAL' : 'EMAIL') : null,
      submitted_at: submitted ? at(d, 9, i) : null,
      package_id: pkgId,
      status_source: submitted ? (i % 2 === 0 ? 'LENDER_API' : 'MANUAL') : null,
      last_status_at: at(d, 12, i),
      decline_reason_code: status === 'REJECTED' ? 'INCOME' : null,
      staleness_flag: i === 4,
      tags: i % 2 === 0 ? ['priority-lender'] : [],
      created_by: staff.loanops,
      updated_by: staff.loanops,
    });
  });
  // Submission packages: each package is frozen once submitted; query responses add one more package per answered query.
  submissionPackages.forEach((pkg, i) => {
    out.add('submission_package', {
      id: pkg,
      tenant_id: t.id,
      lender_case_id: ix(pkgCase, i),
      kind: 'SUBMISSION',
      manifest: {
        documents: 4 + i,
        checksum: 'manifest-v1',
        lenderId: ix(lenders, ix(APP_LENDER, ix(caseApp, i))),
      },
      manifest_sha256: sha256Hex(`manifest-${t.tag}-${i}`),
      consent_ids: ix(customerConsentIds, Math.min(i, customers.length - 1)),
      built_by: staff.loanops,
      built_at: at(d, 9, i),
      frozen_at: at(d, 9, i),
    });
  });
  const responsePkgs = [idOf(t, 'pkg', 90), idOf(t, 'pkg', 91), idOf(t, 'pkg', 92), idOf(t, 'pkg', 93)];
  responsePkgs.forEach((pkg, i) =>
    out.add('submission_package', {
      id: pkg,
      tenant_id: t.id,
      lender_case_id: ix(lenderCases, i),
      kind: 'QUERY_RESPONSE',
      manifest: { answers: 2, requestedBy: 'lender' },
      manifest_sha256: sha256Hex(`response-${t.tag}-${i}`),
      consent_ids: ix(customerConsentIds, i),
      built_by: staff.loanops,
      built_at: at(d, 13, i),
      frozen_at: at(d, 13, i),
    }),
  );
  for (let i = 0; i < 8; i += 1) {
    const answered = i < 4;
    out.add('lender_query', {
      id: idOf(t, 'lq', i + 1),
      tenant_id: t.id,
      lender_case_id: ix(lenderCases, i % lenderCases.length),
      text:
        i % 2 === 0
          ? 'Please share the last three salary slips and the bank statement for the same period.'
          : 'Confirm the co-applicant relationship and the guarantor consent.',
      requested_items: i % 2 === 0 ? ['SALARY_SLIP', 'BANK_STATEMENT'] : ['CONSENT_FORM'],
      lender_due_date: onDate('2026-10-30'),
      task_id: null,
      response_manifest_id: answered ? ix(responsePkgs, i) : null,
      responded_at: answered ? at(d, 13, i) : null,
      created_by: staff.loanops,
    });
  }
  // Lender case status history: CREATE then the transitions shown in the case states.
  // Lender case index order: 0 disbursed, 1 part-disbursed, 2 sanctioned, 3 sanctioned, 4 submitted, 5 query raised,
  // 6 package ready, 7 rejected, 8 withdrawn.
  const caseHistory: [number, string | null, string, 'LENDER_API' | 'MANUAL'][] = [
    [0, null, 'DRAFT', 'MANUAL'],
    [0, 'DRAFT', 'SUBMITTED', 'LENDER_API'],
    [0, 'SUBMITTED', 'SANCTIONED', 'LENDER_API'],
    [0, 'SANCTIONED', 'DISBURSED', 'MANUAL'],
    [1, 'SANCTIONED', 'PARTIALLY_DISBURSED', 'MANUAL'],
    [2, 'SUBMITTED', 'SANCTIONED', 'LENDER_API'],
    [3, 'SUBMITTED', 'SANCTIONED', 'LENDER_API'],
    [4, 'DRAFT', 'SUBMITTED', 'MANUAL'],
    [5, 'SUBMITTED', 'QUERY_RAISED', 'LENDER_API'],
    [6, 'DRAFT', 'PACKAGE_READY', 'MANUAL'],
    [7, 'SUBMITTED', 'REJECTED', 'LENDER_API'],
    [8, 'DRAFT', 'WITHDRAWN', 'MANUAL'],
  ];
  caseHistory.forEach(([caseIdx, from, to, source], i) => {
    if (!ix(lenderCases, caseIdx)) return;
    out.add('lender_case_status_history', {
      id: idOf(t, 'lch', i + 1),
      tenant_id: t.id,
      lender_case_id: ix(lenderCases, caseIdx),
      from_status: from,
      to_status: to,
      status_source: source,
      reason_text: to === 'REJECTED' ? 'Income below policy (synthetic)' : null,
      actor: staff.loanops,
      occurred_at: at(d, 9 + i),
    });
  });

  // Sanctions and tranches ----------------------------------------------------------------------------------------
  const sanctions: Origination['sanctions'] = [];
  const sanctionSpec: [number, number, string, number][] = [
    [0, 1, 'REVISED', 1500000],
    [0, 2, 'ACTIVE', 1500000],
    [1, 1, 'REVISED', 800000],
    [1, 2, 'ACTIVE', 900000],
    [2, 1, 'ACTIVE', 1200000],
    [3, 1, 'ACTIVE', 600000],
    [3, 2, 'EXPIRED', 600000],
    [8, 1, 'CANCELLED', 350000],
  ];
  sanctionSpec.forEach(([caseIdx, version, status, amount], i) => {
    const id = idOf(t, 'snc', i + 1);
    const lenderIdx = ix(APP_LENDER, ix(caseApp, caseIdx));
    const sanctionDate = onDate('2026-09-20', i);
    sanctions.push({ id, lenderCase: caseIdx, lender: lenderIdx, status, amount });
    out.add('sanction', {
      id,
      tenant_id: t.id,
      lender_case_id: ix(lenderCases, caseIdx),
      version,
      amount,
      tenure_months: 60,
      rate_value: 10.5 + i * 0.25,
      rate_type: i % 2 === 0 ? 'FIXED' : 'FLOATING',
      benchmark_text: i % 2 === 0 ? null : 'Repo-linked (synthetic)',
      fees_text: 'Processing 1% + GST (synthetic)',
      conditions: ['Valid KYC', 'Salary account set-up'],
      sanction_date: sanctionDate,
      valid_until: status === 'EXPIRED' ? onDate('2026-09-30') : onDate(sanctionDate, 90),
      letter_document_id: null,
      status,
      source: i % 2 === 0 ? 'LENDER_API' : 'MANUAL',
      cancel_reason: status === 'CANCELLED' ? 'Applicant withdrew after sanction (synthetic)' : null,
      created_by: staff.loanops,
      updated_by: staff.loanops,
    });
  });

  const tranches: Origination['tranches'] = [];
  const trancheSpec: [number, number, string, number][] = [
    // [sanction index into ix(sanctions, ), tranche_no, status, amount]
    [1, 1, 'VERIFIED', 500000],
    [1, 2, 'VERIFIED', 500000],
    [1, 3, 'VOIDED', 300000],
    [1, 4, 'VERIFIED', 300000],
    [3, 1, 'VERIFIED', 450000],
    [3, 2, 'RECORDED', 450000],
    [3, 3, 'RETURNED', 200000],
    [3, 4, 'VERIFIED', 250000],
  ];
  trancheSpec.forEach(([sIdx, trancheNo, status, amount], i) => {
    const sanction = ix(sanctions, sIdx);
    const id = idOf(t, 'trn', i + 1);
    const disbursedOn = onDate('2026-09-25', i);
    tranches.push({
      id,
      sanction: sanction.id,
      amount,
      status,
      lender: sanction.lender,
      lenderCase: ix(lenderCases, sanction.lenderCase),
      disbursedOn,
    });
    out.add('disbursement_tranche', {
      id,
      tenant_id: t.id,
      sanction_id: sanction.id,
      tranche_no: trancheNo,
      amount,
      currency: 'INR',
      disbursed_on: disbursedOn,
      utr_ciphertext: null,
      utr_masked: `UTR******${pad(4800 + i, 4)}`,
      loan_account_ciphertext: null,
      loan_account_masked: `LA******${pad(9900 + i, 4)}`,
      evidence_document_id: null,
      status,
      recorded_by: staff.loanops,
      verified_by: status === 'VERIFIED' || status === 'VOIDED' ? staff.owner : null,
      verified_at: status === 'VERIFIED' ? at(d, 16, i) : null,
      verification_comment: status === 'VERIFIED' ? 'UTR matches lender statement (synthetic)' : null,
      exception_approval_id: null,
      voided_by: status === 'VOIDED' ? staff.owner : null,
      void_reason: status === 'VOIDED' ? 'Amount corrected and re-disbursed (synthetic)' : null,
      replaced_by_tranche_id: status === 'VOIDED' ? idOf(t, 'trn', 4) : null,
      created_by: staff.loanops,
      updated_by: staff.loanops,
    });
  });

  return {
    leads,
    customers,
    apps,
    lenders,
    productVersions,
    lenderCases,
    caseApps: caseApp.map((a) => ix(apps, a)),
    submissionPackages,
    sanctions,
    tranches,
    consentIds,
    customerConsentIds,
    documents,
    checklistIds,
    decisionIds,
    importBatches: batches,
    partyIds,
  };
}
