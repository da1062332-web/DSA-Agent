// apps/web/src/features/sanctions/SanctionsPanel.spec.tsx — owner: Dev 3 (MOD-SND UI Tests)
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SanctionsPanel } from './SanctionsPanel';

function renderPanel(lenderCaseId = 'lcs_01JTESTCASE000000000000001') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SanctionsPanel lenderCaseId={lenderCaseId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Module 19 — SanctionsPanel Frontend Component', () => {
  it('renders SanctionsPanel loading state in initial SSR / server context', () => {
    const html = renderPanel();
    expect(html).toContain('sanctions-panel-loading');
    expect(html).toContain('MuiCircularProgress-root');
  });

  it('renders with custom lenderCaseId prop', () => {
    const html = renderPanel('lcs_custom_001');
    expect(html).toContain('sanctions-panel-loading');
  });

  it('renders input prompt when lenderCaseId is not provided', () => {
    const html = renderPanel('');
    expect(html).toContain('sanctions-panel');
    expect(html).toContain('Sanctions and Disbursements');
    expect(html).toContain('Please select a lender case');
  });
});
