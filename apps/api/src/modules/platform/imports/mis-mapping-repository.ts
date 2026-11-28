// apps/api/src/modules/platform/imports/mis-mapping-repository.ts — owner: Devyani (P1-07 / TASK-140).
// One saved mapping per lender: how that bank's daily status sheet is read. Rows are never deleted — a past batch
// records which version read it — so this is an upsert plus a read.
import type { MisColumnMap, MisDateFormat, MisStatusMap, RequestContext, Tx } from '@dsa/contracts';
import { sql } from 'kysely';

export interface LenderMisMappingRow {
  id: string;
  tenant_id: string;
  lender_id: string;
  column_map: MisColumnMap | string;
  status_map: MisStatusMap | string;
  date_format: MisDateFormat;
  version: number;
  last_import_at: Date | null;
  lock_version: number;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
}

function parseJson<T>(value: T | string): T {
  return typeof value === 'string' ? (JSON.parse(value) as T) : value;
}

export class MisMappingRepository {
  async findByLender(tx: Tx, lenderId: string): Promise<LenderMisMappingRow | null> {
    const result = await sql<LenderMisMappingRow>`
      SELECT * FROM lender_mis_mapping WHERE lender_id = ${lenderId} LIMIT 1
    `.execute(tx);
    const row = result.rows[0];
    if (!row) return null;
    return { ...row, column_map: parseJson(row.column_map), status_map: parseJson(row.status_map) };
  }

  /**
   * Saves the lender's mapping, bumping `version` on every change. The unique index on (tenant_id, lender_id) is what
   * makes this one row per lender; the ON CONFLICT turns a second save into an update rather than a failed insert, so
   * the editor does not have to know whether a mapping already exists.
   */
  async upsert(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    input: {
      lenderId: string;
      columnMap: MisColumnMap;
      statusMap: MisStatusMap;
      dateFormat: MisDateFormat;
    },
  ): Promise<LenderMisMappingRow> {
    const result = await sql<LenderMisMappingRow>`
      INSERT INTO lender_mis_mapping (
        id, tenant_id, lender_id, column_map, status_map, date_format, version,
        created_by, updated_by
      ) VALUES (
        ${id}, ${ctx.principal.tenantId}, ${input.lenderId},
        ${JSON.stringify(input.columnMap)}::jsonb, ${JSON.stringify(input.statusMap)}::jsonb,
        ${input.dateFormat}, 1, ${ctx.principal.id}, ${ctx.principal.id}
      )
      ON CONFLICT (tenant_id, lender_id) DO UPDATE SET
        column_map   = EXCLUDED.column_map,
        status_map   = EXCLUDED.status_map,
        date_format  = EXCLUDED.date_format,
        version      = lender_mis_mapping.version + 1,
        lock_version = lender_mis_mapping.lock_version + 1,
        updated_by   = EXCLUDED.updated_by
      RETURNING *
    `.execute(tx);

    const row = result.rows[0]!;
    return { ...row, column_map: parseJson(row.column_map), status_map: parseJson(row.status_map) };
  }

  /** Stamped when a batch commits, so the lender page can show when its sheet was last loaded. */
  async markImported(tx: Tx, lenderId: string): Promise<void> {
    await sql`
      UPDATE lender_mis_mapping SET last_import_at = now() WHERE lender_id = ${lenderId}
    `.execute(tx);
  }
}
