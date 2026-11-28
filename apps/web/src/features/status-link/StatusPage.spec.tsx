// The customer status page renders the acceptance view and no sidebar (task P3-05, TEST-STATUS-UI-02).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { StatusPage } from './StatusPage';
import type { PublicStatusView } from './status-view';

const TOKEN = 'tok_status_1';

function render(view: PublicStatusView): string {
  const queryClient = new QueryClient();
  queryClient.setQueryData(['public-status', TOKEN], view);
  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/status/${TOKEN}`]}>
        <Routes>
          <Route path="/status/:token" element={<StatusPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TEST-STATUS-UI-02 the customer status page', () => {
  it('TEST-STATUS-UI-02 the acceptance view: the stage, the pending salary slip and the last update', () => {
    const html = render({
      stage: 'Under processing',
      pendingDocuments: ['Salary slip'],
      lastUpdated: '2026-11-26',
      expiresAt: '2026-12-03T00:00:00.000Z',
    });
    expect(html).toContain('Under processing');
    expect(html).toContain('Pending: Salary slip');
    expect(html).toContain('Last updated 26 Nov 2026');
  });

  it('TEST-STATUS-UI-02 has no sidebar or navigation, and shows nothing that names the customer', () => {
    const html = render({
      stage: 'Under review',
      pendingDocuments: [],
      lastUpdated: '2026-11-26',
      expiresAt: '2026-12-03T00:00:00.000Z',
    });
    // Only the page text counts: the injected style block and tag names such as <span> are not words on the page.
    const text = html.replace(/<style[\s\S]*?<\/style>/g, '');
    expect(text).not.toContain('<nav');
    expect(text).not.toContain('Pending:');
    expect(text).not.toMatch(/\b(mobile|email|PAN|DOB)\b/i);
  });
});
