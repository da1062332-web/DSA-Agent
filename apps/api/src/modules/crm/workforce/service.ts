// apps/api/src/modules/crm/workforce/service.ts — Module 26: Workforce Service
import { AppError, type RequestContext, type Tx } from '@dsa/contracts';
import type { WorkforceRepository } from './repository';
import type { AttendanceRecord } from './types';

export interface WorkforceServiceDeps {
  repository: WorkforceRepository;
}

export class WorkforceService {
  constructor(private readonly deps: WorkforceServiceDeps) {}

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
