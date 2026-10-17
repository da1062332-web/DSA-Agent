// apps/api/src/modules/crm/targets/repository.ts — owner: Dev 5 (ENT-037 persistence)
import { AppError, type Tx } from '@dsa/contracts';
import { sql } from 'kysely';
import type { DimensionType, MetricCode, TargetStatus } from '@dsa/contracts';
import type { TargetRow, TargetSlice } from './types';

export interface TargetListParams {
  tenantId: string;
  period?: string;
  dimensionType?: DimensionType;
  dimensionId?: string;
  metricCode?: MetricCode;
  status?: TargetStatus;
  limit: number;
  cursor?: string;
  isTenantWide: boolean;
  allowedBranchIds: string[];
  allowedOwnUserId: string | null;
}

export interface TargetRepository {
  findTargetById(tx: Tx, tenantId: string, id: string): Promise<TargetRow | null>;
  findApprovedSlice(tx: Tx, tenantId: string, slice: TargetSlice): Promise<TargetRow | null>;
  findPendingSlice(tx: Tx, tenantId: string, slice: TargetSlice): Promise<TargetRow | null>;
  getMaxVersion(tx: Tx, tenantId: string, slice: TargetSlice): Promise<number>;
  insertTarget(tx: Tx, row: TargetRow): Promise<void>;
  updateTarget(
    tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<TargetRow>,
  ): Promise<TargetRow>;
  supersedeSlice(tx: Tx, tenantId: string, slice: TargetSlice, excludeId: string): Promise<void>;
  listTargets(tx: Tx, params: TargetListParams): Promise<{ targets: TargetRow[]; nextCursor: string | null }>;
  getSliceHistory(tx: Tx, tenantId: string, slice: TargetSlice): Promise<TargetRow[]>;
  checkBranchExists(tx: Tx, tenantId: string, branchId: string): Promise<boolean>;
  getUserPrimaryBranch(tx: Tx, tenantId: string, userId: string): Promise<string | null>;
  checkProductExists(tx: Tx, tenantId: string, productId: string): Promise<boolean>;
  withIdempotencyInMemory?<T>(
    tenantId: string,
    key: string,
    input: unknown,
    run: () => Promise<{ status: number; body: T; resourceRef?: string }>,
  ): Promise<{ status: number; body: T; replayed?: boolean }>;
}

