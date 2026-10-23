// Connector, commission, payout, ledger and reconciliation flow for the demo seed. Synthetic data only (ASM-4D-06).
// Flow: disbursement tranche → commission calculation → commission payable → payout request → payout line and
// approval → payout batch → connector statement entry, with ledger journals, invoices, lender statements and the
// reconciliation exceptions that come from them.
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
import { type Tenant, connectorId, idOf, CONNECTORS } from './tenant-core';
import { type Origination } from './origination';

const CONNECTOR_TYPES = [
  'PROPRIETORSHIP',
  'PARTNERSHIP',
  'PVT_LTD',
  'LLP',
  'INDIVIDUAL',
  'PUBLIC_LTD',
  'PVT_LTD',
  'LLP',
] as const;
const CONNECTOR_STATUS = [
  'ACTIVE',
  'ACTIVE',
  'ACTIVE',
  'ACTIVE',
  'ACTIVE',
  'PENDING_VERIFICATION',
  'SUSPENDED',
  'DRAFT',
] as const;
const LEDGER_ACCOUNTS: [string, string, string, string | null, string | null][] = [
  // [code, name, type, counterparty_type, counterparty key]
  ['1000', 'Operating bank account', 'ASSET', 'BANK', 'HDFC'],
  ['1100', 'Lender receivables - commission', 'ASSET', 'LENDER', 'lender'],
  ['1200', 'Advances to connectors', 'ASSET', 'CONNECTOR', 'connector'],
  ['1300', 'Tax receivable (TDS)', 'TAX_RECEIVABLE', 'INTERNAL', null],
  ['2000', 'Connector commission payable', 'LIABILITY', 'CONNECTOR', 'connector'],
  ['2100', 'Clawback reserve', 'LIABILITY', 'INTERNAL', null],
  ['2200', 'Tax payable (GST)', 'TAX_PAYABLE', 'INTERNAL', null],
  ['3000', 'Commission income', 'INCOME', 'LENDER', 'lender'],
  ['3100', 'Processing fee income', 'INCOME', 'BORROWER', null],
  ['4000', 'Payout expense', 'EXPENSE', 'CONNECTOR', 'connector'],
  ['4100', 'Bank charges', 'EXPENSE', 'BANK', 'HDFC'],
  ['9000', 'Reconciliation suspense', 'SUSPENSE', 'INTERNAL', null],
];

