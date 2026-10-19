// Error envelope mapping (Contracts §6): PostgreSQL errors become stable codes; server bugs are never shown as business conflicts.
import { describe, expect, it } from 'vitest';
import { toAppError } from '../src/http/error-handler';

const pgError = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { code, ...extra });

describe('TEST-ERR toAppError', () => {
  it('TEST-ERR-001 a refusal raised by our own trigger (42501) is a 409 INVALID_STATE', () => {
    const e = toAppError(pgError('42501', 'submission_package pkg_1 is immutable (only frozen_at may be set once)'));
    expect(e.code).toBe('INVALID_STATE');
    expect(e.httpStatus).toBe(409);
  });

  it('TEST-ERR-002 a missing GRANT or a row-level-security violation (42501) is a 500, not a business conflict', () => {
    expect(toAppError(pgError('42501', 'permission denied for table lender_query')).code).toBe('INTERNAL_ERROR');
    expect(toAppError(pgError('42501', 'new row violates row-level security policy for table "lead"')).code).toBe(
      'INTERNAL_ERROR',
    );
  });

  it('TEST-ERR-003 unique, check and foreign-key violations keep their codes and reveal only the constraint name', () => {
    const unique = toAppError(pgError('23505', 'duplicate key value violates unique constraint', { constraint: 'x_uq' }));
    expect(unique.code).toBe('INVALID_STATE');
    expect(unique.details[0]?.meta).toEqual({ constraint: 'x_uq' });
    expect(toAppError(pgError('23514', 'check failed')).code).toBe('VALIDATION_ERROR');
    expect(toAppError(pgError('23503', 'fk failed')).code).toBe('VALIDATION_ERROR');
  });
});
