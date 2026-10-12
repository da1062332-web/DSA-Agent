// packages/contracts/src/ports/task-port.ts — owner (v1.2): Dev 6 — frozen at Gate 1 (Contracts §4.3)
// Consumers: Dev 5 (first-contact task), Dev 4 (lender-query task).
// Fake: fakes/fake-task.ts — TODO(Dev 6, Gate 1) per Contracts §4.5.
import type { Iso8601, RequestContext, Tx } from '../kernel';
import type { SlaClass } from './decision-keys';

export interface CreateTaskCommand {
  type: 'FOLLOW_UP' | 'CALL' | 'MEETING' | 'DOCUMENT_COLLECTION' | 'LENDER_QUERY' | 'REVIEW' | 'GENERAL';
  title: string; // 3–200 chars; never contains mobile/email/PAN values
  owner: { userId: string } | { queueId: string };
  linked: { type: 'LEAD' | 'LOAN_APPLICATION' | 'LENDER_CASE'; id: string; branchId: string };
  priority?: 'HIGH' | 'MEDIUM' | 'LOW'; // default MEDIUM
  slaClass?: SlaClass; // if present → dueAt = evaluationTime + DK-sla.target minutes (calendar ALWAYS)
  dueAt?: Iso8601; // required when slaClass is absent
  idempotencyKey: string; // unique per tenant, e.g. 'lead_01J…:first-contact'
}

export interface CreatedTask {
  taskId: string;
  dueAt: Iso8601;
  slaDecisionRecordId: string | null;
  replayed: boolean;
}

export interface TaskPort {
  /** Inside caller tx. Validates owner (ACTIVE user or active queue whose record_types include TASK). Emits task.created + audit. */
  createTask(tx: Tx, ctx: RequestContext, cmd: CreateTaskCommand): Promise<CreatedTask>;
}
