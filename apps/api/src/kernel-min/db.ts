// Kysely on pg, connected as dsa_api (NOBYPASSRLS) — never supabase-js for data, never service_role (Contracts §1).
// TASK-101 moves this into packages/kernel/src/db.
import type { Database } from '@dsa/contracts';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

export function createDb(connectionString: string, opts: { poolMax?: number } = {}): Kysely<Database> {
  const pool = new pg.Pool({
    connectionString,
    max: opts.poolMax ?? 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  // Handle idle connection errors (e.g. ECONNRESET from remote pooler) so they do not crash the Node process
  pool.on('error', (err) => {
    console.warn('[pg pool] Unexpected error on idle client (reconnecting automatically):', err.message);
  });

  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });
}
