// apps/api/src/modules/origination/lender-cases/types.ts — owner: Dev 4 (MOD-LCS Lender Cases)
import type {
  DeclineReasonCode,
  LenderCaseStatus,
  PackageKind,
  StatusSource,
  SubmissionChannel,
} from '@dsa/contracts';

export interface LenderCaseRow {
  id: string;
  tenant_id: string;
  application_id: string;
  lender_id: string;
  product_version_id: string;
  empanelment_id: string;
  attempt_no: number;
  status: LenderCaseStatus;
  lender_reference: string | null;
  submission_channel: SubmissionChannel | null;
  submitted_at: Date | null;
  package_id: string | null;
  status_source: StatusSource | null;
  last_status_at: Date | null;
  decline_reason_code: DeclineReasonCode | null;
  staleness_flag: boolean;
  tags: string[];
  lock_version: number;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
}

export interface LenderCaseStatusHistoryRow {
  id: string;
  tenant_id: string;
  lender_case_id: string;
  from_status: LenderCaseStatus | null;
  to_status: LenderCaseStatus;
  status_source: StatusSource;
  reason_text: string | null;
  actor: string;
  occurred_at: Date;
}

export interface SubmissionPackageRow {
  id: string;
  tenant_id: string;
  lender_case_id: string;
  kind: PackageKind;
  manifest: Record<string, unknown>;
  manifest_sha256: string;
  consent_ids: string[];
  built_by: string;
  built_at: Date;
  frozen_at: Date | null;
}

export interface LenderQueryRow {
  id: string;
  tenant_id: string;
  lender_case_id: string;
  text: string;
  requested_items: string[];
  lender_due_date: Date | null;
  task_id: string | null;
  response_manifest_id: string | null;
  responded_at: Date | null;
  created_at: Date;
  created_by: string;
}

export interface DataSharingRecordRow {
  id: string;
  tenant_id: string;
  subject_type: 'LOAN_APPLICATION';
  subject_id: string;
  recipient_type: 'LENDER';
  recipient_id: string;
  purpose: 'LENDER_SUBMISSION';
  consent_ids: string[];
  items: Record<string, unknown>;
  channel: SubmissionChannel;
  source_ref: string;
  actor_id: string;
  shared_at: Date;
}

export interface ApplicationLookupRow {
  id: string;
  tenant_id: string;
  branch_id: string;
  customer_id: string;
  product_category: string;
  status: string;
  sub_status: string | null;
  lock_version: number;
}

export interface LenderLookupRow {
  id: string;
  tenant_id: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'TERMINATED';
}

export interface EmpanelmentLookupRow {
  id: string;
  tenant_id: string;
  lender_id: string;
  dsa_code: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
  permitted_categories: string[];
}

export interface ProductVersionLookupRow {
  id: string;
  tenant_id: string;
  product_id: string;
  version_no: number;
  status: 'ACTIVE' | 'RETIRED';
}
