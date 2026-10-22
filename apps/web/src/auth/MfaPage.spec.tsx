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
          data: { all: [], totp: [] },
          error: null,
        }),
        enroll: vi.fn().mockResolvedValue({
          data: { id: 'factor_1', totp: { qr_code: '<svg></svg>', secret: 'TEST-SECRET' } },
          error: null,
        }),
        challengeAndVerify: vi.fn().mockResolvedValue({ error: null }),
      },
    },
  }),
  saveBypassSession: vi.fn(),
  getStorageKey: () => 'sb-test-auth-token',
}));

describe('MfaPage Component — Dedicated Setup Two-Step Verification View', () => {
  it('renders Set up two-step verification screen with barcode and input', () => {
    const queryClient = new QueryClient();
    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <MfaPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(html).toContain('Set up two-step verification');
    expect(html).toContain(
      'Your role requires an authenticator app. Scan the barcode, then enter the 6 digits it shows.',
    );
    expect(html).toContain('data-testid="auth.mfa.code"');
    expect(html).toContain('data-testid="auth.mfa.submit"');
    expect(html).toContain('data-testid="auth.mfa.secret"');
    // Ensure challenge screen and re-enroll button are not rendered
    expect(html).not.toContain('Scan New Barcode / Re-enroll');
  });
});
