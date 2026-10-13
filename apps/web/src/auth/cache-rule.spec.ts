// Session cache rule (owner: Dev 1). The previous user's cached data must never survive a change of user.
import { describe, expect, it } from 'vitest';
import { isUserSwitch, shouldClearCache } from './cache-rule';

describe('auth: cache clearing on user change (TEST-AUTH-WEB-001)', () => {
  it('clears when a different user signs in', () => {
    expect(shouldClearCache('usr_asha', 'usr_omkar')).toBe(true);
  });

  it('clears on sign-out and on sign-in after sign-out', () => {
    expect(shouldClearCache('usr_asha', null)).toBe(true);
    expect(shouldClearCache(null, 'usr_omkar')).toBe(true);
  });

  it('does not clear on the first read of the stored session or when the same user is kept', () => {
    expect(shouldClearCache(undefined, 'usr_asha')).toBe(false);
    expect(shouldClearCache('usr_asha', 'usr_asha')).toBe(false);
    expect(shouldClearCache(null, null)).toBe(false);
  });
});

describe('auth: user switch detection (TEST-AUTH-WEB-003)', () => {
  it('is a switch only when one signed-in user replaces another', () => {
    expect(isUserSwitch('usr_asha', 'usr_omkar')).toBe(true);
    expect(isUserSwitch('usr_asha', 'usr_asha')).toBe(false);
    expect(isUserSwitch(undefined, 'usr_omkar')).toBe(false);
    expect(isUserSwitch(null, 'usr_omkar')).toBe(false);
    expect(isUserSwitch('usr_asha', null)).toBe(false);
  });
});
