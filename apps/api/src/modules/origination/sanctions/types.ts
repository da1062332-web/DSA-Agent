// apps/api/src/modules/origination/sanctions/types.ts — owner: Dev 3 (MOD-SND Types)
import type {
  DisbursementTrancheDto,
  RateType,
  SanctionDto,
  SanctionSource,
  SanctionStatus,
  TrancheStatus,
} from '@dsa/contracts';

export interface SanctionRow {
  id: string;
  tenant_id: string;
  lender_case_id: string;
  version: number;
  amount: string; // numeric(18,2) in pg
  tenure_months: number;
  rate_value: string; // numeric(7,4) in pg
  rate_type: RateType;
  benchmark_text: string | null;
  fees_text: string | null;
  conditions: string[];
  sanction_date: string;
  valid_until: string;
  letter_document_id: string | null;
  status: SanctionStatus;
  source: SanctionSource;
  cancel_reason: string | null;
  lock_version: number;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
}

export interface DisbursementTrancheRow {
  id: string;
  tenant_id: string;
  sanction_id: string;
  tranche_no: number;
  amount: string; // numeric(18,2) in pg
  currency: string;
  disbursed_on: string;
  utr_ciphertext: string | null;
  utr_masked: string | null;
  loan_account_ciphertext: string | null;
  loan_account_masked: string | null;
  evidence_document_id: string | null;
  status: TrancheStatus;
  recorded_by: string;
  verified_by: string | null;
  verified_at: string | null;
  verification_comment: string | null;
  exception_approval_id: string | null;
  voided_by: string | null;
  void_reason: string | null;
  replaced_by_tranche_id: string | null;
  lock_version: number;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
}

export function toSanctionDto(row: SanctionRow): SanctionDto {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    lenderCaseId: row.lender_case_id,
    version: row.version,
    amount: Number(row.amount),
    tenureMonths: row.tenure_months,
    rateValue: Number(row.rate_value),
    rateType: row.rate_type,
    benchmarkText: row.benchmark_text,
    feesText: row.fees_text,
    conditions: row.conditions || [],
    sanctionDate: row.sanction_date,
    validUntil: row.valid_until,
    letterDocumentId: row.letter_document_id,
    status: row.status,
    source: row.source,
    cancelReason: row.cancel_reason,
    lockVersion: row.lock_version,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export function toTrancheDto(row: DisbursementTrancheRow): DisbursementTrancheDto {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sanctionId: row.sanction_id,
    trancheNo: row.tranche_no,
    amount: Number(row.amount),
    currency: row.currency,
    disbursedOn: row.disbursed_on,
    utrMasked: row.utr_masked,
    loanAccountMasked: row.loan_account_masked,
    evidenceDocumentId: row.evidence_document_id,
    status: row.status,
    recordedBy: row.recorded_by,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
    verificationComment: row.verification_comment,
    exceptionApprovalId: row.exception_approval_id,
    voidedBy: row.voided_by,
    voidReason: row.void_reason,
    replacedByTrancheId: row.replaced_by_tranche_id,
    lockVersion: row.lock_version,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}
