// packages/contracts/src/audit.ts — Module 37: Audit (MOD-AUD, DOM-N)
import { z } from 'zod';
import { CursorQuery, listResponse } from './pagination';
import { IdSchema } from './ids';

export const ActorTypeSchema = z.enum(['USER', 'SERVICE']);
export type ActorType = z.infer<typeof ActorTypeSchema>;

export const AuditEventSchema = z.object({
  id: IdSchema('aud'),
  tenantId: z.string(),
  seq: z.number().int().optional(),
  occurredAt: z.string().datetime(),
  actorType: ActorTypeSchema,
  actorId: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  permissionUsed: z.string().nullable().optional(),
  approvalRef: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  decisionRecordId: z.string().nullable().optional(),
  before: z.record(z.unknown()).nullable().optional(),
  after: z.record(z.unknown()).nullable().optional(),
  externalSideEffect: z.boolean(),
  correlationId: z.string(),
  ip: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  prevHash: z.string().nullable().optional(),
  hash: z.string().nullable().optional(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const AuditSearchQuery = CursorQuery.extend({
  actorType: ActorTypeSchema.optional(),
  actorId: z.string().min(1).max(128).optional(),
  action: z.string().min(1).max(128).optional(),
  entityType: z.string().min(1).max(64).optional(),
  entityId: z.string().min(1).max(128).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  correlationId: z.string().min(1).max(128).optional(),
  decisionRecordId: z.string().min(1).max(128).optional(),
});
export type AuditSearchQuery = z.infer<typeof AuditSearchQuery>;

export const AuditEventListResponse = listResponse(AuditEventSchema);
export type AuditEventListResponse = z.infer<typeof AuditEventListResponse>;

export const AuditChainVerificationStatusSchema = z.enum([
  'VERIFIED',
  'TAMPERED',
  'BROKEN_CHAIN',
  'INCOMPLETE',
  'EMPTY',
]);
export type AuditChainVerificationStatus = z.infer<typeof AuditChainVerificationStatusSchema>;

export const AuditChainVerificationResponse = z.object({
  status: AuditChainVerificationStatusSchema,
  tenantId: z.string(),
  totalEvents: z.number().int().nonnegative(),
  sealedEvents: z.number().int().nonnegative(),
  unsealedEvents: z.number().int().nonnegative(),
  verifiedRange: z
    .object({
      fromSeq: z.number().int().nullable(),
      toSeq: z.number().int().nullable(),
      genesisHash: z.string().nullable(),
      latestHash: z.string().nullable(),
    })
    .nullable(),
  tamperedEvents: z
    .array(
      z.object({
        seq: z.number().int(),
        id: z.string(),
        reason: z.string(),
      }),
    )
    .optional(),
  verifiedAt: z.string().datetime(),
  details: z.string().optional(),
});
export type AuditChainVerificationResponse = z.infer<typeof AuditChainVerificationResponse>;

export const EvidencePackStatusSchema = z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']);
export type EvidencePackStatus = z.infer<typeof EvidencePackStatusSchema>;

export const CreateEvidencePackRequest = z.object({
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  action: z.string().optional(),
  actorId: z.string().optional(),
  includeDecisionRecords: z.boolean().default(true),
  format: z.enum(['json', 'zip']).default('json'),
});
export type CreateEvidencePackRequest = z.infer<typeof CreateEvidencePackRequest>;

export const EvidencePackResponse = z.object({
  id: IdSchema('evp'),
  tenantId: z.string(),
  requestedBy: z.string(),
  status: EvidencePackStatusSchema,
  filters: z.record(z.unknown()),
  recordCount: z.number().int().nonnegative().nullable(),
  checksum: z.string().nullable(),
  fileUrl: z.string().nullable(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  errorMessage: z.string().nullable().optional(),
});
export type EvidencePackResponse = z.infer<typeof EvidencePackResponse>;

export const EvidencePackListResponse = listResponse(EvidencePackResponse);
export type EvidencePackListResponse = z.infer<typeof EvidencePackListResponse>;
