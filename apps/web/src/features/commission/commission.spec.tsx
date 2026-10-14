import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommissionDashboardPage } from './CommissionDashboardPage';

vi.mock('../../api/client', () => ({
  apiFetch: vi.fn(),
  errorText: (e: any) => String(e),
}));

vi.mock('../../api/useMe', () => ({
  useMe: () => ({
    data: {
      id: 'usr_mock_001',
      displayName: 'Bhushan Dev',
      grants: [
        { code: 'commission.plan.edit', scope: 'TENANT', branchIds: [] },
        { code: 'commission.plan.approve', scope: 'TENANT', branchIds: [] },
        { code: 'adjustment.create', scope: 'TENANT', branchIds: [] },
        { code: 'adjustment.approve', scope: 'TENANT', branchIds: [] },
      ],
    },
  }),
  hasPermission: () => true,
}));


function renderWithProviders(ui: React.ReactElement, initialPath = '/') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Commission Management Frontend Components & API Compatibility', () => {
  it('CommissionDashboardPage renders header, 3 tabs, and action buttons', () => {
    const html = renderWithProviders(<CommissionDashboardPage />);
    expect(html).toContain('Commission Management Hub');
    expect(html).toContain('Module 29 / 30 Part A');
    expect(html).toContain('1. Commission Plans (CMP-COM.01.1)');
    expect(html).toContain('2. Calculations &amp; Connector Payables (CMP-COM.02.1)');
    expect(html).toContain('3. Recalculation Proposals (CMP-COM.05.1)');
  });

  it('approveCommissionPlan passes lockVersion for If-Match and body comment', async () => {
    const { approveCommissionPlan } = await import('./api');
    const { apiFetch } = await import('../../api/client');
    const mockApiFetch = vi.mocked(apiFetch);

    // Call approveCommissionPlan with version
    await approveCommissionPlan('cpl_001', 3, 'Approved by checker');
    expect(mockApiFetch).toHaveBeenCalledWith('/v1/commission-plans/cpl_001/approval', {
      method: 'POST',
      version: 3,
      body: { comment: 'Approved by checker' },
    });
  });

  it('rejectClawback passes mandatory reason payload', async () => {
    const { rejectClawback } = await import('./api');
    const { apiFetch } = await import('../../api/client');
    const mockApiFetch = vi.mocked(apiFetch);

    await rejectClawback('adj_001', 'Insufficient evidence');
    expect(mockApiFetch).toHaveBeenCalledWith('/v1/clawbacks/adj_001/rejection', {
      method: 'POST',
      body: { reason: 'Insufficient evidence' },
    });
  });

  it('approveRecalculationProposal passes approval comment', async () => {
    const { approveRecalculationProposal } = await import('./api');
    const { apiFetch } = await import('../../api/client');
    const mockApiFetch = vi.mocked(apiFetch);

    await approveRecalculationProposal('recp_001', 'Rate revision verified');
    expect(mockApiFetch).toHaveBeenCalledWith('/v1/recalculation-proposals/recp_001/approval', {
      method: 'POST',
      body: { comment: 'Rate revision verified' },
    });
  });

  it('fetchRecalculationProposals queries canonical endpoint /v1/recalculation-proposals', async () => {
    const { fetchRecalculationProposals } = await import('./api');
    const { apiFetch } = await import('../../api/client');
    const mockApiFetch = vi.mocked(apiFetch);

    await fetchRecalculationProposals();
    expect(mockApiFetch).toHaveBeenCalledWith('/v1/recalculation-proposals');
  });
});

