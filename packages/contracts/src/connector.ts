// packages/contracts/src/connector.ts — Module 27: Connector Management (MOD-CON)
import { z } from 'zod';
import { containsS2SensitiveData } from './activity';
import { IdSchema } from './ids';

export const CONNECTOR_TYPES = [
  'INDIVIDUAL',
  'PROPRIETORSHIP',
  'PARTNERSHIP',
  'PVT_LTD',
  'PUBLIC_LTD',
  'LLP',
] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

export const CONNECTOR_STATUSES = [
  'DRAFT',
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
  'TERMINATED',
] as const;
export type ConnectorStatus = (typeof CONNECTOR_STATUSES)[number];

export const BANK_ACCOUNT_STATUSES = ['PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'DISABLED'] as const;
export type BankAccountStatus = (typeof BANK_ACCOUNT_STATUSES)[number];

export const AGREEMENT_STATUSES = ['DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED'] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

export const DISPUTE_STATUSES = ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const DISPUTE_RESOLUTIONS = [
  'ATTRIBUTED_TO_FIRST',
  'ATTRIBUTED_TO_CLAIMANT',
  'SPLIT_COMMISSION',
  'DISMISSED_ORGANIC',
] as const;
export type DisputeResolution = (typeof DISPUTE_RESOLUTIONS)[number];

export const ATTRIBUTION_CHANGE_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type AttributionChangeRequestStatus = (typeof ATTRIBUTION_CHANGE_REQUEST_STATUSES)[number];

// Helper to mask PAN: ABCDE1234F -> ABCDE****F
export function maskPan(pan: string): string {
  if (pan.length !== 10) return pan;
  return `${pan.slice(0, 5)}****${pan.slice(9)}`;
}

// Helper to mask account number: 123456789012 -> ********9012
export function maskAccountNumber(acc: string): string {
  if (acc.length < 4) return '****';
  return `${'*'.repeat(acc.length - 4)}${acc.slice(-4)}`;
}

// ==========================================
// API-CON-001: POST /v1/connectors
// ==========================================
export const CreateConnectorSchema = z.object({
  connectorType: z.enum(CONNECTOR_TYPES),
  legalName: z
    .string()
    .min(3)
    .max(255)
    .refine((s) => !containsS2SensitiveData(s), {
      message: 'Legal name must not contain sensitive account or PAN patterns.',
    }),
  contactPerson: z.string().min(2).max(100),
  mobileE164: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Must be a valid E.164 mobile number'),
  email: z.string().email(),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Invalid Indian PAN format (e.g. ABCDE1234F)'),
  gstin: z
    .string()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GSTIN format')
    .optional()
    .nullable(),
  primaryBranchId: IdSchema('br'),
  relationshipOwnerUserId: IdSchema('usr'),
});
export type CreateConnectorInput = z.infer<typeof CreateConnectorSchema>;

// ==========================================
// API-CON-002: GET /v1/connectors Query
// ==========================================
export const ListConnectorsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  status: z.enum(CONNECTOR_STATUSES).optional(),
  branchId: z.string().optional(),
  connectorType: z.enum(CONNECTOR_TYPES).optional(),
  q: z.string().optional(),
});
export type ListConnectorsQuery = z.infer<typeof ListConnectorsQuerySchema>;

// ==========================================
// API-CON-003: PATCH /v1/connectors/{id}
// ==========================================
export const UpdateConnectorSchema = z.object({
  legalName: z
    .string()
    .min(3)
    .max(255)
    .refine((s) => !containsS2SensitiveData(s), {
      message: 'Legal name must not contain sensitive patterns.',
    })
    .optional(),
  contactPerson: z.string().min(2).max(100).optional(),
  mobileE164: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/)
    .optional(),
  email: z.string().email().optional(),
  gstin: z
    .string()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/)
    .optional()
    .nullable(),
  primaryBranchId: IdSchema('br').optional(),
  relationshipOwnerUserId: IdSchema('usr').optional(),
  // Required when relationshipOwnerUserId changes (checked in the service). Recorded in the audit event.
  ownerChangeReason: z.string().trim().min(5).max(500).optional(),
});
export type UpdateConnectorInput = z.infer<typeof UpdateConnectorSchema>;

