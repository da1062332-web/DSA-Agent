// packages/contracts/src/events.ts — owner: Dev 1 — frozen at Gate 1 (Contracts §10)
// Outbox events are written in the MVP and relayed later (TASK-403). `data` holds IDs and non-sensitive fields only.
import { z } from 'zod';

export const DOMAIN_EVENT_TYPES = [
  'lead.created',
  'lead.assigned',
  'lead.duplicate_flagged',
  'lead.state_changed',
  'lead.converted',
  'consent.granted',
  'consent.withdrawn',
  'task.created',
  'task.completed',
  'application.created',
  'application.state_changed',
  'checklist.changed',
  'lender_case.submitted',
  'lender_case.state_changed',
  'data.shared',
  'rule_set.published',
  'rule_set.suspended',
] as const;
export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export const DomainEventEnvelope = z.object({
  id: z.string(),
  type: z.enum(DOMAIN_EVENT_TYPES),
  version: z.number().int().positive(),
  tenantId: z.string(),
  occurredAt: z.string(),
  correlationId: z.string(),
  causationId: z.string().nullable(),
  // Loop prevention: 0–3, enforced by a CHECK constraint. Events emitted inside a request use chainDepth 0.
  chainDepth: z.number().int().min(0).max(3),
  subject: z.object({ type: z.string(), id: z.string() }),
  data: z.record(z.unknown()),
});
export type DomainEventEnvelope = z.infer<typeof DomainEventEnvelope>;
