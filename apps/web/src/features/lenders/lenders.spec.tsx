import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LenderListPage } from './LenderListPage';
import { LenderDetailPage } from './LenderDetailPage';

vi.mock('../../api/client', () => ({
  apiFetch: vi.fn(),
  errorText: (e: any) => String(e),
}));

vi.mock('../../api/useMe', () => ({
  useMe: () => ({
    data: {
      id: 'usr_mock_001',
      displayName: 'Bhushan Dev',
      grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }],
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

describe('Lender Management Frontend Components & API Compatibility', () => {
  it('LenderListPage renders directory header, search, filters, and Add Lender button', () => {
    const html = renderWithProviders(<LenderListPage />);
    expect(html).toContain('Lender Directory');
    expect(html).toContain('Lender standing');
    expect(html).toContain('Search Lenders');
    expect(html).toContain('Status');
    expect(html).toContain('Type');
  });

  it('LenderDetailPage renders loading container or lender layout when mounted', () => {
    const html = renderWithProviders(
      <Routes>
        <Route path="/lenders/:id" element={<LenderDetailPage />} />
      </Routes>,
      '/lenders/lnd_test_001',
    );
    expect(html).toBeDefined();
    expect(html).toContain('MuiCircularProgress-root');
  });

  it('setLenderContacts sends PUT /v1/lenders/:id/contacts with version for If-Match', async () => {
    const { setLenderContacts } = await import('./api');
    const { apiFetch } = await import('../../api/client');
    const mockApiFetch = vi.mocked(apiFetch);

    const contacts = [
      {
        name: 'Jane Doe',
        role: 'Relationship Manager',
        email: 'jane@lender.com',
        phone: '9876543210',
        channel: 'EMAIL' as const,
        escalationLevel: 1,
      },
    ];

    await setLenderContacts('lnd_001', 2, { contacts });
    expect(mockApiFetch).toHaveBeenCalledWith('/v1/lenders/lnd_001/contacts', {
      method: 'PUT',
      version: 2,
      body: { contacts },
    });
  });

  it('createEmpanelment sends POST /v1/lenders/:id/empanelments with dsaCode', async () => {
    const { createEmpanelment } = await import('./api');
    const { apiFetch } = await import('../../api/client');
    const mockApiFetch = vi.mocked(apiFetch);

    await createEmpanelment('lnd_001', { dsaCode: 'DSA_MUM_01' });
    expect(mockApiFetch).toHaveBeenCalledWith('/v1/lenders/lnd_001/empanelments', {
      method: 'POST',
      body: { dsaCode: 'DSA_MUM_01' },
    });
  });
});
