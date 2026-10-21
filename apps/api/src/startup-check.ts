// Startup check (owner: Dev 1): is the database reachable, and which migrations does it lack? Read-only. The API starts either
// way; this only tells the developer, in one line each, what state the database is in.
import type { Database } from '@dsa/contracts';
import { sql, type Kysely } from 'kysely';

/** One object per migration that the API code relies on; a missing object means that migration is not applied. */
const SENTINELS: [string, string][] = [
  ['0066', `to_regclass('app.lender_query')`],
  ['0069', `to_regclass('app.worker_queue_state')`],
  ['0071', `to_regclass('app.document_version')`],
  ['0073', `to_regprocedure('app.handover_owned_records(text, text, text)')`],
  ['0074', `to_regclass('app.apply_link')`],
  ['0077', `to_regclass('app.inbound_webhook')`],
  ['0078', `to_regclass('app.retention_policy')`],
  ['0080', `to_regclass('app.reference_list')`],
  ['0081', `to_regclass('app.access_review')`],
  ['0082', `to_regclass('app.setting')`],
  ['0083', `to_regclass('app.tenant_offboarding')`],
  ['0084', `to_regclass('app.referral_consent_otp')`],
];

export type DatabaseStatus =
  | { connected: true; host: string; mode: string; database: string; missingMigrations: string[] }
  | { connected: false; host: string; mode: string; reason: string };

/** How the API reaches Postgres. Hosted uses the Supavisor transaction pooler (port 6543), which the code is built for. */
export function connectionMode(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('.pooler.supabase.com'))
      return u.port === '6543' ? 'transaction pooler' : 'session pooler';
    return 'direct';
  } catch {
    return 'unknown';
  }
}

export async function checkDatabase(db: Kysely<Database>, url: string): Promise<DatabaseStatus> {
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return 'unknown host';
    }
  })();
  try {
    const probes = SENTINELS.map(([n, expr]) => sql.raw(`(${expr} IS NOT NULL) AS m${n}`));
    const r = await sql<
      Record<string, unknown>
    >`select current_database() as db, ${sql.join(probes)}`.execute(db);
    const row = r.rows[0]!;
    return {
      connected: true,
      host,
      mode: connectionMode(url),
      database: String(row.db),
      missingMigrations: SENTINELS.filter(([n]) => row[`m${n}`] !== true).map(([n]) => n),
    };
  } catch (err) {
    return {
      connected: false,
      host,
      mode: connectionMode(url),
      reason: err instanceof Error ? err.message : 'unknown error',
    };
  }
}
