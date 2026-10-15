// apps/web/src/features/integrations/IntegrationsPage.spec.tsx
import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntegrationsPage } from './IntegrationsPage';
import { routes } from './routes';

function renderWithProviders(ui: React.ReactElement, initialPath = '/integrations') {
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

describe('IntegrationsPage Frontend Component Rendering', () => {
  it('registers /integrations and /admin/integrations routes in feature routes table', () => {
    expect(routes).toHaveLength(2);
    expect(routes[0]?.path).toBe('/integrations');
    expect(routes[1]?.path).toBe('/admin/integrations');
  });

  it('renders IntegrationsPage header banner, chips, and security callout', () => {
    const html = renderWithProviders(
      <Routes>
        <Route path="/integrations" element={<IntegrationsPage />} />
      </Routes>,
      '/integrations',
    );

    expect(html).toContain('Integration Management &amp; Adapter Framework');
    expect(html).toContain('MOD-INT');
    expect(html).toContain('DOM-M');
    expect(html).toContain('SUB-INT.01');
    expect(html).toContain('Classification S4 Protection');
    expect(html).toContain('credential_ref');
  });

  it('renders summary metric titles', () => {
    const html = renderWithProviders(
      <Routes>
        <Route path="/integrations" element={<IntegrationsPage />} />
      </Routes>,
      '/integrations',
    );

    expect(html).toContain('CONFIGURED INTEGRATIONS');
    expect(html).toContain('ACTIVE ADAPTERS');
    expect(html).toContain('OPERATIONAL HEALTH');
    expect(html).toContain('STANDARDIZED CAPABILITIES');
  });

  it('renders declared platform capability descriptors section', () => {
    const html = renderWithProviders(
      <Routes>
        <Route path="/integrations" element={<IntegrationsPage />} />
      </Routes>,
      '/integrations',
    );

    expect(html).toContain('Declared Platform Capability Descriptors');
    expect(html).toContain('Standardized capabilities supported by the DSA CRM Adapter Framework');
  });
});
