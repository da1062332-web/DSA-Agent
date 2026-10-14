// Error envelope (Contracts §6). Messages never contain S2/S3 values and never reveal out-of-scope records.
// PostgreSQL errors (TASK-101): 23505 → INVALID_STATE (constraint name only, never the row), 23514/23503/22xxx →
// VALIDATION_ERROR, 42501 from append-only triggers → INVALID_STATE, exclusion on rule_set_version →
// EFFECTIVE_OVERLAP, other exclusions (overlapping memberships) → INVALID_STATE.
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
  if (err instanceof AppError || (typeof err === 'object' && err !== null && (err as any).name === 'AppError')) {
    return err as AppError;
  }
  if (err instanceof ZodError || (typeof err === 'object' && err !== null && (err as any).name === 'ZodError')) {
    const issues = (err as ZodError).issues || [];
    return AppError.of(
      'VALIDATION_ERROR',
      'Request validation failed.',
      issues.map((i) => ({ field: i.path.join('.'), issue: i.code.toUpperCase() })),
    );
  }
  if (isBodyParserError(err)) return AppError.of('MALFORMED_REQUEST', 'Malformed request body.');
  return fromPostgres(err) ?? AppError.of('INTERNAL_ERROR', 'An unexpected error occurred.');
}

function fromPostgres(err: unknown): AppError | null {
  if (typeof err !== 'object' || err === null) return null;
  const { code, constraint, table } = err as { code?: unknown; constraint?: unknown; table?: unknown };
  if (typeof code !== 'string' || !/^[0-9A-Z]{5}$/.test(code)) return null;
  const meta = typeof constraint === 'string' ? { constraint } : undefined;
  switch (true) {
    case code === '23505':
      return AppError.of('INVALID_STATE', 'A record with the same unique value already exists.', [
        { issue: 'UNIQUE_VIOLATION', meta },
      ]);
    case code === '23P01':
      return table === 'rule_set_version'
        ? AppError.of('EFFECTIVE_OVERLAP', 'The effective period overlaps an existing version.')
        : AppError.of('INVALID_STATE', 'An overlapping record already exists.', [{ issue: 'OVERLAP', meta }]);
    case code === '23514' || code === '23503' || code === '23502' || code.startsWith('22'):
      return AppError.of('VALIDATION_ERROR', 'The request breaks a data rule.', [
        { issue: 'CONSTRAINT', meta },
      ]);
    case code === '42501':
      return AppError.of('INVALID_STATE', 'This record cannot be changed.');
    default:
      return null;
  }
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
