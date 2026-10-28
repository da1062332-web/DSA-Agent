// Delete account: the dialog's Delete button stays disabled until there is a hand-over user (unless the person never signed in), a
// reason, and the typed confirmation.
import { describe, expect, it } from 'vitest';
import { CONFIRM_WORD, deleteBlocker } from './DeleteAccountDialog';

const ready = {
  status: 'ACTIVE',
  handoverToUserId: 'usr_2',
  reason: 'Left the company',
  confirmText: CONFIRM_WORD,
};

describe('the Delete account dialog', () => {
  it('TEST-DEL-01 an active user needs someone to take over their work; an invited one does not', () => {
    expect(deleteBlocker({ ...ready, handoverToUserId: '' })).toMatch(/takes over/);
    expect(deleteBlocker({ ...ready, status: 'INVITED', handoverToUserId: '' })).toBeNull();
  });

  it('TEST-DEL-02 a reason and the typed confirmation are required', () => {
    expect(deleteBlocker({ ...ready, reason: ' a ' })).toMatch(/reason/);
    expect(deleteBlocker({ ...ready, confirmText: 'delete' })).toMatch(/Type DELETE/);
    expect(deleteBlocker(ready)).toBeNull();
  });
});
