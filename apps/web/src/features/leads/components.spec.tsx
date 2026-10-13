import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LeadList } from './LeadList';
import { LeadCreate } from './LeadCreate';
import { LeadDetail } from './LeadDetail';

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

describe('Leads Frontend Components Rendering', () => {
  it('LeadList renders title, create button, and filter controls', () => {
    const html = renderWithProviders(<LeadList />);
    expect(html).toContain('Leads');
    expect(html).toContain('Create Lead');
    expect(html).toContain('Owner User ID');
    expect(html).toContain('State');
  });

  it('LeadCreate renders form inputs and mandatory DPDP consent section', () => {
    const html = renderWithProviders(<LeadCreate />);
    expect(html).toContain('Create New Lead');
    expect(html).toContain('Full Name');
    expect(html).toContain('Mobile Number');
    expect(html).toContain('Product Category');
    expect(html).toContain('Indicative Amount');
    expect(html).toContain('Consent Details (DPDP Mandatory)');
    expect(html).toContain('Notice Version');
  });

  it('LeadDetail renders in loading/query container when mounted', () => {
    const html = renderWithProviders(
      <Routes>
        <Route path="/leads/:id" element={<LeadDetail />} />
      </Routes>,
      '/leads/lead_test_123',
    );
    expect(html).toBeDefined();
    // In server/mock mode without fetched data, CircularProgress or container is rendered
    expect(html).toContain('MuiCircularProgress-root');
  });
});
