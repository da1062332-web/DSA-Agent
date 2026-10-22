import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage, HARDCODED_TEST_OTP } from './LoginPage';
import * as AuthProviderModule from './AuthProvider';

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({
    session: null,
    aal: undefined,
    recovering: false,
    refreshAal: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock('./supabase', () => ({
  getSupabase: () => ({
    auth: {
      signInWithPassword: vi.fn(),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  }),
  saveBypassSession: vi.fn(),
  getStorageKey: () => 'sb-test-auth-token',
}));

describe('LoginPage Component — Test OTP Bypass & Standard Auth', () => {
  it('defines HARDCODED_TEST_OTP as 000000 by default', () => {
    expect(HARDCODED_TEST_OTP).toBe('000000');
  });

  it('renders login screen with password tab and test OTP bypass tab', () => {
    const queryClient = new QueryClient();
    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(html).toContain('Sign In');
    expect(html).toContain('Password');
    expect(html).toContain('Test OTP Bypass');
    expect(html).toContain('data-testid="auth.email"');
    expect(html).toContain('data-testid="auth.password"');
    expect(html).toContain('data-testid="auth.submit"');
  });
});
