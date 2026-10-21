// apps/web/src/features/lender-cases/LenderCasePanel.spec.tsx — owner: Dev 4 (UI-LCS-001 Automated Component Tests)
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LenderCasePanel } from './LenderCasePanel';
import * as useMeModule from '../../api/useMe';

vi.mock('../../api/useMe', async () => {
  const actual = await vi.importActual<typeof useMeModule>('../../api/useMe');
  return {
    ...actual,
    useMe: vi.fn(),
  };
});

function renderPanel(applicationId = 'app_01JTESTAPP000000000000001') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LenderCasePanel applicationId={applicationId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Module 18 — LenderCasePanel Frontend Component (UI-LCS-001)', () => {
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

  it('renders LenderCasePanel container with title and hides action button for view-only users', () => {
    mockGrants(['application.read']);
    const html = renderPanel();

    expect(html).toContain('Lender Attempts (MOD-LCS)');
    expect(html).not.toContain('+ New Lender Attempt');
    expect(html).toContain('Sequential and parallel lender submissions');
  });

  it('renders + New Lender Attempt when user has lender_case.submit', () => {
    mockGrants(['application.read', 'lender_case.submit']);
    const html = renderPanel();

    expect(html).toContain('Lender Attempts (MOD-LCS)');
    expect(html).toContain('+ New Lender Attempt');
  });

  it('renders initial loading state when query is loading', () => {
    mockGrants(['application.read']);
    const html = renderPanel();

    expect(html).toContain('MuiCircularProgress-root');
  });
});
