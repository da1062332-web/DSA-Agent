// packages/contracts/src/ports/decision-keys.ts — owner: Dev 2 — frozen at Gate 1 (Contracts §4.2)
// Fact and output shapes (MVP subset of Doc 06.3).
// DECIMAL facts are JSON strings ^-?\d+(\.\d{1,10})?$ ; MONEY = Money ; optional fields may be absent (MISSING).
// TODO(TASK-204, Dev 2): add the zod schemas for these shapes; tools/gen-registry-sql.ts renders them to JSON
// Schema for migration M-011, so these types stay the single source of truth.
import type { Money } from '../money';

export type DecisionKey =
  | 'DK-lead.duplicate'
  | 'DK-customer.duplicate'
  | 'DK-lead.assignment'
  | 'DK-sla.target'
  | 'DK-document.requirements'
  | 'DK-application.completeness';

export type ProductCategory = 'PL' | 'BL' | 'MSME' | 'LAP' | 'HL' | 'VL' | 'GL' | 'EL' | 'OTHER';
export type ApplicantType =
  'SALARIED' | 'SELF_EMPLOYED_PROFESSIONAL' | 'SELF_EMPLOYED_BUSINESS' | 'NON_INDIVIDUAL';
export type SlaClass =
  | 'CUSTOMER_FIRST_CONTACT'
  | 'CUSTOMER_FOLLOW_UP'
  | 'LENDER_QUERY'
  | 'LENDER_PROCESSING'
  | 'INTERNAL_REVIEW'
  | 'DOCUMENT_REVIEW';
export type DocumentTypeCode =
  | 'PAN_CARD'
  | 'AADHAAR_MASKED'
  | 'PHOTO'
  | 'SALARY_SLIP'
  | 'BANK_STATEMENT'
  | 'ITR'
  | 'GST_CERT'
  | 'BUSINESS_PROOF'
  | 'PROPERTY_DOC'
  | 'OTHER'; // PA-10

type DupFacts = {
  pair: {
    same_mobile: boolean;
    same_email: boolean;
    name_similarity: string;
    days_since_existing_created: number;
    same_branch: boolean;
  };
  existing: { type: 'LEAD' | 'CUSTOMER'; state: string; is_open: boolean };
};

export interface Facts {
  'DK-lead.duplicate': DupFacts;
  'DK-customer.duplicate': DupFacts;
  'DK-lead.assignment': {
    lead: {
      branch_id: string;
      product_category: ProductCategory;
      source: string;
      indicative_amount?: Money;
      pincode?: string;
    };
    context: { local_hour: number; local_weekday: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN' };
  };
  'DK-sla.target': {
    sla: { class: SlaClass };
    record: {
      type: 'LEAD' | 'APPLICATION' | 'LENDER_CASE' | 'TASK';
      priority?: 'HIGH' | 'MEDIUM' | 'LOW';
      branch_id?: string;
    };
    lead?: { source?: string; product_category?: ProductCategory };
  };
  'DK-document.requirements': {
    product: { category: ProductCategory; id?: string };
    lender?: { id: string };
    party: {
      role: 'PRIMARY' | 'CO_APPLICANT' | 'GUARANTOR';
      type: 'INDIVIDUAL' | 'ENTITY';
      applicant_type: ApplicantType;
    };
    application: { requested_amount: Money; secured: boolean };
  };
  'DK-application.completeness': {
    application: {
      mandatory_pending_count: number;
      rejected_mandatory_count: number;
      waived_count: number;
      requested_amount: Money;
      product_selected: boolean;
    };
    product: { min_amount: Money; max_amount: Money };
    parties: { all_processing_consent: boolean };
  };
}

type DupOut = {
  classification: 'NONE' | 'POSSIBLE' | 'EXACT' | 'ATTRIBUTION_CONFLICT';
  action: 'NONE' | 'FLAG' | 'LINK' | 'BLOCK';
  reasons: string[];
};

export interface Outputs {
  'DK-lead.duplicate': DupOut;
  'DK-customer.duplicate': DupOut;
  'DK-lead.assignment': {
    pool: { userId: string } | { queueId: string } | { queueKind: 'UNASSIGNED' };
    strategy: 'SPECIFIC_USER' | 'ROUND_ROBIN' | 'LEAST_LOADED' | 'QUEUE_ONLY';
    reasonText: string;
  };
  'DK-sla.target': { target_business_minutes: number; warning_pct: number; calendar: 'ALWAYS' }; // PA-06
  'DK-document.requirements': {
    documents: { typeCode: DocumentTypeCode; mandatory: boolean; count: number; periodMonths: number }[];
  };
  'DK-application.completeness': {
    result: 'COMPLETE' | 'INCOMPLETE';
    reasons: { code: string; text: string }[];
  };
}
