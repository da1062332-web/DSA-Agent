// The second-factor rule on the sign-in screen: which step an account gets. Pure function, no network.
import { describe, expect, it } from 'vitest';
import { secondFactorPlan } from './secondFactor';

describe('secondFactorPlan', () => {
  it('TEST-2F-01 an account with a verified authenticator gets the code prompt for that factor', () => {
    expect(
      secondFactorPlan([
        { id: 'factor_old', status: 'verified' },
        { id: 'factor_pending', status: 'unverified' },
      ]),
    ).toEqual({ mode: 'challenge', factorId: 'factor_old' });
  });

  it('TEST-2F-02 an account with no authenticator gets the set-up, never a code prompt for a factor it does not have', () => {
    expect(secondFactorPlan([])).toEqual({ mode: 'enrol' });
    expect(secondFactorPlan(undefined)).toEqual({ mode: 'enrol' });
    expect(secondFactorPlan([{ id: 'factor_pending', status: 'unverified' }])).toEqual({ mode: 'enrol' });
  });

  it('TEST-2F-03 replacing an authenticator starts the set-up even when one is verified, and keeps the old one until the new one is verified', () => {
    expect(secondFactorPlan([{ id: 'factor_old', status: 'verified' }], true)).toEqual({ mode: 'enrol' });
  });
});
