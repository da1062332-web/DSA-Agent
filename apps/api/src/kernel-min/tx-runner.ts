// Minimal but real TxRunner (TASK-001 Gate 1 requirement). TASK-101 moves it into packages/kernel/src/db.
import { AppError, type Database, type RequestContext, type Tx, type TxRunner } from '@dsa/contracts';
import { sql, type Kysely } from 'kysely';

export function createTxRunner(db: Kysely<Database>): TxRunner {
  return {
    async withTenantTx<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
      const tenantId = ctx.principal.tenantId;
      if (!tenantId) throw AppError.of('TENANT_CONTEXT_MISSING', 'No tenant context.');
      return db.transaction().execute(async (tx) => {
        (tx as any).tenantId = tenantId;
        (tx as any).query = async (queryText: string, params: any[] = []) => {
          const res = await (tx as any).executeQuery({
            sql: queryText,
            parameters: params,
            query: { kind: 'RawBuilder' },
          });
          return { rows: res.rows ?? [] };
        };
        // set_config(name, value, true) is the parameter-safe form of SET LOCAL (RB-03.03, RB-03.17).
        // Session-level SET is forbidden: it would leak across pooled connections (Migration Plan §0).
        await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(tx);
        return fn(tx);
      });
    },
  };
}
