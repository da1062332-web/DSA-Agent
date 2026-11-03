// The setting is read from the API, once per page load, and fails closed when the API cannot say.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAuthConfig, parseAuthConfig, resetAuthConfigCache } from './auth-config';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  resetAuthConfigCache();
});

describe('parseAuthConfig', () => {
  it('accepts the setting as a boolean', () => {
    expect(parseAuthConfig({ mfaEnabled: true })).toEqual({ mfaEnabled: true });
    expect(parseAuthConfig({ mfaEnabled: false })).toEqual({ mfaEnabled: false });
  });

  it('refuses anything else', () => {
    expect(parseAuthConfig(null)).toBeNull();
    expect(parseAuthConfig('false')).toBeNull();
    expect(parseAuthConfig({})).toBeNull();
    expect(parseAuthConfig({ mfaEnabled: 'false' })).toBeNull();
  });
});

describe('loadAuthConfig', () => {
  it('asks the API for the setting with the second-factor setting from its response', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => json({ mfaEnabled: false }));
    await expect(loadAuthConfig(fetchFn)).resolves.toEqual({ mfaEnabled: false });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0]?.[0])).toMatch(/\/public\/v1\/auth\/config$/);
  });

  it('reads it once per page load', async () => {
    const fetchFn = vi.fn(async () => json({ mfaEnabled: true }));
    await loadAuthConfig(fetchFn);
    await loadAuthConfig(fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('shares one request between callers that ask at the same time', async () => {
    const fetchFn = vi.fn(async () => json({ mfaEnabled: true }));
    const [a, b] = await Promise.all([loadAuthConfig(fetchFn), loadAuthConfig(fetchFn)]);
    expect(a).toEqual(b);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the API answers with an error, and asks again next time', async () => {
    const fetchFn = vi.fn(async () => json({ error: 'down' }, 503));
    await expect(loadAuthConfig(fetchFn)).rejects.toThrow('auth config 503');
    fetchFn.mockImplementationOnce(async () => json({ mfaEnabled: true }));
    await expect(loadAuthConfig(fetchFn)).resolves.toEqual({ mfaEnabled: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('fails closed on a malformed answer', async () => {
    const fetchFn = vi.fn(async () => json({ mfaEnabled: 'yes' }));
    await expect(loadAuthConfig(fetchFn)).rejects.toThrow('auth config malformed');
  });

  it('fails closed when the network is down', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('network');
    });
    await expect(loadAuthConfig(fetchFn)).rejects.toThrow('network');
  });
});
