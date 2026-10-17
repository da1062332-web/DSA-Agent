import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PayoutsDashboardPage } from './PayoutsDashboardPage';

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
        { code: 'payout.request', scope: 'TENANT', branchIds: [] },
        { code: 'payout.approve', scope: 'TENANT', branchIds: [] },
        { code: 'payout.record_payment', scope: 'TENANT', branchIds: [] },
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
      <MemoryRouter initialEntries={[initialPath]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Payouts Management Frontend Components & API Compatibility', () => {
  it('PayoutsDashboardPage renders header, 3 tabs, and create payout request controls', () => {
    const html = renderWithProviders(<PayoutsDashboardPage />);
    expect(html).toContain('Payouts &amp; Settlement Hub');
    expect(html).toContain('Module 31 / 30 Part B');
    expect(html).toContain('1. Payout Requests');
    expect(html).toContain('2. Approval Queue');
    expect(html).toContain('3. Payment Recording &amp; Batches');
  });

  it('cancelPayoutRequest passes mandatory reason payload to /v1/payout-requests/:id/cancel', async () => {
    const { cancelPayoutRequest } = await import('./api');
    const { apiFetch } = await import('../../api/client');
    const mockApiFetch = vi.mocked(apiFetch);

    await cancelPayoutRequest('prq_001', 'Connector bank changed');
    expect(mockApiFetch).toHaveBeenCalledWith('/v1/payout-requests/prq_001/cancel', {
      method: 'POST',
      body: { reason: 'Connector bank changed' },
    });
  });

  it('recordPayoutPayment passes paymentRef payload to /v1/payout-requests/:id/payment', async () => {
    const { recordPayoutPayment } = await import('./api');
    const { apiFetch } = await import('../../api/client');
    const mockApiFetch = vi.mocked(apiFetch);

    await recordPayoutPayment('prq_001', { paymentRef: 'UTR9988776655' });
    expect(mockApiFetch).toHaveBeenCalledWith('/v1/payout-requests/prq_001/payment', {
      method: 'POST',
      body: { paymentRef: 'UTR9988776655' },
    });
  });

  it('recordPayoutFailure passes failureReason payload to /v1/payout-requests/:id/payment-failure', async () => {
    const { recordPayoutFailure } = await import('./api');
    const { apiFetch } = await import('../../api/client');
    const mockApiFetch = vi.mocked(apiFetch);

    await recordPayoutFailure('prq_001', { failureReason: 'Beneficiary account frozen' });
    expect(mockApiFetch).toHaveBeenCalledWith('/v1/payout-requests/prq_001/payment-failure', {
      method: 'POST',
      body: { failureReason: 'Beneficiary account frozen' },
    });
  });

  it('createPayoutBatch passes payoutIds array to /v1/payout-batches', async () => {
    const { createPayoutBatch } = await import('./api');
    const { apiFetch } = await import('../../api/client');
    const mockApiFetch = vi.mocked(apiFetch);

    await createPayoutBatch({ payoutIds: ['prq_001', 'prq_002'] });
    expect(mockApiFetch).toHaveBeenCalledWith('/v1/payout-batches', {
      method: 'POST',
      body: { payoutIds: ['prq_001', 'prq_002'] },
    });
  });
});
