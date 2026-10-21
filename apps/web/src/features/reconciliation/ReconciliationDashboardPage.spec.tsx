import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReconciliationDashboardPage } from './ReconciliationDashboardPage';
import * as useMeModule from '../../api/useMe';

vi.mock('../../api/useMe', async () => {
  const actual = await vi.importActual<typeof useMeModule>('../../api/useMe');
  return {
    ...actual,
    useMe: vi.fn(),
  };
});

function renderReconciliationPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ReconciliationDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Module 24 — ReconciliationDashboardPage Permission Guarding', () => {
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

  it('renders reconciliation header but hides mutating actions for view-only users', () => {
    mockGrants(['finance.view']);
    const html = renderReconciliationPage();

    expect(html).toContain('Reconciliation Management');
    expect(html).not.toContain('rec.btn.import-modal');
    expect(html).not.toContain('rec.btn.propose-adj-modal');
    expect(html).not.toContain('rec.btn.raise-dispute-modal');
  });

  it('renders ingest, propose, and dispute buttons when user possesses finance.reconcile', () => {
    mockGrants(['finance.view', 'finance.reconcile']);
    const html = renderReconciliationPage();

    expect(html).toContain('Reconciliation Management');
    expect(html).toContain('rec.btn.import-modal');
    expect(html).toContain('rec.btn.propose-adj-modal');
    expect(html).toContain('rec.btn.raise-dispute-modal');
  });
});
