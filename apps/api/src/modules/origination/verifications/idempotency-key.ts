// apps/api/src/modules/origination/verifications/idempotency-key.ts — owner: Prathamesh (MOD-VER).
import { AppError } from '@dsa/contracts';
import type { Request } from 'express';

/** The Idempotency-Key of a verification POST: required, 8 to 128 letters, digits, underscores or hyphens. */
export function readIdempotencyKey(req: Request): string {
  const idempotencyKey = req.get('Idempotency-Key');
  if (!idempotencyKey) {
    throw AppError.of(
      'VALIDATION_ERROR',
      'Idempotency-Key header is required for creating verification checks.',
      [{ field: 'Idempotency-Key', issue: 'REQUIRED' }],
    );
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) {
    throw AppError.of('VALIDATION_ERROR', 'Invalid Idempotency-Key format.', [
      { field: 'Idempotency-Key', issue: 'INVALID_FORMAT' },
    ]);
  }
  return idempotencyKey;
}
