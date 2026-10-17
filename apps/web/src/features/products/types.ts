export type ProductCategory = 'HOME_LOAN' | 'LAP' | 'BUSINESS_LOAN' | 'PERSONAL_LOAN';

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
