// The invitation password step (API-USR-001): what is checked, what is sent to Supabase and in what order, and the page's states.
// The Supabase client is a fake, and the page is rendered to static HTML as the other auth specs do.
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  AcceptInvitationPage,
  readLink,
  redeemLink,
  setInvitedPassword,
  type InvitedPasswordAuth,
} from './AcceptInvitationPage';

describe('reading the invitation link', () => {
  it('TEST-ACCEPT-07 a Supabase error in the address is reported with its code and description', () => {
    expect(
      readLink({
        search: '',
        hash: '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      }),
    ).toEqual({ kind: 'error', code: 'otp_expired', description: 'Email link is invalid or has expired' });
    expect(readLink({ search: '?error=server_error', hash: '' })).toMatchObject({
      kind: 'error',
      code: 'server_error',
    });
  });

  it('TEST-ACCEPT-08 a scanner-safe link is read as a token to redeem; other types and plain addresses are not', () => {
    expect(readLink({ search: '?token_hash=abc123&type=invite', hash: '' })).toEqual({
      kind: 'token',
      tokenHash: 'abc123',
      type: 'invite',
    });
    expect(readLink({ search: '?token_hash=abc123&type=email_change', hash: '' })).toEqual({ kind: 'none' });
    expect(readLink({ search: '', hash: '#access_token=x&type=invite' })).toEqual({ kind: 'none' });
  });

  it('TEST-ACCEPT-09 redeeming sends the token only when asked, and reports Supabase’s reason when it fails', async () => {
    const verifyOtp = vi.fn(async () => ({ error: null }));
    expect(await redeemLink({ verifyOtp }, 'abc123', 'invite')).toBeNull();
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc123', type: 'invite' });
    const failing = { verifyOtp: async () => ({ error: { message: 'Token has expired or is invalid' } }) };
    expect(await redeemLink(failing, 'abc123', 'recovery')).toBe('Token has expired or is invalid');
  });
});

const state = vi.hoisted(() => ({ session: null as unknown }));

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({
    session: state.session,
    aal: undefined,
    recovering: false,
    refreshAal: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock('./supabase', () => ({
  getSupabase: () => ({ auth: {} }),
}));

const GOOD = 'a long enough password 1';

function fakeAuth(updateError: string | null = null) {
  const calls: string[] = [];
  const auth: InvitedPasswordAuth = {
    updateUser: vi.fn(async (attributes: { password: string }) => {
      calls.push(`updateUser:${attributes.password}`);
      return { error: updateError ? { message: updateError } : null };
    }),
    signOut: vi.fn(async (options: { scope: 'global' }) => {
      calls.push(`signOut:${options.scope}`);
      return {};
    }),
  };
  return { auth, calls };
}

describe('setting the invited password', () => {
  it('TEST-ACCEPT-01 a password shorter than 12 characters is refused before anything is sent to Supabase', async () => {
    const { auth, calls } = fakeAuth();
    expect(await setInvitedPassword(auth, 'short1', 'short1')).toBe('Use at least 12 characters.');
    expect(calls).toEqual([]);
  });

  it('TEST-ACCEPT-02 a confirmation that does not match is refused before anything is sent to Supabase', async () => {
    const { auth, calls } = fakeAuth();
    expect(await setInvitedPassword(auth, GOOD, `${GOOD}x`)).toBe('The passwords do not match.');
    expect(calls).toEqual([]);
  });

  it('TEST-ACCEPT-03 when Supabase refuses the new password, its message is returned and no session is ended', async () => {
    const { auth, calls } = fakeAuth('Password is too weak.');
    expect(await setInvitedPassword(auth, GOOD, GOOD)).toBe('Password is too weak.');
    expect(calls).toEqual([`updateUser:${GOOD}`]);
  });

  it('TEST-ACCEPT-04 on success the password is set first, then every session is ended, so the next sign-in is a password sign-in', async () => {
    const { auth, calls } = fakeAuth();
    expect(await setInvitedPassword(auth, GOOD, GOOD)).toBeNull();
    expect(calls).toEqual([`updateUser:${GOOD}`, 'signOut:global']);
  });
});

describe('the invitation page', () => {
  const render = () =>
    renderToString(
      <MemoryRouter>
        <AcceptInvitationPage />
      </MemoryRouter>,
    );

  it('TEST-ACCEPT-05 without an invitation session, the page says the link has expired and shows no password form', () => {
    state.session = null;
    const html = render();
    expect(html).toContain('Invitation link expired');
    expect(html).toContain('Ask your administrator to send a new invitation.');
    expect(html).not.toContain('Choose your password');
  });

  it('TEST-ACCEPT-06 with an invitation session, the page names the account and shows the password form', () => {
    state.session = { user: { email: 'meera.iyer@example.test' } };
    const html = render();
    expect(html).toContain('Choose your password');
    expect(html).toContain('Setting the password for meera.iyer@example.test');
    expect(html).toContain('New password');
    expect(html).toContain('Confirm new password');
  });
});
