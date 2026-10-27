import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from './LoginPage';
import { testOtp } from './test-auth';

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

describe('LoginPage Component — Clean Sign In UI', () => {
  it('the fixed test code is 000000 by default', () => {
    expect(testOtp()).toBe('000000');
  });

  it('renders clean standard sign in screen with email, password, and submit', () => {
    const queryClient = new QueryClient();
    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(html).toContain('Sign In');
    expect(html).toContain('Use your work email and password');
    expect(html).toContain('data-testid="auth.email"');
    expect(html).toContain('data-testid="auth.password"');
    expect(html).toContain('data-testid="auth.submit"');
    expect(html).toContain('data-testid="auth.forgot"');
    // Unwanted elements (tabs, dropdowns) are not present
    expect(html).not.toContain('Test OTP Bypass');
    expect(html).not.toContain('Quick Select User');
  });
});
