import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTIVE_ROLE_KEY, HOME_PATH, clearSessionPreferences } from './session-prefs';

describe('session preferences', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('TEST-AUTH-HOME-001 every sign-in lands on the root, which shows the signed-in role’s own dashboard', () => {
    expect(HOME_PATH).toBe('/');
  });

  it('TEST-AUTH-HOME-002 clears the dashboard role picked in the previous sign-in', () => {
    const store = new Map<string, string>([[ACTIVE_ROLE_KEY, 'ROLE-FINANCE-EXEC'], ['other', 'kept']]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    clearSessionPreferences();
    expect(store.has(ACTIVE_ROLE_KEY)).toBe(false);
    expect(store.get('other')).toBe('kept');
  });

  it('TEST-AUTH-HOME-003 does not throw when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => clearSessionPreferences()).not.toThrow();
  });
});
