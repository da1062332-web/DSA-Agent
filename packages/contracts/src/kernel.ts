// packages/contracts/src/kernel.ts — owner: Dev 1 — frozen at Gate 1 (Contracts §4.1)
import type { Transaction } from 'kysely';
import type { Database } from './db';
import { ERROR_HTTP_STATUS, RETRYABLE_ERROR_CODES, type ErrorCode, type ErrorDetail } from './errors';
import type { IdPrefix } from './ids';
import type { PermissionCode } from './permissions';

export type { Money } from './money';

export type Iso8601 = string; // UTC, "2026-10-12T05:31:02Z"
export type ScopeType = 'OWN' | 'TEAM' | 'BRANCH' | 'TENANT';
export type RecordType = 'LEAD' | 'CUSTOMER' | 'LOAN_APPLICATION' | 'LENDER_CASE' | 'TASK';

export interface PermissionGrant {
  code: PermissionCode;
  scope: ScopeType;
  branchIds: string[]; // only for BRANCH
}

export interface Principal {
  kind: 'USER' | 'SERVICE';
  id: string; // usr_… or 'SYSTEM:<module>'
  tenantId: string; // ten_… (from token claim tid; never from path/body)
  primaryBranchId: string | null;
  managedTeamMemberIds: string[]; // users in teams this principal manages (TEAM scope)
  queueIds: string[]; // queues where principal is an active member
  grants: PermissionGrant[];
  authTime: Iso8601 | null; // token auth_time; drives step-up
}

export interface RequestContext {
  principal: Principal;
  correlationId: string; // X-Correlation-Id or generated (ULID)
  now: Date; // captured once per request; pass to BRE as evaluationTime
  ip?: string;
  userAgent?: string;
}

export type Tx = Transaction<Database>; // already bound to the tenant

export interface TxRunner {
  /** BEGIN; SET LOCAL app.tenant_id = ctx.principal.tenantId; fn(tx); COMMIT.
   *  Throws AppError TENANT_CONTEXT_MISSING (500) when tenantId is empty. Rolls back on any throw. */
  withTenantTx<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export interface ScopedRecordRef {
  recordType: RecordType;
  branchId: string;
  ownerUserIds: string[];
  queueIds: string[];
}

export interface ScopeResolver {
  recordType: RecordType;
  resolve(tx: Tx, id: string): Promise<ScopedRecordRef | null>;
}

export interface Authz {
  requirePermission(ctx: RequestContext, code: PermissionCode): void; // 403 FORBIDDEN
  /** 404 if outside scope (or null), 403 if visible but code missing. */
  requireOnRecord(ctx: RequestContext, code: PermissionCode, rec: ScopedRecordRef | null): void;
  /** Adds the WHERE predicate for list queries. */
  scopeFilter<QB>(
    ctx: RequestContext,
    code: PermissionCode,
    qb: QB,
    cols: { owners: string[]; queue?: string; branch: string },
  ): QB;
  requireStepUp(ctx: RequestContext, maxAgeSeconds?: number): void; // default 900 s → 401 STEP_UP_REQUIRED
}

export interface AuditEventInput {
  action: string; // Doc 12 §5.2 code, e.g. 'lead.created'
  entityType: string;
  entityId: string | null;
  before?: Record<string, unknown>; // masked S2; never raw mobile/email
  after?: Record<string, unknown>;
  reason?: string;
  permissionUsed?: string;
  approvalRef?: string;
  decisionRecordId?: string;
  externalSideEffect?: boolean;
}

export interface AuditPort {
  record(tx: Tx, ctx: RequestContext, e: AuditEventInput): Promise<string>; // returns aud_…
}

export interface DomainEventInput {
  type: string;
  subject: { type: string; id: string };
  data: Record<string, unknown>;
  causationId?: string;
}

export interface OutboxPort {
  emit(tx: Tx, ctx: RequestContext, e: DomainEventInput): Promise<string>; // returns evt_…
}

export interface IdGenerator {
  next(prefix: IdPrefix): string; // `${prefix}_${ulid()}`
}

/** Listed in TASK-001 §4; not in Contracts §4.1. Lets tests pin the time used for RequestContext.now. */
export interface Clock {
  now(): Date;
}

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly httpStatus: number,
    message: string,
    readonly details: { field?: string; issue: string; meta?: Record<string, unknown> }[] = [],
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'AppError';
  }

  /** Convenience: HTTP status and retryable flag come from the Contracts §6 catalogue. */
  static of(code: ErrorCode, message: string, details: ErrorDetail[] = []): AppError {
    return new AppError(code, ERROR_HTTP_STATUS[code], message, details, RETRYABLE_ERROR_CODES.has(code));
  }
}
