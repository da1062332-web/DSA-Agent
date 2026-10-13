// Request helpers shared by every module (owner: Dev 1, Contracts §5).
import { AppError, type RequestContext } from '@dsa/contracts';
import { IDEMPOTENCY_KEY } from '@dsa/kernel';
import type { Request, Response } from 'express';

/** The authenticated context. The auth middleware always sets it on /v1; this only narrows the type. */
export function requireCtx(req: Request): RequestContext {
  if (!req.ctx) throw AppError.of('UNAUTHENTICATED', 'Missing or invalid access token.');
  return req.ctx;
}

/** If-Match is required on PATCH/PUT and transition POSTs: `"3"`, `W/"3"` or `3` → 3. */
export function ifMatchVersion(req: Request): number {
  const raw = req.get('if-match')?.trim();
  const m = raw ? /^(?:W\/)?"?(\d{1,9})"?$/.exec(raw) : null;
  if (!m) {
    throw AppError.of('MALFORMED_REQUEST', 'If-Match header with the current ETag is required.', [
      { field: 'If-Match', issue: 'REQUIRED' },
    ]);
  }
  return Number(m[1]);
}

/** Idempotency-Key is required on POSTs marked Idem. */
export function idempotencyKey(req: Request): string {
  const key = req.get('idempotency-key');
  if (!key || !IDEMPOTENCY_KEY.test(key)) {
    throw AppError.of(
      'MALFORMED_REQUEST',
      'Idempotency-Key header (8–128 chars, A-Z a-z 0-9 _ -) is required.',
      [{ field: 'Idempotency-Key', issue: 'REQUIRED' }],
    );
  }
  return key;
}

/** A single resource is returned bare with ETag: "<lock_version>". */
export function sendResource(res: Response, status: number, body: { version?: number }, replayed = false) {
  if (body.version !== undefined) res.set('ETag', `"${body.version}"`);
  if (replayed) res.set('Idempotent-Replayed', 'true');
  res.status(status).json(body);
}

/** Cursor = base64url of {"k": <last sort value>, "id": <last id>} (Contracts §5). */
export function encodeCursor(k: string, id: string): string {
  return Buffer.from(JSON.stringify({ k, id })).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): { k: string; id: string } | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { k?: unknown; id?: unknown };
    if (typeof v.k === 'string' && typeof v.id === 'string') return { k: v.k, id: v.id };
  } catch {
    // fall through
  }
  throw AppError.of('VALIDATION_ERROR', 'Invalid cursor.', [{ field: 'cursor', issue: 'INVALID' }]);
}
