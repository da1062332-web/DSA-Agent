// apps/api/src/modules/crm/workforce/repository.ts — Module 26: Workforce persistence
import { AppError, type Tx } from '@dsa/contracts';
import { sql } from 'kysely';
import type { AgentWorkforceSummary, AttendanceRecord, DelegationRecord } from './types';

export interface WorkforceUserRow {
  id: string;
  tenant_id: string;
  email: string;
  display_name: string;
  status: string;
  availability: string;
  capacity?: number;
  primary_branch_id: string;
  lock_version: number;
}

export interface WorkforceRepository {
  findUserById(tx: Tx, tenantId: string, userId: string): Promise<WorkforceUserRow | null>;
  updateUserAvailability(
    tx: Tx,
    tenantId: string,
    userId: string,
    availability: string,
    expectedLockVersion: number,
    updatedBy: string,
  ): Promise<WorkforceUserRow>;
  updateUserCapacity(
    tx: Tx,
    tenantId: string,
    userId: string,
    capacity: number,
    updatedBy: string,
  ): Promise<WorkforceUserRow>;
  listWorkforceAgents(tx: Tx, tenantId: string, branchId?: string): Promise<AgentWorkforceSummary[]>;
  findOverlappingDelegation(
    tx: Tx,
    tenantId: string,
    delegatorId: string,
    startsAt: string,
    endsAt: string,
    excludeId?: string,
  ): Promise<DelegationRecord | null>;
  createDelegation(tx: Tx, row: DelegationRecord): Promise<void>;
  getDelegationById(tx: Tx, tenantId: string, id: string): Promise<DelegationRecord | null>;
  endDelegation(tx: Tx, tenantId: string, id: string, updatedBy: string): Promise<DelegationRecord>;
  listDelegations(
    tx: Tx,
    tenantId: string,
    filter?: { delegatorId?: string; delegateId?: string; status?: string },
  ): Promise<DelegationRecord[]>;
  findActiveDelegationForUser(
    tx: Tx,
    tenantId: string,
    delegatorId: string,
    nowIso?: string,
  ): Promise<DelegationRecord | null>;
  getAttendanceRecord(
    tx: Tx,
    tenantId: string,
    userId: string,
    dateStr: string,
  ): Promise<AttendanceRecord | null>;
  insertAttendanceRecord(tx: Tx, record: AttendanceRecord): Promise<void>;
  updateAttendanceCheckOut(
    tx: Tx,
    tenantId: string,
    id: string,
    checkOutTime: string,
    notes?: string,
    updatedBy?: string,
  ): Promise<AttendanceRecord>;
  listAttendanceRecords(
    tx: Tx,
    tenantId: string,
    filter?: { userId?: string; date?: string; fromDate?: string; toDate?: string },
  ): Promise<AttendanceRecord[]>;
}

