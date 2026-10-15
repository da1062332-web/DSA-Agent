// apps/api/src/modules/reconciliation/types.ts
export * from '@dsa/contracts';

export interface LenderStatementRow {
  id: string;
  tenant_id: string;
  lender_id: string;
  period: string;
  source_file_key: string;
  import_batch_id: string;
  file_sha256: string;
  totals: {
    totalDisbursed: number;
    totalCommission: number;
    totalTaxDeducted: number;
    netCommission: number;
    lineCount: number;
  };
  status: 'IMPORTED' | 'MATCHED' | 'PARTIALLY_MATCHED' | 'RECONCILED' | 'FAILED';
  created_at: Date;
  created_by: string;
}

export interface LenderStatementLineRow {
  id: string;
  tenant_id: string;
  statement_id: string;
  loan_account_hash: string;
  customer_name_masked: string;
  disbursed_amount: string | number;
  commission_amount: string | number;
  tax_deducted: string | number;
  paid_on: string | Date;
  raw_row_ref: string | null;
  status: 'UNMATCHED' | 'MATCHED' | 'EXCEPTION' | 'DISPUTED';
  created_at: Date;
}

export interface ReconciliationMatchRow {
  id: string;
  tenant_id: string;
  statement_line_id: string;
  calculation_id: string;
  match_type: 'EXACT' | 'PARTIAL' | 'VARIANCE' | 'UNMATCHED' | 'DUPLICATE';
  matched_amount: string | number;
  decision_record_id: string | null;
  status: 'ACTIVE' | 'SUPERSEDED' | 'REVOKED';
  created_at: Date;
  created_by: string;
}

export interface ReconciliationExceptionRow {
  id: string;
  tenant_id: string;
  statement_line_id: string | null;
  calculation_id: string | null;
  variance_amount: string | number;
  classification:
    | 'SHORT_REMITTANCE'
    | 'OVER_REMITTANCE'
    | 'MISSING_REMITTANCE'
    | 'UNMATCHED_STATEMENT_LINE'
    | 'DUPLICATE_REMITTANCE'
    | 'TIMING_DIFFERENCE';
  status: 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'WRITTEN_OFF';
  owner_user_id: string | null;
  evidence_ref: string | null;
  resolution_note: string | null;
  resolved_at: Date | null;
  resolved_by: string | null;
  created_at: Date;
  created_by: string;
}

export interface AdjustmentRow {
  id: string;
  tenant_id: string;
  adjustment_type: string;
  type: string;
  amount: string | number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  calculation_id: string | null;
  payable_id: string | null;
  exception_id: string | null;
  evidence_ref: string | null;
  journal_id: string | null;
  lock_version: number;
  created_at: Date;
  created_by: string;
  approved_at: Date | null;
  approved_by: string | null;
}

export interface DisputeRow {
  id: string;
  tenant_id: string;
  party_type: 'LENDER' | 'CONNECTOR';
  party_id: string;
  subject_type: 'STATEMENT_LINE' | 'PAYOUT' | 'CALCULATION';
  subject_id: string;
  reason: string;
  status: 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'REJECTED' | 'WITHDRAWN';
  resolution: string | null;
  outcome_adjustment_id: string | null;
  lock_version: number;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
}
