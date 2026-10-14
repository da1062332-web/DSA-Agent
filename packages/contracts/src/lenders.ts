// packages/contracts/src/lenders.ts — owner: Developer 5 (Bhushan) (MOD-LND / Module 28)
import { z } from 'zod';
import { IdSchema } from './ids';

export const LENDER_TYPES = ['BANK', 'NBFC', 'HFC', 'SFB', 'OTHER'] as const;
export type LenderType = (typeof LENDER_TYPES)[number];

export const LENDER_STATUSES = ['ACTIVE', 'PAUSED', 'TERMINATED'] as const;
export type LenderStatus = (typeof LENDER_STATUSES)[number];

export const EMPANELMENT_STATUSES = ['ACTIVE', 'SUSPENDED', 'EXPIRED'] as const;
export type EmpanelmentStatus = (typeof EMPANELMENT_STATUSES)[number];

export const LENDER_CHANNELS = ['EMAIL', 'PORTAL', 'API', 'PHONE'] as const;
export type LenderChannel = (typeof LENDER_CHANNELS)[number];

export const CreateLenderInputSchema = z.object({
  name: z.string().min(2).max(120),
  lenderType: z.enum(LENDER_TYPES),
  regulatorRef: z.string().max(100).optional().nullable(),
  status: z.enum(LENDER_STATUSES).default('ACTIVE'),
  statusReason: z.string().max(255).optional().nullable(),
});
export type CreateLenderInput = z.infer<typeof CreateLenderInputSchema>;

export const UpdateLenderInputSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  lenderType: z.enum(LENDER_TYPES).optional(),
  regulatorRef: z.string().max(100).optional().nullable(),
  status: z.enum(LENDER_STATUSES).optional(),
  statusReason: z.string().max(255).optional().nullable(),
});
export type UpdateLenderInput = z.infer<typeof UpdateLenderInputSchema>;

export const LenderResponseSchema = z.object({
  id: IdSchema('lnd'),
  name: z.string(),
  lenderType: z.enum(LENDER_TYPES),
  regulatorRef: z.string().nullable(),
  status: z.enum(LENDER_STATUSES),
  statusReason: z.string().nullable(),
  lockVersion: z.number().int(),
  createdAt: z.string(),
  createdBy: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type LenderResponse = z.infer<typeof LenderResponseSchema>;

export const CreateEmpanelmentInputSchema = z.object({
  organisationId: z.string(),
  dsaCode: z.string().min(2).max(64),
  validFrom: z.string(),
  validTo: z.string(),
  permittedCategories: z.array(z.string()).min(1),
  permittedGeos: z.record(z.unknown()).optional().nullable(),
  agreementDocumentId: z.string().optional().nullable(),
  status: z.enum(EMPANELMENT_STATUSES).default('ACTIVE'),
});
export type CreateEmpanelmentInput = z.infer<typeof CreateEmpanelmentInputSchema>;

export const UpdateEmpanelmentInputSchema = z.object({
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  permittedCategories: z.array(z.string()).optional(),
  permittedGeos: z.record(z.unknown()).optional().nullable(),
  agreementDocumentId: z.string().optional().nullable(),
  status: z.enum(EMPANELMENT_STATUSES).optional(),
});
export type UpdateEmpanelmentInput = z.infer<typeof UpdateEmpanelmentInputSchema>;

export const EmpanelmentResponseSchema = z.object({
  id: IdSchema('emp'),
  organisationId: z.string(),
  lenderId: IdSchema('lnd'),
  dsaCode: z.string(),
  validRange: z.string(),
  permittedCategories: z.array(z.string()),
  permittedGeos: z.record(z.unknown()).optional().nullable(),
  agreementDocumentId: z.string().nullable(),
  status: z.enum(EMPANELMENT_STATUSES),
  lockVersion: z.number().int(),
  createdAt: z.string(),
  createdBy: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type EmpanelmentResponse = z.infer<typeof EmpanelmentResponseSchema>;

export const LenderContactInputSchema = z.object({
  name: z.string().min(2).max(100),
  role: z.string().min(2).max(50),
  email: z.string().email().optional().nullable(),
  phone: z.string().regex(/^\+?[1-9]\d{7,14}$/).optional().nullable(),
  channel: z.enum(LENDER_CHANNELS).default('EMAIL'),
  escalationLevel: z.number().int().min(1).max(5).default(1),
});
export type LenderContactInput = z.infer<typeof LenderContactInputSchema>;

export const SetLenderContactsInputSchema = z.object({
  contacts: z.array(LenderContactInputSchema),
});
export type SetLenderContactsInput = z.infer<typeof SetLenderContactsInputSchema>;

export const LenderContactResponseSchema = z.object({
  id: IdSchema('lcon'),
  lenderId: IdSchema('lnd'),
  name: z.string(),
  role: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  channel: z.enum(LENDER_CHANNELS),
  escalationLevel: z.number().int(),
  lockVersion: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LenderContactResponse = z.infer<typeof LenderContactResponseSchema>;

export const LenderListQuerySchema = z.object({
  status: z.enum(LENDER_STATUSES).optional(),
  lenderType: z.enum(LENDER_TYPES).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type LenderListQuery = z.infer<typeof LenderListQuerySchema>;
