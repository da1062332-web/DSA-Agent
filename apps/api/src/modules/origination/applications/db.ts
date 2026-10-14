// SQL helpers for origination/applications (owner: Dev 3). Own copies, not imported from another module: the module
// boundary rule (eslint.config.mjs) forbids importing another module's internals. Every call runs inside withTenantTx,
// so row-level security keeps reads and writes to the caller's tenant (other tenants get 404).
import { AppError, type Tx } from '@dsa/contracts';
import { sql, type RawBuilder } from 'kysely';
import { decodeCursor, encodeCursor } from '../../../http/request';

export type Row = Record<string, unknown>;

export const iso = (v: unknown): string => (v instanceof Date ? v : new Date(String(v))).toISOString();

/** Locks one row for the rest of the transaction. 404 when the row is not visible to the caller. */
export async function loadForUpdate(tx: Tx, table: string, id: string, entity: string): Promise<Row> {
  const r = await sql<Row>`select * from ${sql.table(table)} where id = ${id} for update`.execute(tx);
  const row = r.rows[0];
  if (!row) throw AppError.of('NOT_FOUND', `${entity} not found.`);
  return row;
}

/** Checks If-Match before any state rule, so a stale screen gets VERSION_CONFLICT rather than a state error. */
export function assertVersion(current: Row, version: number): void {
  if (current.lock_version !== version) {
    throw AppError.of('VERSION_CONFLICT', 'The record was changed by someone else. Reload and try again.', [
      { field: 'If-Match', issue: 'STALE', meta: { currentVersion: current.lock_version } },
    ]);
  }
}

/** Optimistic update: If-Match must equal lock_version (the touch trigger bumps it). Concurrent writers get 409. */
export async function updateVersioned(
  tx: Tx,
  actorId: string,
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
  sets.push(sql`updated_by = ${actorId}`);
  const r =
    await sql<Row>`update ${sql.table(table)} set ${sql.join(sets)} where id = ${current.id} returning *`.execute(
      tx,
    );
  return r.rows[0]!;
}

/** Keyset page ordered by a text column then id, with one extra row to detect a next page. */
export async function keysetPage<T>(
  tx: Tx,
  opts: {
    from: RawBuilder<unknown>;
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
    select * from ${opts.from}
     ${where.length ? sql`where ${sql.join(where, sql` and `)}` : sql``}
     order by ${sql.ref(opts.sortColumn)}::text, id
     limit ${opts.limit + 1}`.execute(tx);
  const rows = r.rows.slice(0, opts.limit);
  const last = rows[rows.length - 1];
  const nextCursor =
    r.rows.length > opts.limit && last ? encodeCursor(String(last[opts.sortColumn]), String(last.id)) : null;
  return { data: rows.map(opts.map), meta: { nextCursor, limit: opts.limit } };
}
