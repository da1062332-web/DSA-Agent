// Error envelope (Contracts §6). Messages never contain S2/S3 values and never reveal out-of-scope records.
// TODO(TASK-101, Dev 1): map PostgreSQL errors — 23505 → the constraint's 409 code (else INVALID_STATE),
// 23514 → VALIDATION_ERROR, 42501 from append-only triggers → INVALID_STATE, exclusion on rule_set_version →
// EFFECTIVE_OVERLAP.
import { AppError, type ErrorEnvelope } from '@dsa/contracts';
import type { ErrorRequestHandler } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';

function isBodyParserError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { type, status } = err as { type?: unknown; status?: unknown };
  return typeof type === 'string' && typeof status === 'number' && status >= 400 && status < 500;
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    return AppError.of(
      'VALIDATION_ERROR',
      'Request validation failed.',
      err.issues.map((i) => ({ field: i.path.join('.'), issue: i.code.toUpperCase() })),
    );
  }
  if (isBodyParserError(err)) return AppError.of('MALFORMED_REQUEST', 'Malformed request body.');
  return AppError.of('INTERNAL_ERROR', 'An unexpected error occurred.');
}

export function errorHandler(logger?: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const appError = toAppError(err);
    if (appError.httpStatus >= 500) {
      // Name, code and stack only: driver errors carry row values in other fields (e.g. pg `detail`).
      const e = err as { name?: string; code?: string; stack?: string };
      logger?.error(
        {
          correlationId: req.correlationId,
          errorCode: appError.code,
          err: { name: e.name, code: e.code, stack: e.stack },
        },
        'request failed',
      );
    }
    const body: ErrorEnvelope = {
      error: {
        code: appError.code,
        message: appError.message,
        httpStatus: appError.httpStatus,
        correlationId: req.correlationId,
        details: appError.details,
        retryable: appError.retryable,
      },
    };
    res.status(appError.httpStatus).json(body);
  };
}
