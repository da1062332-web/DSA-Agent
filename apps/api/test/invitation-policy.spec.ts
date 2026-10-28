// The staff invitation rules: when an invitation counts as expired, and when a new one may be sent. Pure functions, no database.
import { describe, expect, it } from 'vitest';
import {
  INVITATION_TTL_MS,
  MAX_RESENDS,
  RESEND_COOLDOWN_MS,
  invitationExpiry,
  invitationState,
  resendRefusal,
  type InvitationRecord,
} from '../src/modules/platform/invitations';

const NOW = new Date('2026-10-27T10:00:00Z');
const record = (over: Partial<InvitationRecord> = {}): InvitationRecord => ({
  status: 'PENDING',
  sentAt: NOW,
  expiresAt: invitationExpiry(NOW),
  resendCount: 0,
  ...over,
});

describe('invitation state', () => {
  it('TEST-INVPOL-01 the link is valid for 24 hours from when it was sent', () => {
    expect(INVITATION_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(invitationExpiry(NOW).toISOString()).toBe('2026-10-28T10:00:00.000Z');
  });

  it('TEST-INVPOL-02 a pending invitation is PENDING until it expires, then EXPIRED even before the sign-in path records it', () => {
    expect(invitationState(record(), new Date(NOW.getTime() + 60_000))).toBe('PENDING');
    expect(invitationState(record(), new Date(invitationExpiry(NOW).getTime()))).toBe('EXPIRED');
    expect(invitationState(record({ status: 'EXPIRED' }), NOW)).toBe('EXPIRED');
  });

  it('TEST-INVPOL-03 an accepted invitation stays ACCEPTED, and a missing or revoked one is NONE', () => {
    expect(invitationState(record({ status: 'ACCEPTED' }), new Date(invitationExpiry(NOW).getTime() + 1))).toBe('ACCEPTED');
    expect(invitationState(undefined, NOW)).toBe('NONE');
    expect(invitationState(record({ status: 'REVOKED' }), NOW)).toBe('NONE');
  });
});

describe('resending an invitation', () => {
  it('TEST-INVPOL-04 the first send from the resend path is allowed when there is no earlier invitation', () => {
    expect(resendRefusal(undefined, NOW)).toBeNull();
  });

  it('TEST-INVPOL-05 a resend within the cooldown is refused, and allowed once the cooldown has passed', () => {
    expect(resendRefusal(record(), new Date(NOW.getTime() + RESEND_COOLDOWN_MS - 1))).not.toBeNull();
    expect(resendRefusal(record(), new Date(NOW.getTime() + RESEND_COOLDOWN_MS))).toBeNull();
  });

  it('TEST-INVPOL-06 after the maximum number of sends, a resend is refused', () => {
    const later = new Date(NOW.getTime() + RESEND_COOLDOWN_MS * 10);
    expect(resendRefusal(record({ resendCount: MAX_RESENDS - 1 }), later)).toBeNull();
    expect(resendRefusal(record({ resendCount: MAX_RESENDS }), later)).toMatch(/maximum/);
  });

  it('TEST-INVPOL-07 an accepted invitation cannot be resent', () => {
    expect(
      resendRefusal(record({ status: 'ACCEPTED' }), new Date(NOW.getTime() + RESEND_COOLDOWN_MS * 10)),
    ).toMatch(/already set a password/);
  });

  it('TEST-INVPOL-08 an expired invitation can be resent once the cooldown has passed', () => {
    const later = new Date(invitationExpiry(NOW).getTime() + RESEND_COOLDOWN_MS);
    expect(invitationState(record(), later)).toBe('EXPIRED');
    expect(resendRefusal(record(), later)).toBeNull();
  });
});
