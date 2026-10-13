import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CustomerConsents } from './CustomerConsents';

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

describe('CustomerConsents Frontend Component Rendering', () => {
  it('renders CustomerConsents in loading/query container when mounted', () => {
    const html = renderWithProviders(
      <Routes>
        <Route path="/customers/:id/consents" element={<CustomerConsents />} />
      </Routes>,
      '/customers/cust_test_123/consents',
    );
    expect(html).toBeDefined();
    expect(html).toContain('MuiCircularProgress-root');
  });
});
