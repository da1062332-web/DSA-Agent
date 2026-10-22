import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MfaPage } from './MfaPage';

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({
    session: { user: { email: 'rm1@alpha.com' } },
    aal: { current: 'aal1', next: 'aal2' },
    recovering: false,
    refreshAal: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock('./supabase', () => ({
  getSupabase: () => ({
    auth: {
      mfa: {
        listFactors: vi.fn().mockResolvedValue({
          data: { totp: [{ id: 'factor_1', factor_type: 'totp', status: 'verified' }] },
          error: null,
        }),
        challengeAndVerify: vi.fn().mockResolvedValue({ error: null }),
      },
    },
  }),
  saveBypassSession: vi.fn(),
  getStorageKey: () => 'sb-test-auth-token',
}));

describe('MfaPage Component — Hardcoded OTP and Original OTP', () => {
  it('renders OTP challenge screen correctly', () => {
    const queryClient = new QueryClient();
    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <MfaPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(html).toContain('Two-step verification');
  });
});
