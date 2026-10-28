// The invitation panel's rules: the resend countdown runs on the server's clock, the button says why it cannot be pressed, and each
// delivery state gets one clear message.
import { describe, expect, it } from 'vitest';
import type { InvitationStatus } from './api';
import { deliveryMessage, formatCountdown, resendButton, secondsUntil } from './InvitationPanel';

const SERVER = '2026-10-27T10:00:00.000Z';
const status = (over: Partial<InvitationStatus> = {}): InvitationStatus => ({
  userStatus: 'INVITED',
  invitationState: 'PENDING',
  deliveryState: 'SENT',
  lastFailure: null,
  sentAt: SERVER,
  expiresAt: '2026-10-28T10:00:00.000Z',
  resendCount: 0,
  acceptedAt: null,
  nextResendAt: '2026-10-27T10:00:45.000Z',
  resendsLeft: 5,
  serverTime: SERVER,
  ...over,
});

describe('the resend countdown', () => {
  it('TEST-INVP-01 counts down on the server’s clock, whatever the browser’s clock says', () => {
    const fetchedAt = Date.parse('2030-01-01T00:00:00Z'); // a browser clock years off
    expect(secondsUntil('2026-10-27T10:00:45.000Z', SERVER, fetchedAt, fetchedAt)).toBe(45);
    expect(secondsUntil('2026-10-27T10:00:45.000Z', SERVER, fetchedAt, fetchedAt + 30_000)).toBe(15);
    expect(secondsUntil('2026-10-27T10:00:45.000Z', SERVER, fetchedAt, fetchedAt + 60_000)).toBe(0);
    expect(formatCountdown(45)).toBe('0:45');
    expect(formatCountdown(61)).toBe('1:01');
  });

  it('TEST-INVP-02 the button says why it cannot be pressed: sending, waiting, or no resends left', () => {
    expect(resendButton(status({ deliveryState: 'QUEUED' }), 0, false)).toEqual({
      label: 'Sending…',
      enabled: false,
    });
    expect(resendButton(status(), 45, false)).toEqual({ label: 'Resend in 0:45', enabled: false });
    expect(resendButton(status({ resendsLeft: 0 }), 0, false)).toEqual({
      label: 'No resends left',
      enabled: false,
    });
    expect(resendButton(status(), 0, false)).toEqual({ label: 'Resend invitation', enabled: true });
    expect(resendButton(status(), 0, true)).toEqual({ label: 'Sending…', enabled: false });
  });
});

describe('the delivery message', () => {
  it('TEST-INVP-03 a sent invitation says when, until when, and how a resend arrives', () => {
    expect(deliveryMessage(status()).severity).toBe('success');
    expect(deliveryMessage(status({ resendCount: 1 })).text).toMatch(/Reset your password/);
    expect(deliveryMessage(status({ invitationState: 'EXPIRED' })).severity).toBe('warning');
  });

  it('TEST-INVP-04 queued, delayed and failed sends each get their own message', () => {
    expect(deliveryMessage(status({ deliveryState: 'QUEUED' })).text).toMatch(/Sending/);
    expect(deliveryMessage(status({ deliveryState: 'QUEUED', lastFailure: 'DELIVERY_RETRY' })).text).toMatch(
      /retried/,
    );
    expect(
      deliveryMessage(status({ deliveryState: 'FAILED', lastFailure: 'EMAIL_NOT_AVAILABLE' })).text,
    ).toMatch(/belongs elsewhere/);
    expect(
      deliveryMessage(status({ deliveryState: 'FAILED', lastFailure: 'DELIVERY_FAILED' })).severity,
    ).toBe('error');
  });
});
