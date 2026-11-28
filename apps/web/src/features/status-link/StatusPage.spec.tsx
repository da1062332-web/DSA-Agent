// The customer status page: the application details, the stage, the progress, the pending documents with their own labels, and the privacy
// of the rendered text (task P3-05, TEST-STATUS-UI-02). The rendered HTML is checked with the style block removed, so only the words on
// the page are read.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { StatusPage } from './StatusPage';
import type { PublicStatusView } from './status-view';

const TOKEN = 'tok_status_1';
const STEPS = ['Application started', 'Under processing', 'Under review', 'Submitted to lender', 'Approved', 'Disbursed'];

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

/** The words on the page: the markup without the injected style block. */
function pageText(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/g, '');
}

const processing: PublicStatusView = {
  application: { reference: 'DSA-7K2MQ-9XHTR', loanType: 'Home loan', appliedOn: '2026-11-03' },
  stage: 'Under processing',
  progress: { steps: STEPS, currentIndex: 1, closed: false },
  pendingDocuments: [{ name: 'Salary slip', status: 'PENDING', label: 'Pending' }],
  lastUpdated: '2026-11-26',
  expiresAt: '2026-12-03T00:00:00.000Z',
};

describe('TEST-STATUS-UI-02 the customer status page', () => {
  it('TEST-STATUS-UI-02 the acceptance view: the reference, the loan type, the stage, the pending salary slip and the last update', () => {
    const html = render(processing);
    expect(html).toContain('Your Application Status');
    expect(html).toContain('Application details');
    expect(html).toContain('DSA-7K2MQ-9XHTR');
    expect(html).toContain('Home loan');
    expect(html).toContain('3 Nov 2026');
    expect(html).toContain('data-testid="status.stage"');
    expect(html).toContain('Under processing');
    expect(html).toContain('Application progress');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('Salary slip');
    expect(html).toContain('Last updated 26 Nov 2026');
  });

  it('TEST-STATUS-UI-02 each pending document shows the label the API gave it, and its own tone', () => {
    const html = render({
      ...processing,
      pendingDocuments: [
        { name: 'Bank statement', status: 'REJECTED', label: 'Resubmit required' },
        { name: 'Income proof (Co-applicant)', status: 'EXPIRED', label: 'Renewal required' },
        { name: 'PAN card', status: 'PENDING', label: 'Pending' },
      ],
    });
    expect(html).toContain('Resubmit required');
    expect(html).toContain('Renewal required');
    expect(html).toContain('Income proof (Co-applicant)');
    expect(html.match(/data-status="REJECTED"/g)).toHaveLength(1);
    expect(html.match(/data-status="EXPIRED"/g)).toHaveLength(1);
    expect(html.match(/data-status="PENDING"/g)).toHaveLength(1);
  });

  it('TEST-STATUS-UI-02 the progress marks the step reached, and a closed application shows Closed with no steps', () => {
    const html = render({ ...processing, progress: { steps: STEPS, currentIndex: 2, closed: false } });
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain('data-testid="status.progress"');

    const closed = render({
      ...processing,
      stage: 'Closed',
      progress: { steps: STEPS, currentIndex: null, closed: true },
    });
    expect(closed).toContain('Closed');
    expect(closed).not.toContain('data-testid="status.progress"');
  });

  it('TEST-STATUS-UI-02 with no pending documents the page says so, and shows no Pending list', () => {
    const html = render({ ...processing, pendingDocuments: [] });
    expect(html).toContain('No pending documents');
    expect(html).not.toContain('data-testid="status.pending"');
  });

  it('TEST-STATUS-UI-02 has no sidebar or internal navigation, and carries the footer and the support line', () => {
    const text = pageText(render(processing));
    expect(text).not.toContain('<nav');
    expect(text).toContain('This page displays limited application information.');
    expect(text).toContain('For assistance, please contact your relationship manager.');
  });

  it('TEST-STATUS-UI-02 shows nothing that names the customer or the internal application, and no technical identifiers', () => {
    const text = pageText(render(processing));
    expect(text).not.toMatch(/\b(mobile|email|PAN|Aadhaar|DOB|amount|app_|cust_|tok_)\b/i);
    expect(text).not.toMatch(/\b\d{9,}\b/);
  });
});
