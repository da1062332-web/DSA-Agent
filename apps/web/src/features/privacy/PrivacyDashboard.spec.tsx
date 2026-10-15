// apps/web/src/features/privacy/PrivacyDashboard.spec.tsx
import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrivacyDashboard } from './PrivacyDashboard';
import { routes } from './routes';

function renderWithProviders(ui: React.ReactElement, initialPath = '/privacy') {
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

describe('PrivacyDashboard Frontend Component Rendering', () => {
  it('registers /privacy route correctly in feature routes table', () => {
    expect(routes).toHaveLength(1);
    expect(routes[0]?.path).toBe('/privacy');
  });

  it('renders PrivacyDashboard header and KPI metric titles', () => {
    const html = renderWithProviders(
      <Routes>
        <Route path="/privacy" element={<PrivacyDashboard />} />
      </Routes>,
      '/privacy',
    );

    expect(html).toContain('Privacy &amp; Consent Governance');
    expect(html).toContain('MOD-PRV');
    expect(html).toContain('ACTIVE CONSENTS');
    expect(html).toContain('WITHDRAWN CONSENTS');
    expect(html).toContain('DATA SHARING EVENTS');
    expect(html).toContain('DATA CLASSIFICATION');
  });

  it('renders all 5 privacy governance tabs', () => {
    const html = renderWithProviders(
      <Routes>
        <Route path="/privacy" element={<PrivacyDashboard />} />
      </Routes>,
      '/privacy',
    );

    expect(html).toContain('Data Sharing Inventory (ENT-100)');
    expect(html).toContain('Consent Verification Auditor');
    expect(html).toContain('Data Classification &amp; Masking');
    expect(html).toContain('Retention &amp; Legal Hold (OD-008)');
    expect(html).toContain('Data-Principal Rights (DSR)');
  });
});
