// The "Activate Account" button (D4): an invited user becomes active only by signing in with their own password, so the button is never
// offered for one. Other statuses keep it.
import { describe, expect, it } from 'vitest';
import { canShowActivate } from './UserDetailPage';

describe('the Activate Account button', () => {
  it('TEST-USRD-01 is hidden for invited and active users, and shown for suspended and deactivated ones', () => {
    expect(canShowActivate('INVITED')).toBe(false);
    expect(canShowActivate('ACTIVE')).toBe(false);
    expect(canShowActivate('SUSPENDED')).toBe(true);
    expect(canShowActivate('DEACTIVATED')).toBe(true);
  });
});
