import { describe, expect, it } from 'vitest';
import { ACCESS_DENIED_TEXT, ApiError, errorText } from './client';

describe('errorText', () => {
  it('gives one clear message for any refused permission, whatever the API said', () => {
    expect(errorText(new ApiError('FORBIDDEN', 403, 'Principal requires message.send'))).toBe(
      ACCESS_DENIED_TEXT,
    );
  });
  it('keeps field details and the reference for other errors', () => {
    const err = new ApiError('VALIDATION_ERROR', 422, 'Invalid.', 'ref1', [
      { field: 'name', issue: 'REQUIRED' },
    ]);
    expect(errorText(err)).toBe('Invalid. — name: required (ref ref1)');
  });
  it('handles plain errors and unknown values', () => {
    expect(errorText(new Error('boom'))).toBe('boom');
    expect(errorText('x')).toBe('Something went wrong.');
  });
});
