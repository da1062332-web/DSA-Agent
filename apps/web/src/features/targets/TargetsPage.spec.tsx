// apps/web/src/features/targets/TargetsPage.spec.tsx — owner: Dev 5 (MOD-PERF SUB-PERF.01 UI Tests)
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { TargetsPage } from './TargetsPage';

vi.mock('../../api/useMe', () => ({
  useMe: () => ({
    data: {
      id: 'usr_01JTESTUSER',
      grants: [{ code: 'target.manage', scope: 'TENANT', branchIds: [] }],
    },
    isLoading: false,
  }),
  hasPermission: () => true,
}));

function renderTargetsPage(initialPath = '/targets') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <TargetsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Module 20 — TargetsPage Frontend Component (MOD-PERF SUB-PERF.01)', () => {
  it('renders TargetsPage header and descriptions', () => {
    const html = renderTargetsPage();

    expect(html).toContain('Performance Targets (MOD-PERF SUB-PERF.01)');
    expect(html).toContain(
      'Operational target setting, version revisions, and dual-control approvals',
    );
  });

  it('renders status tabs: All, Pending Approval, Approved, Superseded, Rejected', () => {
    const html = renderTargetsPage();

    expect(html).toContain('All');
    expect(html).toContain('Pending Approval');
    expect(html).toContain('Approved');
    expect(html).toContain('Superseded');
    expect(html).toContain('Rejected');
  });

  it('renders filter controls for Period, Dimension Type, and Metric Code', () => {
    const html = renderTargetsPage();

    expect(html).toContain('Period (YYYY-MM or YYYY-Q#)');
    expect(html).toContain('Dimension Type');
    expect(html).toContain('Metric Code');
  });

  it('renders table headers for target attributes including actuals', () => {
    const html = renderTargetsPage();

    expect(html).toContain('Period');
    expect(html).toContain('Dimension');
    expect(html).toContain('Dimension ID');
    expect(html).toContain('Metric');
    expect(html).toContain('Target Value');
    expect(html).toContain('Actuals');
    expect(html).toContain('Ver');
    expect(html).toContain('Status');
    expect(html).toContain('Actions');
  });
});
