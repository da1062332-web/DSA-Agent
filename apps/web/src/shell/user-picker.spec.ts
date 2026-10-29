// Unit tests: the owner picker offers only internal staff, and a partner portal login is never offered as a relationship owner.
import { describe, expect, it } from 'vitest';
import { isInternalStaff } from './selectors';

describe('internal staff in pickers (TEST-PICK)', () => {
  it('TEST-PICK-001 a staff user can be picked as a relationship owner', () => {
    expect(isInternalStaff({ userType: 'STAFF' })).toBe(true);
  });

  it('TEST-PICK-002 a partner portal login cannot be picked as a relationship owner', () => {
    expect(isInternalStaff({ userType: 'CONNECTOR' })).toBe(false);
  });

  it('TEST-PICK-003 a user whose kind the API did not send is not treated as staff', () => {
    expect(isInternalStaff({})).toBe(false);
  });
});
