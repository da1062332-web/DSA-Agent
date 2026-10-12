// SQL helpers for module platform (owner: Dev 1). Every call runs inside withTenantTx, so RLS limits rows to the
// caller's tenant; ids from other tenants simply are not found (→ 404, never 403).
import { AppError, type RequestContext, type Tx } from '@dsa/contracts';
import { sql, type RawBuilder } from 'kysely';
import { decodeCursor, encodeCursor } from '../../http/request';

export type Row = Record<string, unknown>;

export const iso = (v: unknown): string => (v instanceof Date ? v : new Date(String(v))).toISOString();

/** Loads one row and locks it for the rest of the transaction. 404 when invisible. */
export async function loadForUpdate(tx: Tx, table: string, id: string, entity: string): Promise<Row> {
  const r = await sql<Row>`select * from ${sql.table(table)} where id = ${id} for update`.execute(tx);
  const row = r.rows[0];
  if (!row) throw AppError.of('NOT_FOUND', `${entity} not found.`);
  return row;
}

/** Optimistic update: the caller's If-Match version must equal lock_version (touch_row increments it). */
export async function updateVersioned(
  tx: Tx,
  ctx: RequestContext,
  table: string,
  current: Row,
  version: number,
  changes: Record<string, unknown>,
): Promise<Row> {
  if (current.lock_version !== version) {
    throw AppError.of('VERSION_CONFLICT', 'The record was changed by someone else. Reload and try again.', [
      { field: 'If-Match', issue: 'STALE', meta: { currentVersion: current.lock_version } },
    ]);
  }
  const sets: RawBuilder<unknown>[] = Object.entries(changes)
    .filter(([, v]) => v !== undefined)
    .map(([col, v]) => sql`${sql.ref(col)} = ${v}`);
  sets.push(sql`updated_by = ${ctx.principal.id}`);
  const r = await sql<Row>`
    update ${sql.table(table)} set ${sql.join(sets)} where id = ${current.id} returning *`.execute(tx);
  return r.rows[0]!;
}

/** Keyset page on (sortColumn, id), fetching one extra row to know whether there is a next page. */
export async function keysetPage<T>(
  tx: Tx,
  opts: {
    from: RawBuilder<unknown>;
    select: RawBuilder<unknown>;
    sortColumn: string;
    where: RawBuilder<unknown>[];
    limit: number;
    cursor?: string;
    map: (row: Row) => T;
  },
): Promise<{ data: T[]; meta: { nextCursor: string | null; limit: number } }> {
  const after = decodeCursor(opts.cursor);
  const where = [...opts.where];
  if (after) where.push(sql`(${sql.ref(opts.sortColumn)}::text, id) > (${after.k}, ${after.id})`);
  const r = await sql<Row>`
    select ${opts.select} from ${opts.from}
     ${where.length ? sql`where ${sql.join(where, sql` and `)}` : sql``}
     order by ${sql.ref(opts.sortColumn)}::text, id
     limit ${opts.limit + 1}`.execute(tx);
  const rows = r.rows.slice(0, opts.limit);
  const last = rows[rows.length - 1];
  const nextCursor =
    r.rows.length > opts.limit && last
      ? encodeCursor(String(last[opts.sortColumn.split('.').pop()!]), String(last.id))
      : null;
  return { data: rows.map(opts.map), meta: { nextCursor, limit: opts.limit } };
}

/** Users referenced by a command must exist in the tenant and be ACTIVE (else 422 INVALID_ASSIGNEE). */
export async function requireActiveUsers(tx: Tx, userIds: string[], field: string): Promise<void> {
  const unique = [...new Set(userIds)];
  if (!unique.length) return;
  const r = await sql<{ id: string }>`
    select id from app_user where id = any(${unique}::text[]) and status = 'ACTIVE'`.execute(tx);
  const found = new Set(r.rows.map((u) => u.id));
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length) {
    throw AppError.of('INVALID_ASSIGNEE', 'Every user must be an active user of this tenant.', [
      { field, issue: 'USER_NOT_ACTIVE', meta: { userIds: missing } },
    ]);
  }
}

export async function requireActiveBranch(tx: Tx, branchId: string, field: string): Promise<void> {
  const r = await sql<{ status: string }>`select status from branch where id = ${branchId}`.execute(tx);
  if (r.rows[0]?.status !== 'ACTIVE') {
    throw AppError.of('VALIDATION_ERROR', 'The branch does not exist or is inactive.', [
      { field, issue: 'BRANCH_NOT_ACTIVE' },
    ]);
  }
}
