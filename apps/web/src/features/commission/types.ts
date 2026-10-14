export type CommissionPlanStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'ACTIVE' | 'RETIRED';
export type QualifyingEvent = 'DISBURSEMENT' | 'SANCTION' | 'FIRST_EMI';
export type CommissionBasis = 'DISBURSED_AMOUNT' | 'SANCTION_AMOUNT' | 'NET_LOAN';
export type RoundingMode = 'HALF_UP' | 'FLOOR' | 'CEIL';

export interface CommissionPlan {
  id: string;
  tenantId: string;
  lenderId: string;
  qualifyingEvent: QualifyingEvent;
  basis: CommissionBasis;
  roundingMode: RoundingMode;
  clawbackWindowDays: number;
  ruleSetId: string | null;
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