export function buildFinance(
  t: Tenant,
  out: Tables,
  o: Origination,
  staff: {
    owner: string;
    loanops: string;
    branchmgr: string;
    compliance: string;
    rm1: string;
    rm2: string;
    sales1: string;
    teammgr: string;
  },
): void {
  const d = ANCHOR;
  const connectors = Array.from({ length: CONNECTORS }, (_, i) => connectorId(t, i + 1));

  // Connectors, agreements, bank accounts and the statement trail --------------------------------------------------
  connectors.forEach((cid, i) => {
    const first = ix(FIRST_NAMES, (i * 5 + 2) % FIRST_NAMES.length);
    const last = ix(LAST_NAMES, (i * 11 + 3) % LAST_NAMES.length);
    const mobile = mobileFor(t.tagDigit, 600 + i);
    const email = emailFor(first, last, 600 + i);
    out.add('connector', {
      id: cid,
      tenant_id: t.id,
      connector_type: ix(CONNECTOR_TYPES, i),
      legal_name: i === 0 ? ix(FIRMS, 10) : `${ix(FIRMS, i % FIRMS.length)} Advisors`,
      contact_person: `${first} ${last}`,
      mobile_e164: mobile,
      mobile_hash: sha256Bytes(mobile),
      email,
      email_hash: sha256Bytes(email),
      encrypted_pan: sha256Bytes(`pan-cipher-${t.tag}-${i}`),
      pan_hash: sha256Bytes(`pan-hash-${t.tag}-${i}`),
      pan_masked: `******${pad(i + 1, 4)}`,
      gstin: null,
      primary_branch_id: ix(t.branches, i % 2 === 0 ? 'MUM01' : 'PUN01'),
      relationship_owner_user_id: i % 2 === 0 ? staff.branchmgr : staff.rm1,
      status: ix(CONNECTOR_STATUS, i),
      created_by: staff.owner,
      updated_by: staff.owner,
    });
    out.add('connector_agreement', {
      id: idOf(t, 'cag', i + 1),
      tenant_id: t.id,
      connector_id: cid,
      version: 1,
      valid_from: at(d, -60),
      valid_to: at(d, 300),
      permitted_products: ['PL', 'BL', 'LAP'],
      share_rule_scope: i % 2 === 0 ? 'FIXED_SHARE' : 'TIERED_SHARE',
      evidence_ref: `evidence/agreements/${t.tag}/${pad(i + 1)}.pdf`,
      status: i === 7 ? 'DRAFT' : i === 6 ? 'EXPIRED' : 'ACTIVE',
      created_by: staff.owner,
      updated_by: staff.owner,
    });
    const acct = `${pad(100000 + i * 137, 6)}${pad(i + 1, 4)}`;
    out.add('connector_bank_account', {
      id: idOf(t, 'cba', i + 1),
      tenant_id: t.id,
      connector_id: cid,
      account_holder_name: `${first} ${last}`,
      encrypted_account_number: sha256Bytes(`acct-cipher-${t.tag}-${i}`),
      account_hash: sha256Bytes(`acct-hash-${t.tag}-${i}`),
      account_masked: `XXXXXX${acct.slice(-4)}`,
      ifsc_code: i % 2 === 0 ? 'HDFC0001234' : 'ICIC0004321',
      verification_id: idOf(t, 'ver', (i % 8) + 1),
      status: i < 4 ? 'ACTIVE' : i === 4 ? 'PENDING_APPROVAL' : i === 5 ? 'REJECTED' : 'DISABLED',
      cooling_until: i < 4 ? at(d, -3) : at(d, 2),
      approved_at: i < 4 ? at(d, -5) : null,
      approved_by: i < 4 ? staff.owner : null,
      created_by: staff.loanops,
      updated_by: staff.loanops,
    });
    out.add('referral_consent_otp', {
      id: idOf(t, 'rco', i + 1),
      tenant_id: t.id,
      connector_id: cid,
      mobile_hash: sha256Bytes(mobile),
      code_hash: sha256Hex(`otp-referral-${t.tag}-${i}`),
      expires_at: at(d, 4, i),
      attempts: i % 3,
      verified_at: i < 6 ? at(d, 3, i) : null,
      used_by_lead: i < 3 ? ix(o.leads, i) : null,
      created_by: staff.owner,
    });
  });

  // Statement entries per connector: commission earned, payout disbursed, adjustments, TDS, opening balance.
  const entryTypes = [
    'OPENING_BALANCE',
    'COMMISSION_EARNED',
    'COMMISSION_EARNED',
    'TAX_DEDUCTION',
    'PAYOUT_DISBURSED',
    'ADJUSTMENT',
    'COMMISSION_EARNED',
    'PAYOUT_DISBURSED',
  ] as const;
  entryTypes.forEach((type, i) => {
    const cid = ix(connectors, i);
    const amount =
      type === 'OPENING_BALANCE'
        ? 0
        : type === 'TAX_DEDUCTION'
          ? -180
          : type === 'PAYOUT_DISBURSED'
            ? -15000
            : 25000 + i * 500;
    out.add('connector_statement_entry', {
      id: idOf(t, 'cse', i + 1),
      tenant_id: t.id,
      connector_id: cid,
      entry_type: type,
      amount,
      currency: 'INR',
      reference_id: type === 'PAYOUT_DISBURSED' ? idOf(t, 'pay', (i % 8) + 1) : idOf(t, 'cpy', (i % 8) + 1),
      description: `${type.toLowerCase().replace(/_/g, ' ')} posted for the demo cohort (synthetic)`,
      entry_date: onDate('2026-10-05', i),
      balance_after: 25000 + i * 500,
      created_by: staff.loanops,
      updated_by: staff.loanops,
    });
  });

  // Commission plans (one per lender) ---------------------------------------------------------------------------------
  o.lenders.forEach((lid, i) =>
    out.add('commission_plan', {
      id: idOf(t, 'cpl', i + 1),
      tenant_id: t.id,
      lender_id: lid,
      qualifying_event: i % 3 === 2 ? 'SANCTION' : 'DISBURSEMENT',
      basis: i % 3 === 2 ? 'SANCTION_AMOUNT' : 'DISBURSED_AMOUNT',
      rounding_mode: 'ROUND_HALF_UP',
      clawback_window_days: 90,
      rule_set_id: null,
      status: i < 6 ? 'ACTIVE' : i === 6 ? 'DRAFT' : 'RETIRED',
      created_by: staff.owner,
      updated_by: staff.owner,
    }),
  );

  // Calculations and payables: one per disbursement tranche (the voided tranche reverses its calculation).
  const calcStatus = [
    'RECEIVED',
    'CLOSED',
    'REVERSED',
    'ACCRUED',
    'DISPUTED',
    'PROJECTED',
    'SUPERSEDED',
    'PARTIALLY_RECEIVED',
  ] as const;
  const payableState = [
    'APPROVED',
    'PAID',
    'REVERSED',
    'ACCRUED',
    'ON_HOLD',
    'ELIGIBLE',
    'IN_PAYOUT',
    'PAID',
  ] as const;
  o.tranches.forEach((tr, i) => {
    const rate = 1.25;
    const gross = Math.round(tr.amount * rate) / 100;
    const calcId = idOf(t, 'cal', i + 1);
    const status = ix(calcStatus, i);
    out.add('commission_calculation', {
      id: calcId,
      tenant_id: t.id,
      lender_id: tr.lender === undefined ? ix(o.lenders, 0) : ix(o.lenders, tr.lender),
      tranche_id: tr.id,
      application_id: ix(o.caseApps, o.lenderCases.indexOf(tr.lenderCase)) ?? ix(o.apps, 0),
      lender_case_id: tr.lenderCase,
      event_date: tr.disbursedOn,
      basis_amount: tr.amount,
      rate,
      rate_type: 'PERCENTAGE',
      cap: 50000,
      gross_amount: gross,
      currency: 'INR',
      calc_kind: status === 'PROJECTED' ? 'PROJECTED' : 'EARNED',
      rule_set_version_id: null,
      decision_record_id: null,
      inputs_hash: sha256Hex(`calc-${t.tag}-${i}`),
      status,
      supersedes_id: status === 'SUPERSEDED' ? idOf(t, 'cal', 1) : null,
      created_by: staff.owner,
      updated_by: staff.owner,
    });
    const connector = ix(connectors, i % CONNECTORS);
    const share = 60;
    const payableId = idOf(t, 'cpy', i + 1);
    out.add('commission_payable', {
      id: payableId,
      tenant_id: t.id,
      calculation_id: calcId,
      connector_id: connector,
      share_rate: share,
      amount: Math.round(gross * share) / 100,
      currency: 'INR',
      state: ix(payableState, i),
      hold_reasons: ix(payableState, i) === 'ON_HOLD' ? ['OPEN_DISPUTE'] : [],
      eligibility_decision_id: null,
      created_by: staff.owner,
      updated_by: staff.owner,
    });
  });

  // Adjustments: write-off, clawback, correction, tax and manual, with one approved and one rejected.
  const adjustmentTypes = [
    'CORRECTION',
    'CLAWBACK',
    'WRITE_OFF',
    'TAX',
    'MANUAL',
    'CORRECTION',
    'CLAWBACK',
    'MANUAL',
  ] as const;
  const adjustmentStatus = [
    'APPROVED',
    'PENDING',
    'APPROVED',
    'APPROVED',
    'REJECTED',
    'PENDING',
    'PENDING',
    'APPROVED',
  ] as const;
  adjustmentTypes.forEach((type, i) =>
    out.add('adjustment', {
      id: idOf(t, 'adj', i + 1),
      tenant_id: t.id,
      adjustment_type: type,
      calculation_id: i % 2 === 0 ? idOf(t, 'cal', i + 1) : null,
      payable_id: i % 2 === 1 ? idOf(t, 'cpy', i + 1) : null,
      amount: type === 'CLAWBACK' ? -2500 : type === 'WRITE_OFF' ? -1200 : 750 + i * 100,
      reason: `${type.toLowerCase().replace(/_/g, ' ')} recorded after the monthly statement review (synthetic)`,
      evidence_ref: `evidence/adjustments/${t.tag}/${pad(i + 1)}.pdf`,
      status: ix(adjustmentStatus, i),
      created_by: staff.compliance,
      approved_at: ix(adjustmentStatus, i) === 'APPROVED' ? at(d, 18, i) : null,
      approved_by: ix(adjustmentStatus, i) === 'APPROVED' ? staff.owner : null,
      type,
      journal_id: null,
      exception_id: null,
      lock_version: 1,
    }),
  );

  // Payouts: each request pays one payable through a payout line, is approved, and goes in a batch.
  const payoutStatus = [
    'PAYMENT_RECORDED',
    'RECONCILED',
    'APPROVED',
    'SUBMITTED',
    'DRAFT',
    'REJECTED',
    'PAYMENT_FAILED',
    'CANCELLED',
  ] as const;
  payoutStatus.forEach((status, i) => {
    const connector = ix(connectors, i % CONNECTORS);
    const payableId = idOf(t, 'cpy', i + 1);
    const payoutId = idOf(t, 'pay', i + 1);
    const amount = Math.round(((ix(o.tranches, i)?.amount ?? 300000) * 1.25 * 60) / 10000) / 1;
    out.add('payout_request', {
      id: payoutId,
      tenant_id: t.id,
      connector_id: connector,
      origin: i % 3 === 0 ? 'FINANCE' : 'CONNECTOR',
      status,
      total: amount,
      currency: 'INR',
      payment_ref_ciphertext:
        status === 'PAYMENT_RECORDED' || status === 'RECONCILED' ? sha256Hex(`pay-${i}`) : null,
      payment_ref_masked:
        status === 'PAYMENT_RECORDED' || status === 'RECONCILED' ? `PAY-REF-****${pad(i + 1, 4)}` : null,
      paid_on: status === 'PAYMENT_RECORDED' || status === 'RECONCILED' ? at(d, 20, i) : null,
      failure_reason: status === 'PAYMENT_FAILED' ? 'Beneficiary account closed (synthetic)' : null,
      retry_of_payout_id: status === 'PAYMENT_FAILED' ? idOf(t, 'pay', 3) : null,
      submitted_by: status === 'DRAFT' ? null : staff.loanops,
      submitted_at: status === 'DRAFT' ? null : at(d, 18, i),
      created_by: staff.loanops,
      updated_by: staff.loanops,
    });
    out.add('payout_line', {
      id: idOf(t, 'pln', i + 1),
      tenant_id: t.id,
      payout_id: payoutId,
      payable_id: payableId,
      amount,
      currency: 'INR',
      status:
        status === 'CANCELLED'
          ? 'REMOVED'
          : status === 'PAYMENT_RECORDED' || status === 'RECONCILED'
            ? 'PAYMENT_RECORDED'
            : status === 'PAYMENT_FAILED'
              ? 'PAYMENT_FAILED'
              : 'INCLUDED',
      created_by: staff.loanops,
    });
    out.add('payout_approval', {
      id: idOf(t, 'pap', i + 1),
      tenant_id: t.id,
      payout_id: payoutId,
      approver_id: staff.owner,
      seat: 'COMMISSION_APPROVER',
      decision: status === 'REJECTED' ? 'REJECTED' : 'APPROVED',
      comment:
        status === 'REJECTED'
          ? 'Bank details do not match the agreement (synthetic)'
          : 'Within the approved payout limit (synthetic)',
      approved_at: at(d, 19, i),
    });
  });
  for (let i = 0; i < 8; i += 1) {
    out.add('payout_batch', {
      id: idOf(t, 'pbt', i + 1),
      tenant_id: t.id,
      payout_ids: [idOf(t, 'pay', i + 1)],
      file_object_key: `payouts/${t.tag}/batch-${pad(i + 1)}.csv`,
      file_sha256: sha256Hex(`batch-${t.tag}-${i}`),
      status: i < 3 ? 'PROCESSED' : i < 5 ? 'DOWNLOADED' : 'GENERATED',
      generated_by: staff.loanops,
      generated_at: at(d, 19, i),
    });
  }

  // Invoices: outgoing to lenders for commission, incoming from connectors for referral fees.
  for (let i = 0; i < 8; i += 1) {
    const toLender = i % 2 === 0;
    const partyId = toLender ? ix(o.lenders, i % o.lenders.length) : ix(connectors, i);
    out.add('invoice', {
      id: idOf(t, 'inv', i + 1),
      tenant_id: t.id,
      direction: toLender ? 'TO_LENDER' : 'FROM_CONNECTOR',
      number: `INV/${t.tag.toUpperCase()}/2026-27/${pad(i + 1, 4)}`,
      date: onDate('2026-10-10', i),
      due_date: onDate('2026-10-25', i),
      amount: 50000 + i * 12500,
      currency: 'INR',
      tax_fields: { gstRate: 18, cgst: 4500 + i * 1125, sgst: 4500 + i * 1125, hsn: '998399' },
      status: i < 2 ? 'PAID' : i === 2 ? 'VOID' : i < 5 ? 'ISSUED' : 'DRAFT',
      calculation_ids: [idOf(t, 'cal', i + 1)],
      party_id: partyId,
      party_name: toLender ? `Lender ${i + 1}` : `Connector ${i + 1}`,
      notes: 'Commission invoice generated for the demo cohort (synthetic).',
      created_by: staff.owner,
      updated_by: staff.owner,
    });
  }

  // Ledger: accounts, periods (March to October 2026), balanced journals and their lines.
  LEDGER_ACCOUNTS.forEach(([code, name, type, cpType, key], i) =>
    out.add('ledger_account', {
      id: idOf(t, 'lac', i + 1),
      tenant_id: t.id,
      code,
      name,
      type,
      counterparty_type: cpType,
      counterparty_id:
        key === 'connector'
          ? ix(connectors, i % CONNECTORS)
          : key === 'lender'
            ? ix(o.lenders, i % o.lenders.length)
            : key,
      currency: 'INR',
      is_active: type !== 'TAX_PAYABLE' && type !== 'TAX_RECEIVABLE' ? true : false,
    }),
  );
  const periods = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  periods.forEach((p, i) =>
    out.add('ledger_period', {
      id: idOf(t, 'lpd', i + 1),
      tenant_id: t.id,
      period: p,
      status: p === '2026-10' ? 'OPEN' : 'CLOSED',
      closed_at: p === '2026-10' ? null : at(d, 4 + i),
      closed_by: p === '2026-10' ? null : staff.owner,
      closing_note: p === '2026-10' ? null : `Month end close for ${p} (synthetic)`,
    }),
  );
  // Eight journals; the first is reversed by the eighth (reversal_of_journal_id).
  const journalDefs: [string, string, string][] = [
    ['PAYOUT_RECORDING', 'payout', 'DEBIT'],
    ['COMMISSION_ACCRUAL', 'calc', 'CREDIT'],
    ['COMMISSION_ACCRUAL', 'calc', 'CREDIT'],
    ['ADJUSTMENT', 'adj', 'DEBIT'],
    ['PERIOD_CLOSE', 'period', 'DEBIT'],
    ['MANUAL', 'manual', 'DEBIT'],
    ['PAYOUT_RECORDING', 'payout', 'DEBIT'],
    ['ADJUSTMENT', 'adj', 'DEBIT'],
  ];
  journalDefs.forEach(([refType, refKey, _side], i) => {
    const journalId = idOf(t, 'jnl', i + 1);
    const reversed = i === 0;
    out.add('ledger_journal', {
      id: journalId,
      tenant_id: t.id,
      journal_number: `JV/${t.tag.toUpperCase()}/2026-10/${pad(i + 1, 4)}`,
      reference_type: refType,
      reference_id: idOf(t, refKey, i + 1),
      idempotency_key: `jv-${t.tag}-${i + 1}-2026-10`,
      period: '2026-10',
      status: reversed ? 'REVERSED' : 'POSTED',
      reversal_of_journal_id: i === 7 ? idOf(t, 'jnl', 1) : null,
      posted_at: at(d, 18, i),
      posted_by: staff.owner,
    });
    const amount = 10000 + i * 2500;
    const debitAcct = idOf(t, 'lac', 2);
    const creditAcct = idOf(t, 'lac', 5);
    out.add('ledger_journal_line', {
      id: idOf(t, 'jln', i * 2 + 1),
      tenant_id: t.id,
      journal_id: journalId,
      account_id: debitAcct,
      entry_type: 'DEBIT',
      amount,
      currency: 'INR',
      narration: `Debit leg for ${refType.toLowerCase()} (synthetic)`,
      line_number: 1,
    });
    out.add('ledger_journal_line', {
      id: idOf(t, 'jln', i * 2 + 2),
      tenant_id: t.id,
      journal_id: journalId,
      account_id: creditAcct,
      entry_type: 'CREDIT',
      amount,
      currency: 'INR',
      narration: `Credit leg for ${refType.toLowerCase()} (synthetic)`,
      line_number: 2,
    });
  });

  // Lender statements, their lines and reconciliation of commission against the statements.
  o.lenders.forEach((lid, i) =>
    out.add('lender_statement', {
      id: idOf(t, 'lst', i + 1),
      tenant_id: t.id,
      lender_id: lid,
      period: '2026-09',
      source_file_key: `statements/${t.tag}/${pad(i + 1)}-2026-09.csv`,
      import_batch_id: idOf(t, 'imp', 3 + i),
      file_sha256: sha256Hex(`stmt-${t.tag}-${i}`),
      totals: { lines: 2, disbursed: 1500000 + i * 1000, commission: 15000 + i * 100 },
      status: [
        'RECONCILED',
        'MATCHED',
        'PARTIALLY_MATCHED',
        'IMPORTED',
        'FAILED',
        'RECONCILED',
        'IMPORTED',
        'MATCHED',
      ][i] as string,
      created_by: staff.loanops,
    }),
  );
  o.lenders.forEach((_, i) =>
    out.add('lender_statement_line', {
      id: idOf(t, 'sln', i + 1),
      tenant_id: t.id,
      statement_id: idOf(t, 'lst', i + 1),
      loan_account_hash: sha256Hex(`loan-acct-${t.tag}-${i}`),
      customer_name_masked: `${ix(FIRST_NAMES, i)[0]}**** ${ix(LAST_NAMES, i)[0]}****`,
      disbursed_amount: 500000 + i * 25000,
      commission_amount: 6250 + i * 300,
      tax_deducted: 0,
      paid_on: onDate('2026-09-28', i % 4),
      raw_row_ref: `row-${pad(i + 1)}`,
      status: [
        'MATCHED',
        'UNMATCHED',
        'EXCEPTION',
        'DISPUTED',
        'MATCHED',
        'UNMATCHED',
        'EXCEPTION',
        'MATCHED',
      ][i] as string,
    }),
  );
  for (let i = 0; i < 8; i += 1) {
    out.add('reconciliation_match', {
      id: idOf(t, 'rmt', i + 1),
      tenant_id: t.id,
      statement_line_id: idOf(t, 'sln', i + 1),
      calculation_id: idOf(t, 'cal', i + 1),
      match_type: ['EXACT', 'EXACT', 'PARTIAL', 'VARIANCE', 'UNMATCHED', 'DUPLICATE', 'EXACT', 'PARTIAL'][
        i
      ] as string,
      matched_amount: 6250 + i * 300,
      decision_record_id: idOf(t, 'dr', 400 + (i % 10)),
      status: i === 5 ? 'REVOKED' : i === 3 ? 'SUPERSEDED' : 'ACTIVE',
      created_by: staff.loanops,
    });
  }
  for (let i = 0; i < 8; i += 1) {
    const open = i % 3 !== 0;
    out.add('reconciliation_exception', {
      id: idOf(t, 'rex', i + 1),
      tenant_id: t.id,
      statement_line_id: idOf(t, 'sln', i + 1),
      calculation_id: idOf(t, 'cal', i + 1),
      variance_amount: i % 2 === 0 ? -150 * (i + 1) : 90 * (i + 1),
      classification: [
        'SHORT_REMITTANCE',
        'OVER_REMITTANCE',
        'MISSING_REMITTANCE',
        'UNMATCHED_STATEMENT_LINE',
        'DUPLICATE_REMITTANCE',
        'TIMING_DIFFERENCE',
        'SHORT_REMITTANCE',
        'TIMING_DIFFERENCE',
      ][i] as string,
      status: open ? (i === 4 ? 'INVESTIGATING' : 'OPEN') : i === 3 ? 'WRITTEN_OFF' : 'RESOLVED',
      owner_user_id: staff.loanops,
      evidence_ref: `evidence/recon/${t.tag}/${pad(i + 1)}.pdf`,
      resolution_note: open
        ? null
        : 'Lender confirmed the short remittance in its next statement (synthetic)',
      resolved_at: open ? null : at(d, 22, i),
      resolved_by: open ? null : staff.owner,
      created_by: staff.loanops,
    });
  }

  // Disputes raised by lenders or connectors, each tied to a subject; resolved ones point at an adjustment.
  for (let i = 0; i < 8; i += 1) {
    const resolved = i < 3;
    out.add('dispute', {
      id: idOf(t, 'dsp', i + 1),
      tenant_id: t.id,
      party_type: i % 2 === 0 ? 'CONNECTOR' : 'LENDER',
      party_id: i % 2 === 0 ? ix(connectors, i) : ix(o.lenders, i),
      subject_type: ['CALCULATION', 'PAYOUT', 'STATEMENT_LINE'][i % 3],
      subject_id:
        i % 3 === 0 ? idOf(t, 'cal', i + 1) : i % 3 === 1 ? idOf(t, 'pay', i + 1) : idOf(t, 'sln', i + 1),
      reason: 'Commission amount does not match the agreed share (synthetic)',
      status: resolved
        ? 'RESOLVED'
        : i === 5
          ? 'UNDER_REVIEW'
          : i === 6
            ? 'REJECTED'
            : i === 7
              ? 'WITHDRAWN'
              : 'OPEN',
      resolution: resolved ? 'Adjustment posted for the difference (synthetic)' : null,
      outcome_adjustment_id: resolved ? idOf(t, 'adj', i + 1) : null,
      created_by: staff.compliance,
      updated_by: staff.compliance,
    });
  }

  // Recalculation proposals, pending or decided, over one or more calculations.
  for (let i = 0; i < 8; i += 1) {
    out.add('recalculation_proposal', {
      id: idOf(t, 'rcp', i + 1),
      tenant_id: t.id,
      reason: 'Rate change on the commission plan from October (synthetic)',
      affected_calculation_ids: [idOf(t, 'cal', i + 1), idOf(t, 'cal', ((i + 1) % 8) + 1)],
      preview: { deltaAmount: -250 * (i + 1), calculations: 2 },
      status: i < 2 ? 'APPROVED' : i === 2 ? 'REJECTED' : 'PENDING',
      approved_by: i < 3 ? staff.owner : null,
      approved_at: i < 3 ? at(d, 23, i) : null,
      created_by: staff.owner,
      updated_by: staff.owner,
    });
  }
}
