// apps/api/src/modules/crm/workforce/service.ts — Module 26: Workforce Service
import { AppError, type RequestContext, type Tx } from '@dsa/contracts';
import type { WorkforceRepository } from './repository';
import type {
  AgentWorkforceSummary,
  AttendanceRecord,
  AvailabilityStatus,
  CreateDelegationInput,
  DelegationRecord,
} from './types';

function parseLockVersion(ifMatch: string): number {
  const match = ifMatch.replace(/^W\//, '').match(/^"?(\d+)"?$/);
  if (!match || !match[1]) {
    throw AppError.of('MALFORMED_REQUEST', 'Invalid If-Match header format');
  }
  return parseInt(match[1], 10);
}

export interface WorkforceServiceDeps {
  repository: WorkforceRepository;
}

export class WorkforceService {
  constructor(private readonly deps: WorkforceServiceDeps) {}

  /**
   * API-USR-009: Self availability update (PATCH /v1/me/availability)
   */
  async updateMyAvailability(
    tx: Tx,
    ctx: RequestContext,
    ifMatch: string | undefined,
    availability: AvailabilityStatus,
  ): Promise<{ user: any; etag: string }> {
    const tenantId = ctx.principal.tenantId;
    const userId = ctx.principal.id;

    const user = await this.deps.repository.findUserById(tx, tenantId, userId);
    if (!user) {
      throw AppError.of('NOT_FOUND', 'User record not found.');
    }

    const expectedVersion = ifMatch ? parseLockVersion(ifMatch) : user.lock_version;
    const updated = await this.deps.repository.updateUserAvailability(
      tx,
      tenantId,
      userId,
      availability,
      expectedVersion,
      userId,
    );

    return {
      user: {
        id: updated.id,
        email: updated.email,
        displayName: updated.display_name,
        availability: updated.availability,
        capacity: updated.capacity ?? 10,
        lockVersion: updated.lock_version,
      },
      etag: `"${updated.lock_version}"`,
    };
  }

  /**
   * Manager updates capacity limit for an agent
   */
  async updateAgentCapacity(
    tx: Tx,
    ctx: RequestContext,
    targetUserId: string,
    capacity: number,
  ): Promise<{ user: any; etag: string }> {
    const tenantId = ctx.principal.tenantId;
    const isSelf = ctx.principal.id === targetUserId;
    const hasManage = ctx.principal.grants?.some(
      (g) => g.code === 'user.manage' || g.code === 'config.manage',
    );

    if (!isSelf && !hasManage) {
      throw AppError.of('FORBIDDEN', 'Permission denied: user.manage required to modify agent capacity.');
    }

    const updated = await this.deps.repository.updateUserCapacity(
      tx,
      tenantId,
      targetUserId,
      capacity,
      ctx.principal.id,
    );

    return {
      user: {
        id: updated.id,
        displayName: updated.display_name,
        capacity: updated.capacity ?? capacity,
        lockVersion: updated.lock_version,
      },
      etag: `"${updated.lock_version}"`,
    };
  }

  /**
   * Lists agents with availability, capacity, and active workload
   */
  async listWorkforceAgents(
    tx: Tx,
    ctx: RequestContext,
    branchId?: string,
  ): Promise<AgentWorkforceSummary[]> {
    const tenantId = ctx.principal.tenantId;
    return this.deps.repository.listWorkforceAgents(tx, tenantId, branchId);
  }

  /**
   * API-WRK-001: Start coverage delegation
   */
  async createDelegation(
    tx: Tx,
    ctx: RequestContext,
    input: CreateDelegationInput,
  ): Promise<DelegationRecord> {
    const tenantId = ctx.principal.tenantId;
    const isSelfDelegating = ctx.principal.id === input.delegatorId;
    const hasManage = ctx.principal.grants?.some(
      (g) => g.code === 'user.manage' || g.code === 'config.manage',
    );

    if (!isSelfDelegating && !hasManage) {
      throw AppError.of('FORBIDDEN', 'Permission denied: user.manage required to delegate for another user.');
    }

    // Verify both users exist in the same tenant
    const delegator = await this.deps.repository.findUserById(tx, tenantId, input.delegatorId);
    if (!delegator) {
      throw AppError.of('VALIDATION_ERROR', `Delegator ${input.delegatorId} does not exist.`);
    }

    const delegate = await this.deps.repository.findUserById(tx, tenantId, input.delegateId);
    if (!delegate) {
      throw AppError.of('VALIDATION_ERROR', `Delegate ${input.delegateId} does not exist.`);
    }

    // Check for overlapping active delegation for this delegator
    const overlap = await this.deps.repository.findOverlappingDelegation(
      tx,
      tenantId,
      input.delegatorId,
      input.startsAt,
      input.endsAt,
    );
    if (overlap) {
      throw AppError.of(
        'EFFECTIVE_OVERLAP',
        `Delegator already has an active delegation from ${overlap.startsAt} to ${overlap.endsAt}.`,
      );
    }

    const now = new Date().toISOString();
    const record: DelegationRecord = {
      id: 'dlg_' + Math.random().toString(36).substring(2, 12),
      tenantId,
      delegatorId: input.delegatorId,
      delegateId: input.delegateId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      reason: input.reason ?? null,
      status: 'ACTIVE',
      lockVersion: 0,
      createdAt: now,
      createdBy: ctx.principal.id,
      updatedAt: now,
      updatedBy: ctx.principal.id,
      delegatorName: delegator.display_name,
      delegateName: delegate.display_name,
    };

    await this.deps.repository.createDelegation(tx, record);
    return record;
  }

  /**
   * API-WRK-002: End coverage delegation
   */
  async endDelegation(tx: Tx, ctx: RequestContext, delegationId: string): Promise<DelegationRecord> {
    const tenantId = ctx.principal.tenantId;
    const delegation = await this.deps.repository.getDelegationById(tx, tenantId, delegationId);
    if (!delegation) {
      throw AppError.of('NOT_FOUND', 'Delegation record not found.');
    }

    const isDelegator = ctx.principal.id === delegation.delegatorId;
    const hasManage = ctx.principal.grants?.some(
      (g) => g.code === 'user.manage' || g.code === 'config.manage',
    );

    if (!isDelegator && !hasManage) {
      throw AppError.of('FORBIDDEN', 'Permission denied: user.manage required to end delegation.');
    }

    return this.deps.repository.endDelegation(tx, tenantId, delegationId, ctx.principal.id);
  }

  /**
   * Lists delegations
   */
  async listDelegations(
    tx: Tx,
    ctx: RequestContext,
    filter?: { delegatorId?: string; delegateId?: string; status?: string },
  ): Promise<DelegationRecord[]> {
    const tenantId = ctx.principal.tenantId;
    return this.deps.repository.listDelegations(tx, tenantId, filter);
  }

  /**
   * Attendance check-in
   */
  async checkIn(tx: Tx, ctx: RequestContext, notes?: string): Promise<AttendanceRecord> {
    const tenantId = ctx.principal.tenantId;
    const userId = ctx.principal.id;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);

    const existing = await this.deps.repository.getAttendanceRecord(tx, tenantId, userId, dateStr);
    if (existing && existing.checkIn) {
      return existing; // Idempotent check-in
    }

    const nowIso = now.toISOString();
    const record: AttendanceRecord = {
      id: 'att_' + Math.random().toString(36).substring(2, 12),
      tenantId,
      userId,
      date: dateStr,
      checkIn: nowIso,
      checkOut: null,
      status: 'PRESENT',
      notes: notes ?? null,
      correctionOf: null,
      approvedBy: null,
      lockVersion: 0,
      createdAt: nowIso,
      createdBy: userId,
      updatedAt: nowIso,
      updatedBy: userId,
    };

    await this.deps.repository.insertAttendanceRecord(tx, record);
    return record;
  }

  /**
   * Attendance check-out
   */
  async checkOut(tx: Tx, ctx: RequestContext, notes?: string): Promise<AttendanceRecord> {
    const tenantId = ctx.principal.tenantId;
    const userId = ctx.principal.id;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);

    const existing = await this.deps.repository.getAttendanceRecord(tx, tenantId, userId, dateStr);
    if (!existing || !existing.checkIn) {
      throw AppError.of('INVALID_STATE', 'Must check in before checking out.');
    }
    if (existing.checkOut) {
      return existing; // Idempotent check-out
    }

    return this.deps.repository.updateAttendanceCheckOut(
      tx,
      tenantId,
      existing.id,
      now.toISOString(),
      notes,
      userId,
    );
  }

  /**
   * Gets today's attendance for current user
   */
  async getMyTodayAttendance(tx: Tx, ctx: RequestContext): Promise<AttendanceRecord | null> {
    const tenantId = ctx.principal.tenantId;
    const userId = ctx.principal.id;
    const dateStr = new Date().toISOString().slice(0, 10);
    return this.deps.repository.getAttendanceRecord(tx, tenantId, userId, dateStr);
  }

  /**
   * Lists attendance records
   */
  async listAttendance(
    tx: Tx,
    ctx: RequestContext,
    filter?: { userId?: string; date?: string; fromDate?: string; toDate?: string },
  ): Promise<AttendanceRecord[]> {
    const tenantId = ctx.principal.tenantId;
    const hasManage = ctx.principal.grants?.some(
      (g) => g.code === 'attendance.manage' || g.code === 'user.manage' || g.code === 'config.manage',
    );

    // If user lacks attendance.manage, constrain query to their own records
    const effectiveFilter = hasManage ? filter : { ...filter, userId: ctx.principal.id };

    return this.deps.repository.listAttendanceRecords(tx, tenantId, effectiveFilter);
  }
}
