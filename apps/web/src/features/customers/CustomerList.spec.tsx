import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CustomerListPage } from './CustomerListPage';
import { CustomerDetailPage } from './CustomerDetailPage';

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

describe('Customer UI Frontend Components Rendering (MOD-CUST)', () => {
  it('renders CustomerListPage with header, stat cards, and search input', () => {
    const html = renderWithProviders(
      <Routes>
        <Route path="/customers" element={<CustomerListPage />} />
      </Routes>,
      '/customers',
    );
    expect(html).toBeDefined();
    expect(html).toContain('Customers');
    expect(html).toContain('Borrower party profiles');
    expect(html).toContain('Total Profiles');
    expect(html).toContain('customer-search-input');
  });

  it('renders CustomerDetailPage in loading state initially when mounted', () => {
    const html = renderWithProviders(
      <Routes>
        <Route path="/customers/:id" element={<CustomerDetailPage />} />
      </Routes>,
      '/customers/cust_test_999',
    );
    expect(html).toBeDefined();
    expect(html).toContain('MuiCircularProgress-root');
  });
});
