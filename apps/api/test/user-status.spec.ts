// The account status changes an administrator may make (user-status.ts). The web app mirrors these rules in user-actions.ts.
import { describe, expect, it } from 'vitest';
import { ACTIVATION_REFUSED, statusChangeRefusal } from '../src/modules/platform/user-status';

describe('status changes an administrator may make', () => {
  it('TEST-USTAT-01 an invited user is never activated by an administrator (D4), only by their own password sign-in', () => {
    expect(statusChangeRefusal('INVITED', 'ACTIVE')).toBe(ACTIVATION_REFUSED);
  });

  it('TEST-USTAT-02 suspended and deactivated users can be activated again', () => {
    expect(statusChangeRefusal('SUSPENDED', 'ACTIVE')).toBeNull();
    expect(statusChangeRefusal('DEACTIVATED', 'ACTIVE')).toBeNull();
  });

  it('TEST-USTAT-03 only an active user can be suspended', () => {
    expect(statusChangeRefusal('ACTIVE', 'SUSPENDED')).toBeNull();
    for (const from of ['INVITED', 'DEACTIVATED']) {
      expect(statusChangeRefusal(from, 'SUSPENDED')).toMatch(/Only an active user/);
    }
  });

  it('TEST-USTAT-04 deactivation is allowed from active, suspended and invited; nobody is set back to INVITED', () => {
    for (const from of ['ACTIVE', 'SUSPENDED', 'INVITED'])
      expect(statusChangeRefusal(from, 'DEACTIVATED')).toBeNull();
    for (const from of ['ACTIVE', 'SUSPENDED', 'DEACTIVATED']) {
      expect(statusChangeRefusal(from, 'INVITED')).toMatch(/only through an invitation/);
    }
  });

  it('TEST-USTAT-05 an unchanged status is always accepted', () => {
    for (const s of ['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'])
      expect(statusChangeRefusal(s, s)).toBeNull();
  });
});
