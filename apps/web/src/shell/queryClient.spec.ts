import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { createQueryClient } from './queryClient';
import { toastBridge } from './toast';

describe('createQueryClient mutation toasts', () => {
  afterEach(() => vi.restoreAllMocks());

  const run = (opts: object, fn: () => Promise<unknown>) => {
    const client = createQueryClient();
    return client
      .getMutationCache()
      .build(client, { mutationFn: fn, ...opts })
      .execute(undefined)
      .catch(() => undefined);
  };

  it('shows the success message from meta', async () => {
    const ok = vi.spyOn(toastBridge, 'success');
    await run({ meta: { successMessage: 'Saved it.' } }, async () => 1);
    expect(ok).toHaveBeenCalledWith('Saved it.');
  });

  it('shows the API error text on failure', async () => {
    const bad = vi.spyOn(toastBridge, 'error');
    await run({}, () => Promise.reject(new ApiError('INVALID_STATE', 409, 'Not allowed.')));
    expect(bad).toHaveBeenCalledWith('Not allowed.');
  });

  it('stays quiet for silent or already handled writes', async () => {
    const bad = vi.spyOn(toastBridge, 'error');
    await run({ meta: { silent: true } }, () => Promise.reject(new Error('x')));
    await run({ meta: { handled: true } }, () => Promise.reject(new Error('x')));
    expect(bad).not.toHaveBeenCalled();
  });
});