export class SqlTargetRepository implements TargetRepository {
  async findTargetById(tx: Tx, tenantId: string, id: string): Promise<TargetRow | null> {
    const res = await sql<TargetRow>`
      SELECT * FROM target
      WHERE tenant_id = ${tenantId} AND id = ${id}
      LIMIT 1
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async findApprovedSlice(tx: Tx, tenantId: string, slice: TargetSlice): Promise<TargetRow | null> {
    const res = await sql<TargetRow>`
      SELECT * FROM target
      WHERE tenant_id = ${tenantId}
        AND period = ${slice.period}
        AND dimension_type = ${slice.dimensionType}
        AND dimension_id = ${slice.dimensionId}
        AND metric_code = ${slice.metricCode}
        AND status = 'APPROVED'
      LIMIT 1
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async findPendingSlice(tx: Tx, tenantId: string, slice: TargetSlice): Promise<TargetRow | null> {
    const res = await sql<TargetRow>`
      SELECT * FROM target
      WHERE tenant_id = ${tenantId}
        AND period = ${slice.period}
        AND dimension_type = ${slice.dimensionType}
        AND dimension_id = ${slice.dimensionId}
        AND metric_code = ${slice.metricCode}
        AND status = 'PENDING_APPROVAL'
      LIMIT 1
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async getMaxVersion(tx: Tx, tenantId: string, slice: TargetSlice): Promise<number> {
    const res = await sql<{ max_version: number | null }>`
      SELECT COALESCE(MAX(version), 0) as max_version FROM target
      WHERE tenant_id = ${tenantId}
        AND period = ${slice.period}
        AND dimension_type = ${slice.dimensionType}
        AND dimension_id = ${slice.dimensionId}
        AND metric_code = ${slice.metricCode}
    `.execute(tx);
    return Number(res.rows[0]?.max_version ?? 0);
  }

  async insertTarget(tx: Tx, row: TargetRow): Promise<void> {
    await sql`
      INSERT INTO target (
        id, tenant_id, period, dimension_type, dimension_id, metric_code,
        target_value, unit, version, status, lock_version,
        created_by, created_at, updated_by, updated_at,
        approved_by, approved_at, rejection_reason
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.period}, ${row.dimension_type}, ${row.dimension_id}, ${row.metric_code},
        ${row.target_value}, ${row.unit}, ${row.version}, ${row.status}, ${row.lock_version},
        ${row.created_by}, ${row.created_at}, ${row.updated_by}, ${row.updated_at},
        ${row.approved_by}, ${row.approved_at}, ${row.rejection_reason}
      )
    `.execute(tx);
  }

  async updateTarget(
    tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<TargetRow>,
  ): Promise<TargetRow> {
    const sets: ReturnType<typeof sql>[] = [];

    if (updates.status !== undefined) sets.push(sql`status = ${updates.status}`);
    if (updates.approved_by !== undefined) sets.push(sql`approved_by = ${updates.approved_by}`);
    if (updates.approved_at !== undefined) sets.push(sql`approved_at = ${updates.approved_at}`);
    if (updates.rejection_reason !== undefined)
      sets.push(sql`rejection_reason = ${updates.rejection_reason}`);
    if (updates.updated_by !== undefined) sets.push(sql`updated_by = ${updates.updated_by}`);
    sets.push(sql`lock_version = lock_version + 1`);

    const res = await sql<TargetRow>`
      UPDATE target
      SET ${sql.join(sets, sql`, `)}
      WHERE tenant_id = ${tenantId} AND id = ${id} AND lock_version = ${expectedLockVersion}
      RETURNING *
    `.execute(tx);

    const updated = res.rows[0];
    if (!updated) {
      throw AppError.of(
        'VERSION_CONFLICT',
        'Target modified concurrently or version mismatch (If-Match ETag check failed)',
      );
    }
    return updated;
  }

  async supersedeSlice(tx: Tx, tenantId: string, slice: TargetSlice, excludeId: string): Promise<void> {
    await sql`
      UPDATE target
      SET status = 'SUPERSEDED',
          lock_version = lock_version + 1
      WHERE tenant_id = ${tenantId}
        AND period = ${slice.period}
        AND dimension_type = ${slice.dimensionType}
        AND dimension_id = ${slice.dimensionId}
        AND metric_code = ${slice.metricCode}
        AND status = 'APPROVED'
        AND id <> ${excludeId}
    `.execute(tx);
  }

  async listTargets(
    tx: Tx,
    params: TargetListParams,
  ): Promise<{ targets: TargetRow[]; nextCursor: string | null }> {
    const limit = params.limit;
    const fetchLimit = limit + 1;

    let cursorPeriod: string | null = null;
    let cursorId: string | null = null;

    if (params.cursor) {
      try {
        const decoded = Buffer.from(params.cursor, 'base64url').toString('utf8');
        const [p, cid] = decoded.split('|');
        if (p && cid) {
          cursorPeriod = p;
          cursorId = cid;
        } else {
          throw new Error('Invalid cursor');
        }
      } catch {
        throw AppError.of('VALIDATION_ERROR', 'Invalid pagination cursor', [
          { field: 'cursor', issue: 'INVALID_CURSOR' },
        ]);
      }
    }

    const branchScopeCondition = !params.isTenantWide
      ? sql`AND (
          (dimension_type = 'BRANCH' AND dimension_id = ANY(${params.allowedBranchIds}::text[]))
          OR
          (dimension_type = 'USER' AND (
            ${params.allowedOwnUserId ? sql`dimension_id = ${params.allowedOwnUserId}` : sql`false`}
            OR dimension_id IN (
              SELECT id FROM app_user
              WHERE tenant_id = ${params.tenantId}
                AND primary_branch_id = ANY(${params.allowedBranchIds}::text[])
            )
          ))
          OR
          (dimension_type = 'PRODUCT')
        )`
      : sql``;

    const res = await sql<TargetRow>`
      SELECT * FROM target
      WHERE tenant_id = ${params.tenantId}
        ${params.period ? sql`AND period = ${params.period}` : sql``}
        ${params.dimensionType ? sql`AND dimension_type = ${params.dimensionType}` : sql``}
        ${params.dimensionId ? sql`AND dimension_id = ${params.dimensionId}` : sql``}
        ${params.metricCode ? sql`AND metric_code = ${params.metricCode}` : sql``}
        ${params.status ? sql`AND status = ${params.status}` : sql``}
        ${branchScopeCondition}
        ${cursorPeriod && cursorId ? sql`AND (period, id) < (${cursorPeriod}, ${cursorId})` : sql``}
      ORDER BY period DESC, id DESC
      LIMIT ${fetchLimit}
    `.execute(tx);

    const rows = res.rows;
    let nextCursor: string | null = null;
    if (rows.length > limit) {
      const nextItem = rows[limit - 1]!;
      nextCursor = Buffer.from(`${nextItem.period}|${nextItem.id}`).toString('base64url');
      rows.pop();
    }

    return { targets: rows, nextCursor };
  }

  async getSliceHistory(tx: Tx, tenantId: string, slice: TargetSlice): Promise<TargetRow[]> {
    const res = await sql<TargetRow>`
      SELECT * FROM target
      WHERE tenant_id = ${tenantId}
        AND period = ${slice.period}
        AND dimension_type = ${slice.dimensionType}
        AND dimension_id = ${slice.dimensionId}
        AND metric_code = ${slice.metricCode}
      ORDER BY version DESC, id DESC
    `.execute(tx);
    return res.rows;
  }

  async checkBranchExists(tx: Tx, tenantId: string, branchId: string): Promise<boolean> {
    const res = await sql<{ id: string }>`
      SELECT id FROM branch
      WHERE tenant_id = ${tenantId} AND id = ${branchId}
      LIMIT 1
    `.execute(tx);
    return Boolean(res.rows[0]);
  }

  async getUserPrimaryBranch(tx: Tx, tenantId: string, userId: string): Promise<string | null> {
    const res = await sql<{ primary_branch_id: string }>`
      SELECT primary_branch_id FROM app_user
      WHERE tenant_id = ${tenantId} AND id = ${userId}
      LIMIT 1
    `.execute(tx);
    return res.rows[0]?.primary_branch_id ?? null;
  }

  async checkProductExists(tx: Tx, tenantId: string, productId: string): Promise<boolean> {
    const res = await sql<{ id: string }>`
      SELECT id FROM loan_product
      WHERE tenant_id = ${tenantId} AND id = ${productId}
      LIMIT 1
    `.execute(tx);
    return Boolean(res.rows[0]);
  }
}

export class InMemoryTargetRepository implements TargetRepository {
  readonly targets = new Map<string, TargetRow>();
  readonly branches = new Set<string>();
  readonly users = new Map<string, string>();
  readonly products = new Set<string>();
  readonly idempotencyStore = new Map<
    string,
    { status: number; body: unknown; resourceRef?: string; inputHash: string }
  >();

  async withIdempotencyInMemory<T>(
    tenantId: string,
    key: string,
    input: unknown,
    run: () => Promise<{ status: number; body: T; resourceRef?: string }>,
  ): Promise<{ status: number; body: T; replayed?: boolean }> {
    const k = `${tenantId}:${key}`;
    const inputHash = JSON.stringify(input);
    const existing = this.idempotencyStore.get(k);
    if (existing) {
      if (existing.inputHash !== inputHash) {
        throw AppError.of('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was used for a different request.');
      }
      return { status: existing.status, body: existing.body as T, replayed: true };
    }
    const result = await run();
    this.idempotencyStore.set(k, {
      status: result.status,
      body: result.body,
      resourceRef: result.resourceRef,
      inputHash,
    });
    return result;
  }

  async findTargetById(_tx: Tx, tenantId: string, id: string): Promise<TargetRow | null> {
    const k = `${tenantId}:${id}`;
    return this.targets.get(k) ?? null;
  }

  async findApprovedSlice(_tx: Tx, tenantId: string, slice: TargetSlice): Promise<TargetRow | null> {
    for (const t of this.targets.values()) {
      if (
        t.tenant_id === tenantId &&
        t.period === slice.period &&
        t.dimension_type === slice.dimensionType &&
        t.dimension_id === slice.dimensionId &&
        t.metric_code === slice.metricCode &&
        t.status === 'APPROVED'
      ) {
        return t;
      }
    }
    return null;
  }

  async findPendingSlice(_tx: Tx, tenantId: string, slice: TargetSlice): Promise<TargetRow | null> {
    for (const t of this.targets.values()) {
      if (
        t.tenant_id === tenantId &&
        t.period === slice.period &&
        t.dimension_type === slice.dimensionType &&
        t.dimension_id === slice.dimensionId &&
        t.metric_code === slice.metricCode &&
        t.status === 'PENDING_APPROVAL'
      ) {
        return t;
      }
    }
    return null;
  }

  async getMaxVersion(_tx: Tx, tenantId: string, slice: TargetSlice): Promise<number> {
    let maxV = 0;
    for (const t of this.targets.values()) {
      if (
        t.tenant_id === tenantId &&
        t.period === slice.period &&
        t.dimension_type === slice.dimensionType &&
        t.dimension_id === slice.dimensionId &&
        t.metric_code === slice.metricCode
      ) {
        if (t.version > maxV) maxV = t.version;
      }
    }
    return maxV;
  }

  async insertTarget(_tx: Tx, row: TargetRow): Promise<void> {
    const k = `${row.tenant_id}:${row.id}`;
    this.targets.set(k, { ...row });
  }

  async updateTarget(
    _tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<TargetRow>,
  ): Promise<TargetRow> {
    const k = `${tenantId}:${id}`;
    const current = this.targets.get(k);
    if (!current || current.lock_version !== expectedLockVersion) {
      throw AppError.of(
        'VERSION_CONFLICT',
        'Target modified concurrently or version mismatch (If-Match ETag check failed)',
      );
    }

    const updated: TargetRow = {
      ...current,
      ...updates,
      lock_version: current.lock_version + 1,
      updated_at: new Date(),
    };
    this.targets.set(k, updated);
    return updated;
  }

  async supersedeSlice(_tx: Tx, tenantId: string, slice: TargetSlice, excludeId: string): Promise<void> {
    for (const [k, t] of this.targets.entries()) {
      if (
        t.tenant_id === tenantId &&
        t.period === slice.period &&
        t.dimension_type === slice.dimensionType &&
        t.dimension_id === slice.dimensionId &&
        t.metric_code === slice.metricCode &&
        t.status === 'APPROVED' &&
        t.id !== excludeId
      ) {
        this.targets.set(k, {
          ...t,
          status: 'SUPERSEDED',
          lock_version: t.lock_version + 1,
          updated_at: new Date(),
        });
      }
    }
  }

  async listTargets(
    _tx: Tx,
    params: TargetListParams,
  ): Promise<{ targets: TargetRow[]; nextCursor: string | null }> {
    let rows = Array.from(this.targets.values()).filter((t) => t.tenant_id === params.tenantId);

    if (params.period) rows = rows.filter((t) => t.period === params.period);
    if (params.dimensionType) rows = rows.filter((t) => t.dimension_type === params.dimensionType);
    if (params.dimensionId) rows = rows.filter((t) => t.dimension_id === params.dimensionId);
    if (params.metricCode) rows = rows.filter((t) => t.metric_code === params.metricCode);
    if (params.status) rows = rows.filter((t) => t.status === params.status);

    if (!params.isTenantWide) {
      rows = rows.filter((t) => {
        if (t.dimension_type === 'BRANCH') {
          return params.allowedBranchIds.includes(t.dimension_id);
        }
        if (t.dimension_type === 'USER') {
          if (params.allowedOwnUserId && t.dimension_id === params.allowedOwnUserId) return true;
          const userBranch = this.users.get(`${params.tenantId}:${t.dimension_id}`);
          return userBranch ? params.allowedBranchIds.includes(userBranch) : false;
        }
        if (t.dimension_type === 'PRODUCT') {
          return true;
        }
        return false;
      });
    }

    rows.sort((a, b) => {
      if (a.period !== b.period) return b.period.localeCompare(a.period);
      return b.id.localeCompare(a.id);
    });

    if (params.cursor) {
      try {
        const decoded = Buffer.from(params.cursor, 'base64url').toString('utf8');
        const [p, cid] = decoded.split('|');
        const idx = rows.findIndex((r) => r.period === p && r.id === cid);
        if (idx >= 0) {
          rows = rows.slice(idx + 1);
        }
      } catch {
        // ignore
      }
    }

    let nextCursor: string | null = null;
    if (rows.length > params.limit) {
      const nextItem = rows[params.limit - 1]!;
      nextCursor = Buffer.from(`${nextItem.period}|${nextItem.id}`).toString('base64url');
      rows = rows.slice(0, params.limit);
    }

    return { targets: rows, nextCursor };
  }

  async getSliceHistory(_tx: Tx, tenantId: string, slice: TargetSlice): Promise<TargetRow[]> {
    const matching: TargetRow[] = [];
    for (const t of this.targets.values()) {
      if (
        t.tenant_id === tenantId &&
        t.period === slice.period &&
        t.dimension_type === slice.dimensionType &&
        t.dimension_id === slice.dimensionId &&
        t.metric_code === slice.metricCode
      ) {
        matching.push(t);
      }
    }
    matching.sort((a, b) => b.version - a.version);
    return matching;
  }

  async checkBranchExists(_tx: Tx, tenantId: string, branchId: string): Promise<boolean> {
    return this.branches.has(`${tenantId}:${branchId}`);
  }

  async getUserPrimaryBranch(_tx: Tx, tenantId: string, userId: string): Promise<string | null> {
    return this.users.get(`${tenantId}:${userId}`) ?? null;
  }

  async checkProductExists(_tx: Tx, tenantId: string, productId: string): Promise<boolean> {
    return this.products.has(`${tenantId}:${productId}`);
  }
}
