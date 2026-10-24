import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EligibilityPage } from './EligibilityPage';
import * as useMeModule from '../../api/useMe';

vi.mock('../../api/useMe', async () => {
  const actual = await vi.importActual<typeof useMeModule>('../../api/useMe');
  return {
    ...actual,
    useMe: vi.fn(),
  };
});

function renderEligibilityPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EligibilityPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Module 17 — EligibilityPage Component Rendering & Permissions', () => {
  const mockUseMe = vi.mocked(useMeModule.useMe);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockGrants(grants: string[]) {
    mockUseMe.mockReturnValue({
      data: {
        id: 'usr_test',
        tenantId: 'ten_test',
        email: 'test@example.com',
        displayName: 'Test User',
        primaryBranchId: null,
        queueIds: [],
        grants: grants.map((code) => ({ code, scope: 'TENANT', branchIds: [] })),
        mfaVerifiedAt: null,
      },
      isLoading: false,
      isError: false,
    } as any);
  }

  it('renders Eligibility Workspace header, descriptions, and evaluation triggers', () => {
    mockGrants(['application.read']);
    const html = renderEligibilityPage();

    expect(html).toContain('Credit &amp; Eligibility Engine');
    expect(html).toContain('Evaluate applicant financial criteria');
    expect(html).toContain('Loading applications...');
  });

  it('shows Supervisor Override action only when user holds eligibility.override', () => {
    mockGrants(['application.read', 'eligibility.override']);
    const html = renderEligibilityPage();

    expect(html).toContain('Supervisor Override');
  });

  it('hides Supervisor Override action when user lacks eligibility.override', () => {
    mockGrants(['application.read']);
    const html = renderEligibilityPage();

    expect(html).not.toContain('Supervisor Override');
  });

  it('renders application table headers and instructions for popup modal inspection', () => {
    mockGrants(['application.read']);
    const html = renderEligibilityPage();

    expect(html).toContain('Loan Applications');
    expect(html).toContain('popup');
  });
});
