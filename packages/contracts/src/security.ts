// packages/contracts/src/security.ts — Module 39: Security (MOD-SEC, DOM-N)
import { z } from 'zod';
import { CursorQuery, listResponse } from './pagination';
import { IdSchema } from './ids';

// ============================================================================
// SUB-SEC.01 — Security Monitoring (ENT-096: security_event)
// ============================================================================

export const SECURITY_EVENT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type SecurityEventSeverity = (typeof SECURITY_EVENT_SEVERITIES)[number];

export const SECURITY_EVENT_TYPES = [
  'AUTH_FAILURE',
  'PERMISSION_DENIED',
  'RATE_LIMIT_EXCEEDED',
  'SUSPICIOUS_ACCESS',
  'DATA_EXPORT',
  'CONFIGURATION_CHANGE',
  'INTEGRITY_VIOLATION',
] as const;
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

export const SecurityEventSchema = z.object({
  id: IdSchema('sec'),
  tenantId: IdSchema('ten'),
  type: z.enum(SECURITY_EVENT_TYPES),
  principal: z.string().min(1, 'Principal identifier is required').max(128),
  ip: z.string().min(1, 'IP address is required').max(64),
  severity: z.enum(SECURITY_EVENT_SEVERITIES),
  details: z.record(z.unknown()),
  createdAt: z.string().datetime(),
});
export type SecurityEvent = z.infer<typeof SecurityEventSchema>;

export const CreateSecurityEventRequestSchema = z.object({
  type: z.enum(SECURITY_EVENT_TYPES),
  principal: z.string().min(1, 'Principal identifier is required').max(128),
  ip: z.string().min(1, 'IP address is required').max(64),
  severity: z.enum(SECURITY_EVENT_SEVERITIES),
  details: z.record(z.unknown()).default({}),
});
export type CreateSecurityEventRequest = z.infer<typeof CreateSecurityEventRequestSchema>;

export const SecurityEventListQuerySchema = CursorQuery.extend({
  type: z.enum(SECURITY_EVENT_TYPES).optional(),
  severity: z.enum(SECURITY_EVENT_SEVERITIES).optional(),
  principal: z.string().min(1).max(128).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});
export type SecurityEventListQuery = z.infer<typeof SecurityEventListQuerySchema>;

export const SecurityEventListResponseSchema = listResponse(SecurityEventSchema);
export type SecurityEventListResponse = z.infer<typeof SecurityEventListResponseSchema>;

// ============================================================================
// SUB-SEC.02 — Incident and Breach Management (ENT-102: incident_record)
// ============================================================================

export const INCIDENT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_TYPES = [
  'DATA_BREACH',
  'UNAUTHORIZED_ACCESS',
  'MALWARE',
  'DENIAL_OF_SERVICE',
  'PRIVILEGE_ESCALATION',
  'CREDENTIAL_LEAK',
  'OTHER',
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const INCIDENT_STATUSES = ['OPEN', 'INVESTIGATING', 'CONTAINED', 'RESOLVED', 'CLOSED'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const NotificationEvidenceSchema = z.object({
  notified: z.boolean(),
  notifiedAt: z.string().datetime().nullable(),
  evidenceRef: z.string().max(512).nullable().optional(),
  recipient: z.string().max(256).nullable().optional(),
});
export type NotificationEvidence = z.infer<typeof NotificationEvidenceSchema>;

export const IncidentNotificationsSchema = z.object({
  authority: NotificationEvidenceSchema.optional(),
  tenant: NotificationEvidenceSchema.optional(),
  individual: NotificationEvidenceSchema.optional(),
});
export type IncidentNotifications = z.infer<typeof IncidentNotificationsSchema>;

export const IncidentRecordSchema = z.object({
  id: IdSchema('inc'),
  tenantId: IdSchema('ten'),
  type: z.enum(INCIDENT_TYPES),
  severity: z.enum(INCIDENT_SEVERITIES),
  detectedAt: z.string().datetime(),
  personalDataInvolved: z.boolean(),
  affectedTenants: z.array(z.string()),
  notifications: IncidentNotificationsSchema,
  status: z.enum(INCIDENT_STATUSES),
  postMortemRef: z.string().max(512).nullable().optional(),
  lockVersion: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  createdBy: z.string(),
  updatedAt: z.string().datetime(),
  updatedBy: z.string(),
});
export type IncidentRecord = z.infer<typeof IncidentRecordSchema>;

/**
 * API-SEC-001: POST /v1/incidents
 */
export const CreateIncidentRequestSchema = z.object({
  type: z.enum(INCIDENT_TYPES),
  severity: z.enum(INCIDENT_SEVERITIES),
  detectedAt: z.string().datetime(),
  personalDataInvolved: z.boolean().default(false),
  affectedTenants: z.array(z.string()).default([]),
  notifications: IncidentNotificationsSchema.default({}),
  status: z.enum(INCIDENT_STATUSES).default('OPEN'),
  postMortemRef: z.string().max(512).nullable().optional(),
});
export type CreateIncidentRequest = z.infer<typeof CreateIncidentRequestSchema>;

/**
 * API-SEC-002: PATCH /v1/incidents/{id}
 */
export const UpdateIncidentRequestSchema = z
  .object({
    severity: z.enum(INCIDENT_SEVERITIES).optional(),
    personalDataInvolved: z.boolean().optional(),
    affectedTenants: z.array(z.string()).optional(),
    notifications: IncidentNotificationsSchema.optional(),
    status: z.enum(INCIDENT_STATUSES).optional(),
    postMortemRef: z.string().max(512).nullable().optional(),
  })
  .refine(
    (data) =>
      data.severity !== undefined ||
      data.personalDataInvolved !== undefined ||
      data.affectedTenants !== undefined ||
      data.notifications !== undefined ||
      data.status !== undefined ||
      data.postMortemRef !== undefined,
    { message: 'At least one field must be provided for update' },
  );
export type UpdateIncidentRequest = z.infer<typeof UpdateIncidentRequestSchema>;

export const IncidentListQuerySchema = CursorQuery.extend({
  status: z.enum(INCIDENT_STATUSES).optional(),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  type: z.enum(INCIDENT_TYPES).optional(),
});
export type IncidentListQuery = z.infer<typeof IncidentListQuerySchema>;

export const IncidentListResponseSchema = listResponse(IncidentRecordSchema);
export type IncidentListResponse = z.infer<typeof IncidentListResponseSchema>;