// ==========================================
// GET /v1/connectors/lookup (picker data; no API-CON id). Minimal fields only: no PAN, mobile, e-mail, bank or agreement data.
// ==========================================
export const ConnectorLookupQuerySchema = z.object({
  status: z.enum(CONNECTOR_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
});
export type ConnectorLookupQuery = z.infer<typeof ConnectorLookupQuerySchema>;

export interface ConnectorLookupItem {
  id: string;
  legalName: string;
  status: string;
  primaryBranchId: string;
}

// ==========================================
// API-CON-005: POST /v1/connectors/{id}/activation
// ==========================================
export const ActivateConnectorSchema = z.object({
  verificationId: IdSchema('ver'),
  remarks: z.string().max(500).optional(),
});
export type ActivateConnectorInput = z.infer<typeof ActivateConnectorSchema>;

// ==========================================
// API-CON-006: POST /v1/connectors/{id}/status
// ==========================================
export const UpdateConnectorStatusSchema = z.object({
  targetStatus: z.enum(['ACTIVE', 'SUSPENDED', 'TERMINATED']),
  reason: z
    .string()
    .min(5)
    .max(500)
    .refine((s) => !containsS2SensitiveData(s), {
      message: 'Status change reason must not contain sensitive data.',
    }),
});
export type UpdateConnectorStatusInput = z.infer<typeof UpdateConnectorStatusSchema>;

// ==========================================
// API-CON-007: POST /v1/connectors/{id}/bank-accounts
// ==========================================
export const CreateConnectorBankAccountSchema = z.object({
  accountHolderName: z.string().min(3).max(255),
  accountNumber: z.string().regex(/^\d{9,18}$/, 'Account number must be 9 to 18 digits'),
  ifscCode: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code format (e.g. HDFC0001234)'),
  verificationId: IdSchema('ver').optional().nullable(),
});
export type CreateConnectorBankAccountInput = z.infer<typeof CreateConnectorBankAccountSchema>;

export const ApproveConnectorBankAccountSchema = z.object({
  remarks: z.string().max(500).optional(),
});
export type ApproveConnectorBankAccountInput = z.infer<typeof ApproveConnectorBankAccountSchema>;

// ==========================================
// API-CON-004: POST /v1/connectors/{id}/agreements
// ==========================================
export const CreateConnectorAgreementSchema = z.object({
  validFrom: z.string().datetime(),
  validTo: z.string().datetime(),
  permittedProducts: z.array(z.string().min(2)).min(1),
  shareRuleScope: z.string().min(2).max(100),
  evidenceRef: z.string().min(3),
});
export type CreateConnectorAgreementInput = z.infer<typeof CreateConnectorAgreementSchema>;

// ==========================================
// API-CON-011: POST /v1/connectors/{id}/users
// ==========================================
export const InviteConnectorUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(2).max(100),
  mobileE164: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/)
    .optional()
    .nullable(),
});
export type InviteConnectorUserInput = z.infer<typeof InviteConnectorUserSchema>;

// ==========================================
// API-CON-009: POST /v1/attribution-change-requests
// ==========================================
export const CreateAttributionChangeRequestSchema = z.object({
  leadId: IdSchema('lead'),
  proposedConnectorId: IdSchema('con'),
  reason: z
    .string()
    .min(5)
    .max(1000)
    .refine((s) => !containsS2SensitiveData(s), {
      message: 'Reason must not contain plaintext financial or PAN patterns.',
    }),
  evidenceRef: z.string().min(3),
  recalculationProposal: z.string().max(500).optional().nullable(),
});
export type CreateAttributionChangeRequestInput = z.infer<typeof CreateAttributionChangeRequestSchema>;

export const ApproveAttributionChangeRequestSchema = z.object({
  remarks: z.string().max(500).optional(),
});
export type ApproveAttributionChangeRequestInput = z.infer<typeof ApproveAttributionChangeRequestSchema>;

// ==========================================
// API-CON-008: POST /v1/attribution-disputes/{id}/resolution
// ==========================================
export const ResolveAttributionDisputeSchema = z.object({
  resolution: z.enum(DISPUTE_RESOLUTIONS),
  resolvedConnectorId: IdSchema('con').optional().nullable(),
  resolutionNotes: z
    .string()
    .min(5)
    .max(1000)
    .refine((s) => !containsS2SensitiveData(s), {
      message: 'Resolution notes must not contain sensitive plaintext data.',
    }),
});
export type ResolveAttributionDisputeInput = z.infer<typeof ResolveAttributionDisputeSchema>;

// ==========================================
// Response Resource Types
// ==========================================
export interface ConnectorResource {
  id: string;
  tenantId: string;
  connectorType: ConnectorType;
  legalName: string;
  contactPerson: string;
  mobileE164: string;
  email: string;
  panMasked: string;
  gstin: string | null;
  primaryBranchId: string;
  relationshipOwnerUserId: string;
  status: ConnectorStatus;
  lockVersion: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ConnectorBankAccountResource {
  id: string;
  tenantId: string;
  connectorId: string;
  accountHolderName: string;
  accountMasked: string;
  ifscCode: string;
  verificationId: string | null;
  status: BankAccountStatus;
  coolingUntil: string | null;
  lockVersion: number;
  createdAt: string;
  createdBy: string;
  approvedAt: string | null;
  approvedBy: string | null;
  updatedAt: string;
  updatedBy: string;
}

export interface ConnectorAgreementResource {
  id: string;
  tenantId: string;
  connectorId: string;
  version: number;
  validFrom: string;
  validTo: string;
  permittedProducts: string[];
  shareRuleScope: string;
  evidenceRef: string;
  status: AgreementStatus;
  lockVersion: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface AttributionChangeRequestResource {
  id: string;
  tenantId: string;
  leadId: string;
  previousConnectorId: string | null;
  proposedConnectorId: string;
  reason: string;
  evidenceRef: string;
  recalculationProposal: string | null;
  status: AttributionChangeRequestStatus;
  requesterId: string;
  approverId: string | null;
  approvedAt: string | null;
  lockVersion: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface AttributionDisputeResource {
  id: string;
  tenantId: string;
  leadId: string;
  claimantConnectorIds: string[];
  resolvedConnectorId: string | null;
  resolution: DisputeResolution | null;
  status: DisputeStatus;
  resolverUserId: string | null;
  resolutionNotes: string | null;
  lockVersion: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}
