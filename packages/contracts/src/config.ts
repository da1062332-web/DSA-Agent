// packages/contracts/src/config.ts — owner: Akash (Developer 2) (MOD-02 Platform & Configuration)
import { z } from 'zod';

export const ORGANISATION_CONSTITUTIONS = [
  'PROPRIETORSHIP',
  'PARTNERSHIP',
  'LLP',
  'PVT_LTD',
  'PUBLIC_LTD',
  'TRUST',
  'OTHER',
] as const;
export type OrganisationConstitution = (typeof ORGANISATION_CONSTITUTIONS)[number];

export const TENANT_TYPES = ['DSA_ORG', 'NBFC_DISTRIBUTION'] as const;
export type TenantType = (typeof TENANT_TYPES)[number];

export const ROUTING_MODES = ['ROUND_ROBIN', 'MANUAL'] as const;
export type RoutingMode = (typeof ROUTING_MODES)[number];

export const OperationalSettings = z.object({
  defaultSlaMinutes: z.number().int().min(1).max(1440).default(15),
  leadRoutingMode: z.enum(ROUTING_MODES).default('ROUND_ROBIN'),
  businessHoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM format').default('09:30'),
  businessHoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM format').default('18:30'),
  dataRetentionDays: z.number().int().min(30).max(3650).default(365),
});
export type OperationalSettings = z.infer<typeof OperationalSettings>;

export const TenantSummary = z.object({
  id: z.string(),
  slug: z.string(),
  legalName: z.string(),
  tenantType: z.enum(TENANT_TYPES),
  dataRegion: z.string(),
  timezone: z.string(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'OFFBOARDING']),
  createdAt: z.string(),
});
export type TenantSummary = z.infer<typeof TenantSummary>;

export const OrganisationSummary = z.object({
  id: z.string(),
  legalName: z.string(),
  constitution: z.enum(ORGANISATION_CONSTITUTIONS),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  lockVersion: z.number().int(),
});
export type OrganisationSummary = z.infer<typeof OrganisationSummary>;

export const TenantConfigSummary = z.object({
  tenant: TenantSummary,
  organisation: OrganisationSummary,
  operationalSettings: OperationalSettings,
});
export type TenantConfigSummary = z.infer<typeof TenantConfigSummary>;

export const UpdateTenantConfigRequest = z.object({
  organisationName: z.string().min(2).max(150).optional(),
  constitution: z.enum(ORGANISATION_CONSTITUTIONS).optional(),
  timezone: z.string().min(2).max(50).optional(),
  operationalSettings: z
    .object({
      defaultSlaMinutes: z.number().int().min(1).max(1440).optional(),
      leadRoutingMode: z.enum(ROUTING_MODES).optional(),
      businessHoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM format').optional(),
      businessHoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM format').optional(),
      dataRetentionDays: z.number().int().min(30).max(3650).optional(),
    })
    .optional(),
});
export type UpdateTenantConfigRequest = z.infer<typeof UpdateTenantConfigRequest>;

export const BranchConfigSummary = z.object({
  id: z.string(),
  organisationId: z.string(),
  code: z.string(),
  name: z.string(),
  pincode: z.string().nullable(),
  timezone: z.string(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  lockVersion: z.number().int(),
});
export type BranchConfigSummary = z.infer<typeof BranchConfigSummary>;

export const CreateBranchRequest = z.object({
  code: z
    .string()
    .regex(/^[A-Z0-9_-]{2,20}$/, 'Branch code must be 2-20 characters matching ^[A-Z0-9_-]{2,20}$, e.g. MUM01'),
  name: z.string().min(1).max(100),
  pincode: z.string().regex(/^[1-9][0-9]{5}$/, 'Pincode must be 6 digits starting with 1-9').optional().nullable(),
  timezone: z.string().default('Asia/Kolkata'),
});
export type CreateBranchRequest = z.infer<typeof CreateBranchRequest>;

export const UpdateBranchRequest = z.object({
  name: z.string().min(1).max(100).optional(),
  pincode: z.string().regex(/^[1-9][0-9]{5}$/, 'Pincode must be 6 digits starting with 1-9').optional().nullable(),
  timezone: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
export type UpdateBranchRequest = z.infer<typeof UpdateBranchRequest>;
