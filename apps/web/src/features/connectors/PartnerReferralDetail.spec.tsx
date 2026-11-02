// The partner's referral detail: progress on approved steps, the documents requested, and when a document may be sent (TEST-CPT-UI-DET).
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { PartnerReferralDetail } from './PartnerReferralDetail';
import type { PortalDocumentList, PortalReferralDetail } from './portal-model';

const referral: PortalReferralDetail = {
  id: 'lead_1',
  name: 'R******* P*******',
  mobileMasked: 'XXXXXX0901',
  productCategory: 'PL',
  status: 'IN_PROGRESS',
  steps: [
    { key: 'SUBMITTED', label: 'Submitted', done: true, current: false },
    { key: 'UNDER_REVIEW', label: 'Under review', done: false, current: true },
  ],
  submittedAt: '2026-11-01T00:00:00.000Z',
  lastUpdatedAt: '2026-11-02T00:00:00.000Z',
};

const docsItem = {
  checklistItemId: 'chk_1',
  documentName: 'PAN card',
  allowedMime: ['application/pdf'],
  maxSizeBytes: 10 * 1024 * 1024,
  status: 'ACTION_REQUIRED' as const,
  actionRequired: true,
};

const render = (docs: PortalDocumentList) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['/portal/v1/referrals', 'lead_1'], referral);
  qc.setQueryData(['/portal/v1/referrals', 'lead_1', 'documents'], docs);
  return renderToString(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PartnerReferralDetail leadId="lead_1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('partner referral detail (TEST-CPT-UI-DET)', () => {
  it('TEST-CPT-UI-DET-01 the progress shows the approved steps, and no internal state name or identifier of a document is shown', () => {
    const html = render({ uploadAvailable: true, unavailableReason: null, items: [] });
    expect(html).toContain('Submitted');
    expect(html).toContain('Under review');
    expect(html).toContain('XXXXXX0901');
    expect(html).not.toContain('IN_PROGRESS');
    expect(html).not.toContain('UNDER_REVIEW');
    expect(html).toContain('No documents are requested for this referral.');
  });

  it('TEST-CPT-UI-DET-02 a document that needs action can be sent when uploads are available, and cannot be when they are not', () => {
    const available = render({ uploadAvailable: true, unavailableReason: null, items: [docsItem] });
    expect(available).toContain('Send file');
    expect(available).toContain('data-testid="cpt.doc.send.chk_1"');

    const unavailable = render({
      uploadAvailable: false,
      unavailableReason: 'SCANNER_UNAVAILABLE',
      items: [docsItem],
    });
    expect(unavailable).not.toContain('Send file');
    expect(unavailable).toContain('temporarily unavailable');
  });

  it('TEST-CPT-UI-DET-03 a document that is already received or accepted is not offered for sending, and no download is offered', () => {
    const received = render({
      uploadAvailable: true,
      unavailableReason: null,
      items: [{ ...docsItem, status: 'PENDING_REVIEW', actionRequired: false }],
    });
    expect(received).toContain('Received, under review');
    expect(received).not.toContain('Send file');
    const html = render({ uploadAvailable: true, unavailableReason: null, items: [docsItem] });
    expect(html.toLowerCase()).not.toContain('download');
  });

  it('TEST-CPT-UI-DET-04 when no document is approved for partners, the partner is told uploads are not available', () => {
    const html = render({ uploadAvailable: false, unavailableReason: 'NO_APPROVED_TYPES', items: [] });
    expect(html).toContain('not currently available');
    expect(html).not.toContain('Send file');
  });
});
