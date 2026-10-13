// Idempotency-Key store (Contracts §5, ENT-109) — owner: Dev 1 — TASK-105.
// Runs inside the command's transaction: the key row commits with the state change, or not at all.
// Same key + same request → the stored response is replayed. Same key + different request → 422
// IDEMPOTENCY_KEY_REUSED. A concurrent request with the same key waits on the primary key, then replays.
import crypto from 'node:crypto';
import { AppError, type RequestContext, type Tx } from '@dsa/contracts';
import { sql } from 'kysely';

export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

export interface IdempotentRequest {
  key: string;
  method: string;
  path: string;
  body: unknown;
}

export interface CommandResult<T> {
  status: number;
  body: T;
  /** Set on a replay. */
  replayed?: boolean;
}

export async function withIdempotency<T>(
  tx: Tx,
  ctx: RequestContext,
  req: IdempotentRequest,
  run: () => Promise<{ status: number; body: T; resourceRef?: string }>,
): Promise<CommandResult<T>> {
  const p = ctx.principal;
  const hash = requestHash(req);

  const inserted = await sql<{ key: string }>`
    insert into idempotency_key (tenant_id, principal_id, key, method, path, request_hash, status)
    values (${p.tenantId}, ${p.id}, ${req.key}, ${req.method}, ${req.path}, ${hash}, 'IN_PROGRESS')
    on conflict (tenant_id, principal_id, key) do nothing
    returning key`.execute(tx);

  if (!inserted.rows.length) {
    const existing = await sql<{
      request_hash: string;
      status: string;
      response_status: number;
      response_body: T;
    }>`
      select request_hash, status, response_status, response_body from idempotency_key
       where tenant_id = ${p.tenantId} and principal_id = ${p.id} and key = ${req.key}`.execute(tx);
    const row = existing.rows[0];
    if (!row || row.status !== 'COMPLETED') {
      throw AppError.of('IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is still running.');
    }
    if (row.request_hash !== hash) {
      throw AppError.of('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was used for a different request.');
    }
    return { status: row.response_status, body: row.response_body, replayed: true };
  }

  const result = await run();
  await sql`
    update idempotency_key
       set status = 'COMPLETED', response_status = ${result.status},
           response_body = ${JSON.stringify(result.body ?? null)}::jsonb, resource_ref = ${result.resourceRef ?? null}
     where tenant_id = ${p.tenantId} and principal_id = ${p.id} and key = ${req.key}`.execute(tx);
  return { status: result.status, body: result.body };
}

export function requestHash(req: IdempotentRequest): string {
  return crypto
    .createHash('sha256')
    .update(`${req.method.toUpperCase()} ${req.path}\n${canonicalJson(req.body)}`)
    .digest('hex');
}

/** JSON with sorted object keys, so field order does not change the hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}
