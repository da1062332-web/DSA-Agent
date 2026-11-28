export type CommissionPlanStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'ACTIVE' | 'RETIRED';
export type QualifyingEvent = 'DISBURSEMENT' | 'SANCTION' | 'FIRST_EMI';
export type CommissionBasis = 'DISBURSED_AMOUNT' | 'SANCTION_AMOUNT' | 'NET_LOAN';
export type RoundingMode = 'HALF_UP' | 'FLOOR' | 'CEIL';

/** Doc 02 loan categories. Mirrors LOAN_CATEGORIES in @dsa/contracts. */
export const PRODUCT_CATEGORIES = ['PL', 'BL', 'MSME', 'LAP', 'HL', 'VL', 'GL', 'EL', 'OTHER'] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/** P2-01: how the lender's commission is taxed. Reverse charge means the invoice carries no GST. */
export type CommissionTaxTreatment = 'FORWARD_CHARGE' | 'REVERSE_CHARGE';

export interface CommissionPlan {
  id: string;
  tenantId: string;
  lenderId: string;
  qualifyingEvent: QualifyingEvent;
  basis: CommissionBasis;
  roundingMode: RoundingMode;
  clawbackWindowDays: number;
  ruleSetId: string | null;
  taxTreatment: CommissionTaxTreatment;
  gstRateBps: number;
  tdsRateBps: number;
  status: CommissionPlanStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  lockVersion: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface CommissionCalculation {
  id: string;
  tenantId: string;
  lenderId: string;
  trancheId: string;
  applicationId: string | null;
  lenderCaseId: string | null;
  eventDate: string;
  basisAmount: string;
  rate: string;
  rateType: string;
  /** The band this calculation was priced on, or null when a custom rate was used. */
  slabId: string | null;
  productCategory: ProductCategory | null;
  cap: string | null;
  grossAmount: string;
  currency: string;
  calcKind: string;
  ruleSetVersionId: string | null;
  decisionRecordId: string | null;
  inputsHash: string;
  status: string;
  supersedesId: string | null;
  createdAt: string;
  createdBy: string;
}

export interface CommissionPayable {
  id: string;
  tenantId: string;
  calculationId: string;
  connectorId: string;
  shareRate: string;
  amount: string;
  currency: string;
  state: 'ACCRUED' | 'ON_HOLD' | 'ELIGIBLE' | 'IN_PAYOUT' | 'APPROVED' | 'PAID' | 'REVERSED';
  holdReasons?: Record<string, unknown> | null;
  eligibilityDecisionId: string | null;
  lockVersion: number;
  createdAt: string;
  createdBy: string;
}

export interface RecalculationProposal {
  id: string;
  tenantId: string;
  reason: string;
  affectedCalculationIds: string[];
  preview?: Record<string, unknown> | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  createdBy: string;
}

export interface CreateCommissionPlanInput {
  lenderId: string;
  qualifyingEvent?: QualifyingEvent;
  basis?: CommissionBasis;
  roundingMode?: RoundingMode;
  clawbackWindowDays?: number;
  ruleSetId?: string;
}

export interface CalculateCommissionInput {
  lenderId: string;
  trancheId: string;
  basisAmount: string;
  customRate?: number;
  connectorId?: string;
  connectorShareRate?: number;
  applicationId?: string;
  lenderCaseId?: string;
  /** Required unless customRate is given: the band is looked up per product. */
  productCategory?: ProductCategory;
  slabId?: string;
}

export interface CreateClawbackInput {
  calculationId: string;
  payableId: string;
  amount: string;
  reason: string;
  evidenceRef?: string;
}

export interface CreateRecalculationProposalInput {
  reason: string;
  affectedCalculationIds: string[];
  preview?: Record<string, unknown>;
}

// ============================================================
// P2-01: the lender's payout grid (commission plan slabs)
// ============================================================

export interface CommissionPlanSlab {
  id: string;
  planId: string;
  productCategory: ProductCategory;
  /** Inclusive lower bound of the month's volume band. */
  volumeFrom: string;
  /** Exclusive upper bound; null on the open-ended top band. */
  volumeTo: string | null;
  /** 100 bps = 1.00%. Exactly one of rateBps or flatAmount is set. */
  rateBps: number | null;
  flatAmount: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  lockVersion: number;
  createdAt: string;
  createdBy: string;
}

export interface CreateCommissionPlanSlabInput {
  productCategory: ProductCategory;
  volumeFrom?: string;
  volumeTo?: string | null;
  rateBps?: number | null;
  flatAmount?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export type UpdateCommissionPlanSlabInput = Partial<Omit<CreateCommissionPlanSlabInput, 'productCategory'>>;

export interface SlabPreviewInput {
  productCategory: ProductCategory;
  monthlyVolume: string;
  basisAmount: string;
  asOf?: string;
}

export interface SlabPreviewResponse {
  slabId: string | null;
  rateBps: number | null;
  flatAmount: string | null;
  grossAmount: string | null;
  currency: string;
  /** false when no band covers that volume on that date. The editor says so; it never falls back to a rate. */
  matched: boolean;
}