export class SqlWorkforceRepository implements WorkforceRepository {
  async findUserById(tx: Tx, tenantId: string, userId: string): Promise<WorkforceUserRow | null> {
    const res = await sql<WorkforceUserRow>`
      SELECT id, tenant_id, email, display_name, status, availability, COALESCE(capacity, 10) as capacity, primary_branch_id, lock_version
      FROM app_user
      WHERE tenant_id = ${tenantId} AND id = ${userId}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async updateUserAvailability(
    tx: Tx,
    tenantId: string,
    userId: string,
    availability: string,
    expectedLockVersion: number,
    updatedBy: string,
  ): Promise<WorkforceUserRow> {
    const res = await sql<WorkforceUserRow>`
      UPDATE app_user
      SET availability = ${availability},
          lock_version = lock_version + 1,
          updated_at = now(),
          updated_by = ${updatedBy}
      WHERE tenant_id = ${tenantId} AND id = ${userId} AND lock_version = ${expectedLockVersion}
      RETURNING id, tenant_id, email, display_name, status, availability, COALESCE(capacity, 10) as capacity, primary_branch_id, lock_version
    `.execute(tx);

    if (res.rows.length === 0) {
      throw AppError.of('VERSION_CONFLICT', 'User has been modified concurrently (ETag mismatch).');
    }
    return res.rows[0]!;
  }

  async updateUserCapacity(
    tx: Tx,
    tenantId: string,
    userId: string,
    capacity: number,
    updatedBy: string,
  ): Promise<WorkforceUserRow> {
    const res = await sql<WorkforceUserRow>`
      UPDATE app_user
      SET capacity = ${capacity},
          lock_version = lock_version + 1,
          updated_at = now(),
          updated_by = ${updatedBy}
      WHERE tenant_id = ${tenantId} AND id = ${userId}
      RETURNING id, tenant_id, email, display_name, status, availability, COALESCE(capacity, 10) as capacity, primary_branch_id, lock_version
    `.execute(tx);

    if (res.rows.length === 0) {
      throw AppError.of('NOT_FOUND', 'User not found');
    }
    return res.rows[0]!;
  }

  async listWorkforceAgents(tx: Tx, tenantId: string, branchId?: string): Promise<AgentWorkforceSummary[]> {
    interface AgentRow {
      id: string;
      display_name: string;
      email: string;
      primary_branch_id: string;
      availability: string;
      capacity: number;
      active_lead_count: string | number;
      active_delegation_id?: string | null;
      active_delegate_id?: string | null;
      active_delegate_name?: string | null;
      active_delegation_ends_at?: string | Date | null;
    }

    const branchClause = branchId ? sql`AND u.primary_branch_id = ${branchId}` : sql``;

    const res = await sql<AgentRow>`
      SELECT 
        u.id, 
        u.display_name, 
        u.email, 
        u.primary_branch_id, 
        u.availability, 
        COALESCE(u.capacity, 10) as capacity,
        (
          SELECT count(*) 
          FROM lead l 
          WHERE l.tenant_id = u.tenant_id 
            AND l.owner_user_id = u.id 
            AND l.state NOT IN ('CONVERTED', 'DISQUALIFIED', 'ARCHIVED')
        ) as active_lead_count,
        d.id as active_delegation_id,
        d.delegate_id as active_delegate_id,
        du.display_name as active_delegate_name,
        d.ends_at as active_delegation_ends_at
      FROM app_user u
      LEFT JOIN delegation d ON d.tenant_id = u.tenant_id 
        AND d.delegator_id = u.id 
        AND d.status = 'ACTIVE' 
        AND now() >= d.starts_at 
        AND now() <= d.ends_at
      LEFT JOIN app_user du ON du.tenant_id = d.tenant_id AND du.id = d.delegate_id
      WHERE u.tenant_id = ${tenantId} AND u.status = 'ACTIVE'
      ${branchClause}
      ORDER BY u.display_name ASC
    `.execute(tx);

    return res.rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      email: r.email,
      primaryBranchId: r.primary_branch_id,
      availability: r.availability as any,
      capacity: Number(r.capacity),
      activeLeadCount: Number(r.active_lead_count),
      activeApplicationCount: 0,
      activeDelegation: r.active_delegation_id
        ? {
            id: r.active_delegation_id,
            delegateId: r.active_delegate_id!,
            delegateName: r.active_delegate_name ?? 'Delegate',
            endsAt: new Date(r.active_delegation_ends_at!).toISOString(),
          }
        : null,
    }));
  }

  async findOverlappingDelegation(
    tx: Tx,
    tenantId: string,
    delegatorId: string,
    startsAt: string,
    endsAt: string,
    excludeId?: string,
  ): Promise<DelegationRecord | null> {
    const excludeClause = excludeId ? sql`AND id <> ${excludeId}` : sql``;

    const res = await sql<any>`
      SELECT * FROM delegation
      WHERE tenant_id = ${tenantId}
        AND delegator_id = ${delegatorId}
        AND status = 'ACTIVE'
        AND starts_at < ${endsAt}
        AND ends_at > ${startsAt}
        ${excludeClause}
      LIMIT 1
    `.execute(tx);

    if (res.rows.length === 0) return null;
    return this.mapDelegationRow(res.rows[0]);
  }

  async createDelegation(tx: Tx, row: DelegationRecord): Promise<void> {
    await sql`
      INSERT INTO delegation (
        id, tenant_id, delegator_id, delegate_id, starts_at, ends_at,
        reason, status, lock_version, created_at, created_by, updated_at, updated_by
      ) VALUES (
        ${row.id}, ${row.tenantId}, ${row.delegatorId}, ${row.delegateId}, ${row.startsAt}, ${row.endsAt},
        ${row.reason}, ${row.status}, ${row.lockVersion}, ${row.createdAt}, ${row.createdBy}, ${row.updatedAt}, ${row.updatedBy}
      )
    `.execute(tx);
  }

  async getDelegationById(tx: Tx, tenantId: string, id: string): Promise<DelegationRecord | null> {
    const res = await sql<any>`
      SELECT d.*, 
             u1.display_name as delegator_name, 
             u2.display_name as delegate_name
      FROM delegation d
      LEFT JOIN app_user u1 ON u1.tenant_id = d.tenant_id AND u1.id = d.delegator_id
      LEFT JOIN app_user u2 ON u2.tenant_id = d.tenant_id AND u2.id = d.delegate_id
      WHERE d.tenant_id = ${tenantId} AND d.id = ${id}
    `.execute(tx);

    if (res.rows.length === 0) return null;
    return this.mapDelegationRow(res.rows[0]);
  }

  async endDelegation(tx: Tx, tenantId: string, id: string, updatedBy: string): Promise<DelegationRecord> {
    const res = await sql<any>`
      UPDATE delegation
      SET status = 'ENDED',
          ends_at = LEAST(ends_at, now()),
          lock_version = lock_version + 1,
          updated_at = now(),
          updated_by = ${updatedBy}
      WHERE tenant_id = ${tenantId} AND id = ${id} AND status = 'ACTIVE'
      RETURNING *
    `.execute(tx);

    if (res.rows.length === 0) {
      throw AppError.of('NOT_FOUND', 'Active delegation not found or already ended.');
    }
    return this.mapDelegationRow(res.rows[0]);
  }

  async listDelegations(
    tx: Tx,
    tenantId: string,
    filter?: { delegatorId?: string; delegateId?: string; status?: string },
  ): Promise<DelegationRecord[]> {
    let query = sql<any>`
      SELECT d.*, 
             u1.display_name as delegator_name, 
             u2.display_name as delegate_name
      FROM delegation d
      LEFT JOIN app_user u1 ON u1.tenant_id = d.tenant_id AND u1.id = d.delegator_id
      LEFT JOIN app_user u2 ON u2.tenant_id = d.tenant_id AND u2.id = d.delegate_id
      WHERE d.tenant_id = ${tenantId}
    `;

    if (filter?.delegatorId) {
      query = sql<any>`${query} AND d.delegator_id = ${filter.delegatorId}`;
    }
    if (filter?.delegateId) {
      query = sql<any>`${query} AND d.delegate_id = ${filter.delegateId}`;
    }
    if (filter?.status) {
      query = sql<any>`${query} AND d.status = ${filter.status}`;
    }

    query = sql<any>`${query} ORDER BY d.starts_at DESC LIMIT 100`;
    const res = await query.execute(tx);
    return res.rows.map((r) => this.mapDelegationRow(r));
  }

  async findActiveDelegationForUser(
    tx: Tx,
    tenantId: string,
    delegatorId: string,
    nowIso?: string,
  ): Promise<DelegationRecord | null> {
    const checkTime = nowIso ? new Date(nowIso) : new Date();
    const res = await sql<any>`
      SELECT d.*, 
             u1.display_name as delegator_name, 
             u2.display_name as delegate_name
      FROM delegation d
      LEFT JOIN app_user u1 ON u1.tenant_id = d.tenant_id AND u1.id = d.delegator_id
      LEFT JOIN app_user u2 ON u2.tenant_id = d.tenant_id AND u2.id = d.delegate_id
      WHERE d.tenant_id = ${tenantId}
        AND d.delegator_id = ${delegatorId}
        AND d.status = 'ACTIVE'
        AND ${checkTime} >= d.starts_at
        AND ${checkTime} <= d.ends_at
      LIMIT 1
    `.execute(tx);

    if (res.rows.length === 0) return null;
    return this.mapDelegationRow(res.rows[0]);
  }

  async getAttendanceRecord(
    tx: Tx,
    tenantId: string,
    userId: string,
    dateStr: string,
  ): Promise<AttendanceRecord | null> {
    const res = await sql<any>`
      SELECT a.*, u.display_name as user_name
      FROM attendance_record a
      LEFT JOIN app_user u ON u.tenant_id = a.tenant_id AND u.id = a.user_id
      WHERE a.tenant_id = ${tenantId} AND a.user_id = ${userId} AND a.date = ${dateStr}::date
    `.execute(tx);

    if (res.rows.length === 0) return null;
    return this.mapAttendanceRow(res.rows[0]);
  }

  async insertAttendanceRecord(tx: Tx, record: AttendanceRecord): Promise<void> {
    await sql`
      INSERT INTO attendance_record (
        id, tenant_id, user_id, date, check_in, check_out,
        status, notes, correction_of, approved_by,
        lock_version, created_at, created_by, updated_at, updated_by
      ) VALUES (
        ${record.id}, ${record.tenantId}, ${record.userId}, ${record.date}::date, ${record.checkIn}, ${record.checkOut},
        ${record.status}, ${record.notes}, ${record.correctionOf}, ${record.approvedBy},
        ${record.lockVersion}, ${record.createdAt}, ${record.createdBy}, ${record.updatedAt}, ${record.updatedBy}
      )
    `.execute(tx);
  }

  async updateAttendanceCheckOut(
    tx: Tx,
    tenantId: string,
    id: string,
    checkOutTime: string,
    notes?: string,
    updatedBy?: string,
  ): Promise<AttendanceRecord> {
    const res = await sql<any>`
      UPDATE attendance_record
      SET check_out = ${checkOutTime},
          notes = COALESCE(${notes}, notes),
          lock_version = lock_version + 1,
          updated_at = now(),
          updated_by = ${updatedBy ?? 'system'}
      WHERE tenant_id = ${tenantId} AND id = ${id}
      RETURNING *
    `.execute(tx);

    if (res.rows.length === 0) {
      throw AppError.of('NOT_FOUND', 'Attendance record not found.');
    }
    return this.mapAttendanceRow(res.rows[0]);
  }

  async listAttendanceRecords(
    tx: Tx,
    tenantId: string,
    filter?: { userId?: string; date?: string; fromDate?: string; toDate?: string },
  ): Promise<AttendanceRecord[]> {
    let query = sql<any>`
      SELECT a.*, u.display_name as user_name
      FROM attendance_record a
      LEFT JOIN app_user u ON u.tenant_id = a.tenant_id AND u.id = a.user_id
      WHERE a.tenant_id = ${tenantId}
    `;

    if (filter?.userId) {
      query = sql<any>`${query} AND a.user_id = ${filter.userId}`;
    }
    if (filter?.date) {
      query = sql<any>`${query} AND a.date = ${filter.date}::date`;
    }
    if (filter?.fromDate) {
      query = sql<any>`${query} AND a.date >= ${filter.fromDate}::date`;
    }
    if (filter?.toDate) {
      query = sql<any>`${query} AND a.date <= ${filter.toDate}::date`;
    }

    query = sql<any>`${query} ORDER BY a.date DESC, a.check_in DESC LIMIT 100`;
    const res = await query.execute(tx);
    return res.rows.map((r) => this.mapAttendanceRow(r));
  }

  private mapDelegationRow(r: any): DelegationRecord {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      delegatorId: r.delegator_id,
      delegateId: r.delegate_id,
      startsAt: new Date(r.starts_at).toISOString(),
      endsAt: new Date(r.ends_at).toISOString(),
      reason: r.reason ?? null,
      status: r.status,
      lockVersion: Number(r.lock_version ?? 0),
      createdAt: new Date(r.created_at).toISOString(),
      createdBy: r.created_by,
      updatedAt: new Date(r.updated_at).toISOString(),
      updatedBy: r.updated_by,
      delegatorName: r.delegator_name ?? undefined,
      delegateName: r.delegate_name ?? undefined,
    };
  }

  private mapAttendanceRow(r: any): AttendanceRecord {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      userId: r.user_id,
      date: typeof r.date === 'string' ? r.date.slice(0, 10) : new Date(r.date).toISOString().slice(0, 10),
      checkIn: r.check_in ? new Date(r.check_in).toISOString() : null,
      checkOut: r.check_out ? new Date(r.check_out).toISOString() : null,
      status: r.status,
      notes: r.notes ?? null,
      correctionOf: r.correction_of ?? null,
      approvedBy: r.approved_by ?? null,
      lockVersion: Number(r.lock_version ?? 0),
      createdAt: new Date(r.created_at).toISOString(),
      createdBy: r.created_by,
      updatedAt: new Date(r.updated_at).toISOString(),
      updatedBy: r.updated_by,
      userName: r.user_name ?? undefined,
    };
  }
}

export class InMemoryWorkforceRepository implements WorkforceRepository {
  public users: Map<string, WorkforceUserRow> = new Map();
  public delegations: Map<string, DelegationRecord> = new Map();
  public attendance: Map<string, AttendanceRecord> = new Map();

  seedUser(user: WorkforceUserRow): void {
    this.users.set(`${user.tenant_id}:${user.id}`, { ...user });
  }

  async findUserById(_tx: Tx, tenantId: string, userId: string): Promise<WorkforceUserRow | null> {
    const user = this.users.get(`${tenantId}:${userId}`);
    return user ? { ...user } : null;
  }

  async updateUserAvailability(
    _tx: Tx,
    tenantId: string,
    userId: string,
    availability: string,
    expectedLockVersion: number,
    _updatedBy: string,
  ): Promise<WorkforceUserRow> {
    const key = `${tenantId}:${userId}`;
    const user = this.users.get(key);
    if (!user) {
      throw AppError.of('NOT_FOUND', 'User record not found.');
    }
    if (user.lock_version !== expectedLockVersion) {
      throw AppError.of('VERSION_CONFLICT', 'User has been modified by another request.');
    }
    user.availability = availability;
    user.lock_version += 1;
    this.users.set(key, { ...user });
    return { ...user };
  }

  async updateUserCapacity(
    _tx: Tx,
    tenantId: string,
    userId: string,
    capacity: number,
    _updatedBy: string,
  ): Promise<WorkforceUserRow> {
    const key = `${tenantId}:${userId}`;
    const user = this.users.get(key);
    if (!user) {
      throw AppError.of('NOT_FOUND', 'User record not found.');
    }
    user.capacity = capacity;
    user.lock_version += 1;
    this.users.set(key, { ...user });
    return { ...user };
  }

  async listWorkforceAgents(_tx: Tx, tenantId: string, branchId?: string): Promise<AgentWorkforceSummary[]> {
    const results: AgentWorkforceSummary[] = [];
    for (const user of this.users.values()) {
      if (user.tenant_id === tenantId) {
        if (!branchId || user.primary_branch_id === branchId) {
          results.push({
            id: user.id,
            displayName: user.display_name,
            email: user.email,
            availability: user.availability as any,
            capacity: user.capacity ?? 10,
            activeLeadCount: 0,
            activeApplicationCount: 0,
            primaryBranchId: user.primary_branch_id,
            status: user.status,
          });
        }
      }
    }
    return results;
  }

  async findOverlappingDelegation(
    _tx: Tx,
    tenantId: string,
    delegatorId: string,
    startsAt: string,
    endsAt: string,
    excludeId?: string,
  ): Promise<DelegationRecord | null> {
    const startReq = new Date(startsAt).getTime();
    const endReq = new Date(endsAt).getTime();

    for (const d of this.delegations.values()) {
      if (d.tenantId === tenantId && d.delegatorId === delegatorId && d.status === 'ACTIVE') {
        if (excludeId && d.id === excludeId) continue;
        const dStart = new Date(d.startsAt).getTime();
        const dEnd = new Date(d.endsAt).getTime();
        // Overlap: !(endReq <= dStart || startReq >= dEnd)
        if (startReq < dEnd && endReq > dStart) {
          return { ...d };
        }
      }
    }
    return null;
  }

  async createDelegation(_tx: Tx, row: DelegationRecord): Promise<void> {
    this.delegations.set(row.id, { ...row });
  }

  async getDelegationById(_tx: Tx, tenantId: string, id: string): Promise<DelegationRecord | null> {
    const d = this.delegations.get(id);
    if (d && d.tenantId === tenantId) {
      return { ...d };
    }
    return null;
  }

  async endDelegation(_tx: Tx, tenantId: string, id: string, updatedBy: string): Promise<DelegationRecord> {
    const d = this.delegations.get(id);
    if (!d || d.tenantId !== tenantId) {
      throw AppError.of('NOT_FOUND', 'Delegation not found.');
    }
    const updated: DelegationRecord = {
      ...d,
      status: 'ENDED',
      endsAt: new Date().toISOString(),
      lockVersion: d.lockVersion + 1,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };
    this.delegations.set(id, updated);
    return { ...updated };
  }

  async listDelegations(
    _tx: Tx,
    tenantId: string,
    filter?: { delegatorId?: string; delegateId?: string; status?: string },
  ): Promise<DelegationRecord[]> {
    const list: DelegationRecord[] = [];
    for (const d of this.delegations.values()) {
      if (d.tenantId === tenantId) {
        if (filter?.delegatorId && d.delegatorId !== filter.delegatorId) continue;
        if (filter?.delegateId && d.delegateId !== filter.delegateId) continue;
        if (filter?.status && d.status !== filter.status) continue;
        list.push({ ...d });
      }
    }
    return list;
  }

  async findActiveDelegationForUser(
    _tx: Tx,
    tenantId: string,
    delegatorId: string,
    nowIso?: string,
  ): Promise<DelegationRecord | null> {
    const now = nowIso ? new Date(nowIso).getTime() : Date.now();
    for (const d of this.delegations.values()) {
      if (d.tenantId === tenantId && d.delegatorId === delegatorId && d.status === 'ACTIVE') {
        const dStart = new Date(d.startsAt).getTime();
        const dEnd = new Date(d.endsAt).getTime();
        if (now >= dStart && now <= dEnd) {
          return { ...d };
        }
      }
    }
    return null;
  }

  async getAttendanceRecord(
    _tx: Tx,
    tenantId: string,
    userId: string,
    dateStr: string,
  ): Promise<AttendanceRecord | null> {
    const key = `${tenantId}:${userId}:${dateStr}`;
    const rec = this.attendance.get(key);
    return rec ? { ...rec } : null;
  }

  async insertAttendanceRecord(_tx: Tx, record: AttendanceRecord): Promise<void> {
    const key = `${record.tenantId}:${record.userId}:${record.date}`;
    this.attendance.set(key, { ...record });
  }

  async updateAttendanceCheckOut(
    _tx: Tx,
    tenantId: string,
    id: string,
    checkOutTime: string,
    notes?: string,
    updatedBy?: string,
  ): Promise<AttendanceRecord> {
    for (const [key, rec] of this.attendance.entries()) {
      if (rec.id === id && rec.tenantId === tenantId) {
        const updated: AttendanceRecord = {
          ...rec,
          checkOut: checkOutTime,
          notes: notes ?? rec.notes,
          lockVersion: rec.lockVersion + 1,
          updatedAt: checkOutTime,
          updatedBy: updatedBy ?? 'system',
        };
        this.attendance.set(key, updated);
        return { ...updated };
      }
    }
    throw AppError.of('NOT_FOUND', 'Attendance record not found.');
  }

  async listAttendanceRecords(
    _tx: Tx,
    tenantId: string,
    filter?: { userId?: string; date?: string; fromDate?: string; toDate?: string },
  ): Promise<AttendanceRecord[]> {
    const list: AttendanceRecord[] = [];
    for (const rec of this.attendance.values()) {
      if (rec.tenantId === tenantId) {
        if (filter?.userId && rec.userId !== filter.userId) continue;
        if (filter?.date && rec.date !== filter.date) continue;
        if (filter?.fromDate && rec.date < filter.fromDate) continue;
        if (filter?.toDate && rec.date > filter.toDate) continue;
        list.push({ ...rec });
      }
    }
    return list;
  }
}
