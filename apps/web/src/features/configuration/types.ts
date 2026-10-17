export type OrganisationConstitution =
  'PROPRIETORSHIP' | 'PARTNERSHIP' | 'LLP' | 'PVT_LTD' | 'PUBLIC_LTD' | 'TRUST' | 'OTHER';

export type TenantType = 'DSA_ORG' | 'NBFC_DISTRIBUTION';
export type RoutingMode = 'ROUND_ROBIN' | 'MANUAL';

export interface OperationalSettings {
  defaultSlaMinutes: number;
  leadRoutingMode: RoutingMode;
  businessHoursStart: string;
  businessHoursEnd: string;
  dataRetentionDays: number;
}

export interface TenantSummary {
  id: string;
  slug: string;
  legalName: string;
  tenantType: TenantType;
  dataRegion: string;
  timezone: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDING';
  createdAt: string;
}

export interface OrganisationSummary {
  id: string;
  legalName: string;
  constitution: OrganisationConstitution;
  status: 'ACTIVE' | 'INACTIVE';
  lockVersion: number;
}

export interface TenantConfigSummary {
  tenant: TenantSummary;
  organisation: OrganisationSummary;
  operationalSettings: OperationalSettings;
}

export interface UpdateTenantConfigInput {
  organisationName?: string;
  constitution?: OrganisationConstitution;
  timezone?: string;
  operationalSettings?: Partial<OperationalSettings>;
}

export interface BranchConfig {
  id: string;
  organisationId: string;
  code: string;
  name: string;
  pincode: string | null;
  timezone: string;
  status: 'ACTIVE' | 'INACTIVE';
  lockVersion: number;
}

export interface CreateBranchInput {
  code: string;
  name: string;
  pincode?: string | null;
  timezone?: string;
}

export interface UpdateBranchInput {
  name?: string;
  pincode?: string | null;
  timezone?: string;
  status?: 'ACTIVE' | 'INACTIVE';
}
