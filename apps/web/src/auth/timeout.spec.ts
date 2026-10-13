// Sign-in timeout (owner: Dev 1). A stuck request must end with an error, not hang the form.
import { describe, expect, it } from 'vitest';
import { TimeoutError, withTimeout } from './timeout';

describe('auth: sign-in timeout (TEST-AUTH-WEB-002)', () => {
  it('passes through a result that settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok');
  });

  it('rejects with TimeoutError when the request never settles', async () => {
    await expect(withTimeout(new Promise(() => undefined), 10)).rejects.toBeInstanceOf(TimeoutError);
  });

  it('keeps the original error when the request fails first', async () => {
    await expect(withTimeout(Promise.reject(new Error('bad password')), 50)).rejects.toThrow('bad password');
  });
});
