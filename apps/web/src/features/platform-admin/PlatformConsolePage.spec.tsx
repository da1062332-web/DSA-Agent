import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlatformConsolePage } from './PlatformConsolePage';
import { routes } from './routes';

function renderWithProviders(ui: React.ReactElement, initialPath = '/platform-admin') {
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

describe('PlatformConsolePage Frontend Component Rendering', () => {
  it('registers /platform-admin and /platform-console routes in feature routes table, plus the tenant page under each', () => {
    expect(routes).toHaveLength(4);
    expect(routes[0]?.path).toBe('/platform-admin');
    expect(routes[1]?.path).toBe('/platform-console');
    expect(routes[2]?.path).toBe('/platform-admin/tenants/:tenantId');
    expect(routes[3]?.path).toBe('/platform-console/tenants/:tenantId');
  });

  it('renders PlatformConsolePage header, badge, and zero business data security callout', () => {
    const html = renderWithProviders(
      <Routes>
        <Route path="/platform-admin" element={<PlatformConsolePage />} />
      </Routes>,
      '/platform-admin',
    );

    expect(html).toContain('Platform Operations &amp; Administration');
    expect(html).toContain('Zero Business Data Projection');
  });

  it('renders the 7 platform submodule tabs (data corrections belong to the customer tenant, see /approvals)', () => {
    const html = renderWithProviders(
      <Routes>
        <Route path="/platform-admin" element={<PlatformConsolePage />} />
      </Routes>,
      '/platform-admin',
    );

    expect(html).toContain('Tenants (Console)');
    expect(html).toContain('Feature Flags');
    expect(html).toContain('Master Data');
    expect(html).toContain('Background Jobs');
    expect(html).toContain('System Health');
    expect(html).toContain('Support Access (Break-Glass)');
    expect(html).not.toContain('Data Corrections');
    expect(html).toContain('Release Management');
  });

  it('renders initial tenant overview directory card', () => {
    const html = renderWithProviders(
      <Routes>
        <Route path="/platform-admin" element={<PlatformConsolePage />} />
      </Routes>,
      '/platform-admin',
    );

    expect(html).toContain('Registered Tenants Directory (API-TEN-002)');
    expect(html).toContain(
      'Under tenant isolation policies, no individual leads, loans, or customer financial records are accessed or exposed',
    );
  });
});
