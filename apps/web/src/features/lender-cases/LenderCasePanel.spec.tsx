// apps/web/src/features/lender-cases/LenderCasePanel.spec.tsx — owner: Dev 4 (UI-LCS-001 Automated Component Tests)
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LenderCasePanel } from './LenderCasePanel';

function renderPanel(applicationId = 'app_01JTESTAPP000000000000001') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LenderCasePanel applicationId={applicationId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Module 18 — LenderCasePanel Frontend Component (UI-LCS-001)', () => {
  it('renders LenderCasePanel container with title and action button', () => {
    const html = renderPanel();

    expect(html).toContain('Lender Attempts (MOD-LCS)');
    expect(html).toContain('+ New Lender Attempt');
    expect(html).toContain('Sequential and parallel lender submissions');
  });

  it('renders initial loading state when query is loading', () => {
    const html = renderPanel();

    expect(html).toContain('MuiCircularProgress-root');
  });
});
