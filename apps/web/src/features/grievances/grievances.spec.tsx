import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GrievancesPage } from './GrievancesPage';

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

describe('Grievances Frontend Components Rendering', () => {
  it('GrievancesPage renders header, Deferred R2 warning notice, and queue tab', () => {
    const html = renderWithProviders(<GrievancesPage />);
    expect(html).toContain('Grievances &amp; Customer Complaints');
    expect(html).toContain('Deferred R2 / TASK-427');
    expect(html).toContain('Canonical Scope Notice');
    expect(html).toContain('1. Complaint Queue &amp; SLA Tracking (CMP-GRV.02.1)');
    expect(html).toContain('2. Complaint Intake Form (CMP-GRV.01.1)');
  });

  it('GrievancesPage clearly flags intake form as preview under TASK-427 without live backend submission', () => {
    const html = renderWithProviders(<GrievancesPage initialTab={1} />);
    expect(html).toContain('TASK-427');
    expect(html).toContain('Generate Acknowledgement Reference (Preview)');
  });

});

