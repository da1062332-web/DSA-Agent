import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProductCataloguePage } from './ProductCataloguePage';
import { ProductDetailPage } from './ProductDetailPage';

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
      <MemoryRouter initialEntries={[initialPath]}>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Loan Products Frontend Components & API Compatibility', () => {
  it('ProductCataloguePage renders catalogue title, search, category filter, and Add Product dialog controls', () => {
    const html = renderWithProviders(<ProductCataloguePage />);
    expect(html).toContain('Loan Product Catalogue');
    expect(html).toContain('Module 15 / 29');
    expect(html).toContain('Search Products');
    expect(html).toContain('Category');
    expect(html).toContain('Lender');
  });

  it('ProductDetailPage renders loading spinner or version history when mounted', () => {
    const html = renderWithProviders(
      <Routes>
        <Route path="/products/:id" element={<ProductDetailPage />} />
      </Routes>,
      '/products/prd_test_001',
    );
    expect(html).toBeDefined();
    expect(html).toContain('MuiCircularProgress-root');
  });

  it('fetchProductById queries canonical endpoint /v1/products/:id', async () => {
    const { fetchProductById } = await import('./api');
    const { apiFetch } = await import('../../api/client');
    const mockApiFetch = vi.mocked(apiFetch);

    await fetchProductById('prd_001');
    expect(mockApiFetch).toHaveBeenCalledWith('/v1/products/prd_001');
  });

  it('updateProductStatus calls /v1/products/:id/status with new status', async () => {
    const { updateProductStatus } = await import('./api');
    const { apiFetch } = await import('../../api/client');
    const mockApiFetch = vi.mocked(apiFetch);

    await updateProductStatus('prd_001', 'INACTIVE');
    expect(mockApiFetch).toHaveBeenCalledWith('/v1/products/prd_001/status', {
      method: 'POST',
      body: { status: 'INACTIVE' },
    });
  });
});

