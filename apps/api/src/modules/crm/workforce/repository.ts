// apps/api/src/modules/crm/workforce/repository.ts — Module 26: Workforce persistence
import { AppError, type Tx } from '@dsa/contracts';
import { sql } from 'kysely';
import type { AttendanceRecord } from './types';

export interface WorkforceRepository {
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
  public attendance: Map<string, AttendanceRecord> = new Map();

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
