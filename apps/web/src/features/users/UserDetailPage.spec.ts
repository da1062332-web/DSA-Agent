// The account actions the staff screens offer. They must match what the API accepts (user-status.ts): an invited user is never
// activated or suspended by an administrator, and a deleted account offers nothing at all.
import { describe, expect, it } from 'vitest';
import { displayStatus, userActions } from './user-actions';

describe('account actions', () => {
  it('TEST-USRD-01 Activate is offered only for suspended and deactivated users, never for invited or active ones', () => {
    expect(userActions({ status: 'INVITED' }).activate).toBe(false);
    expect(userActions({ status: 'ACTIVE' }).activate).toBe(false);
    expect(userActions({ status: 'SUSPENDED' }).activate).toBe(true);
    expect(userActions({ status: 'DEACTIVATED' }).activate).toBe(true);
  });

  it('TEST-USRD-02 Suspend is offered only for active users', () => {
    expect(userActions({ status: 'ACTIVE' }).suspend).toBe(true);
    for (const status of ['INVITED', 'SUSPENDED', 'DEACTIVATED'])
      expect(userActions({ status }).suspend).toBe(false);
  });

  it('TEST-USRD-03 a deleted account offers no action and no editing, and reads DELETED', () => {
    const deleted = { status: 'DEACTIVATED', deleted: true };
    expect(userActions(deleted)).toEqual({ activate: false, suspend: false, delete: false, edit: false });
    expect(displayStatus(deleted)).toBe('DELETED');
    expect(displayStatus({ status: 'ACTIVE' })).toBe('ACTIVE');
  });

  it('TEST-USRD-04 every account that is not deleted can be deleted and edited', () => {
    for (const status of ['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']) {
      expect(userActions({ status })).toMatchObject({ delete: true, edit: true });
    }
  });
});
