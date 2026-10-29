import { LOAN_CATEGORIES, type LoanCategory } from '@dsa/contracts';

/** The category codes the API accepts (PL, BL, MSME, LAP, HL, VL, GL, EL, OTHER). Never invent codes here: the API answers 422. */
export type ProductCategory = LoanCategory;

const CATEGORY_LABELS: Record<LoanCategory, string> = {
  PL: 'Personal loan',
  BL: 'Business loan',
  MSME: 'MSME loan',
  LAP: 'Loan against property',
  HL: 'Home loan',
  VL: 'Vehicle loan',
  GL: 'Gold loan',
  EL: 'Education loan',
  OTHER: 'Other',
};

/** Every category the API accepts, in the contract's order, for filters and forms. */
export const PRODUCT_CATEGORY_OPTIONS: { value: LoanCategory; label: string }[] = LOAN_CATEGORIES.map((value) => ({
  value,
  label: CATEGORY_LABELS[value],
}));

/** The readable name of a category code; an unknown code is shown as it is. */
export const categoryLabel = (code: string): string => CATEGORY_LABELS[code as LoanCategory] ?? code;

export type ProductStatus = 'ACTIVE' | 'INACTIVE';

export interface ProductVersion {
  id: string;
  productId: string;
  versionNo: number;
  effectiveFrom: string;
  amountMin: string;
  amountMax: string;
  tenureMin: number;
  tenureMax: number;
  illustrativeRateText: string | null;
  feeText: string | null;
  geoRules?: Record<string, unknown> | null;
  workflowProfile?: Record<string, unknown> | null;
  documentProfileId?: string | null;
  createdAt: string;
}

export interface LoanProduct {
  id: string;
  tenantId: string;
  lenderId: string;
  lenderName?: string;
  name: string;
  category: ProductCategory;
  applicantTypes: string[];
  secured: boolean;
  ownerUserId: string | null;
  status: ProductStatus;
  activeVersionNo?: number;
  activeVersion?: ProductVersion;
  versions?: ProductVersion[];
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductInput {
  lenderId: string;
  name: string;
  category: ProductCategory;
  applicantTypes: string[];
  secured: boolean;
  ownerUserId?: string;
  amountMin: number;
  amountMax: number;
  tenureMin: number;
  tenureMax: number;
  illustrativeRateText?: string;
  feeText?: string;
  geoRules?: Record<string, unknown>;
}

export interface CreateProductVersionInput {
  effectiveFrom: string;
  amountMin: number;
  amountMax: number;
  tenureMin: number;
  tenureMax: number;
  illustrativeRateText?: string;
  feeText?: string;
  geoRules?: Record<string, unknown>;
  workflowProfile?: Record<string, unknown>;
  documentProfileId?: string;
}

export interface UpdateProductStatusInput {
  status: ProductStatus;
}
