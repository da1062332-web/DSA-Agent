import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as useMeModule from '../../api/useMe';
import { ArchiveCard, LegalHoldCard, OwnersCard, PartiesCard } from './ApplicationFileCards';
import { TransitionCard } from './ApplicationDetailPage';
import { ApplicationsPage, type Application } from './ApplicationsPage';

vi.mock('../../api/useMe', async () => {
  const actual = await vi.importActual<typeof useMeModule>('../../api/useMe');
  return { ...actual, useMe: vi.fn() };
});

const APP: Application = {
  id: 'app_1',
  customerId: 'cust_1',
  branchId: 'br_1',
  productCategory: 'PL',
  productVersionId: null,
  requestedAmount: '300000.00',
  currency: 'INR',
  tenureMonths: 36,
  purposeCode: null,
  applicantType: 'SALARIED',
  status: 'DRAFT',
  onHold: false,
  holdReason: null,
  holdUntil: null,
  reworkReason: null,
  salesOwnerId: 'usr_1',
  opsOwnerId: null,
  opsQueueId: null,
  version: 1,
  createdAt: '2026-10-28T00:00:00Z',
  updatedAt: '2026-10-28T00:00:00Z',
};

function render(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToString(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('application file cards (TEST-UI-APP-01 to 07)', () => {
  const mockUseMe = vi.mocked(useMeModule.useMe);
  const grant = (codes: string[]) =>
    mockUseMe.mockReturnValue({
      data: {
        id: 'usr_1',
        tenantId: 'ten_1',
        email: 'user@example.com',
        displayName: 'User',
        primaryBranchId: null,
        queueIds: [],
        grants: codes.map((code) => ({ code, scope: 'TENANT', branchIds: [] })),
        mfaVerifiedAt: null,
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useMeModule.useMe>);

  beforeEach(() => vi.clearAllMocks());

  it('TEST-UI-APP-01 the add-party form needs application.update and an editable status', () => {
    grant(['application.read', 'application.update']);
    expect(render(<PartiesCard app={APP} />)).toContain('data-testid="application.party-add"');
    const closed = render(<PartiesCard app={{ ...APP, status: 'SUBMITTED' }} />);
    expect(closed).not.toContain('data-testid="application.party-add"');
    expect(closed).toContain('Parties can change while the application is Draft');
    grant(['application.read']);
    expect(render(<PartiesCard app={APP} />)).not.toContain('data-testid="application.party-add"');
  });

  it('TEST-UI-APP-02 the owners card needs application.assign and a status that is not terminal', () => {
    grant(['application.read', 'application.assign']);
    expect(render(<OwnersCard app={APP} />)).toContain('data-testid="application.assign"');
    expect(render(<OwnersCard app={{ ...APP, status: 'WITHDRAWN' }} />)).toBe('');
    grant(['application.read']);
    expect(render(<OwnersCard app={APP} />)).toBe('');
  });

  it('TEST-UI-APP-03 the document archive needs document.download', () => {
    grant(['application.read', 'document.download']);
    expect(render(<ArchiveCard applicationId="app_1" />)).toContain(
      'data-testid="application.archive-request"',
    );
    grant(['application.read']);
    expect(render(<ArchiveCard applicationId="app_1" />)).toBe('');
  });

  it('TEST-UI-APP-04 the legal hold card needs privacy.manage', () => {
    grant(['application.read', 'privacy.manage']);
    expect(render(<LegalHoldCard applicationId="app_1" />)).toContain(
      'data-testid="application.legal-hold-place"',
    );
    grant(['application.read', 'application.update']);
    expect(render(<LegalHoldCard applicationId="app_1" />)).toBe('');
  });

  it('TEST-UI-APP-06 send back needs application.review: rework from Under review, back to review from Ready', () => {
    grant(['application.read', 'application.review']);
    const review = render(<TransitionCard app={{ ...APP, status: 'UNDER_REVIEW' }} />);
    expect(review).toContain('data-testid="application.send-back"');
    expect(review).toContain('Send back for rework');
    expect(render(<TransitionCard app={{ ...APP, status: 'READY_FOR_SUBMISSION' }} />)).toContain(
      'Send back to review',
    );
    expect(render(<TransitionCard app={{ ...APP, status: 'SUBMITTED' }} />)).not.toContain(
      'application.send-back',
    );
    grant(['application.read', 'application.update']);
    expect(render(<TransitionCard app={{ ...APP, status: 'UNDER_REVIEW' }} />)).not.toContain(
      'application.send-back',
    );
  });

  it('TEST-UI-APP-07 close needs application.close and a disbursed or terminal file', () => {
    grant(['application.read', 'application.close']);
    for (const status of ['DISBURSED', 'REJECTED', 'WITHDRAWN', 'CANCELLED'] as const) {
      expect(render(<TransitionCard app={{ ...APP, status }} />), status).toContain(
        'data-testid="application.close"',
      );
    }
    for (const status of ['DRAFT', 'SUBMITTED', 'PARTIALLY_DISBURSED', 'CLOSED'] as const) {
      expect(render(<TransitionCard app={{ ...APP, status }} />), status).not.toContain('application.close');
    }
    grant(['application.read', 'application.reopen']);
    expect(render(<TransitionCard app={{ ...APP, status: 'DISBURSED' }} />)).not.toContain(
      'application.close',
    );
  });

  it('TEST-UI-APP-05 the New application button needs application.create', () => {
    grant(['application.read', 'application.create']);
    expect(render(<ApplicationsPage />)).toContain('data-testid="applications.new"');
    grant(['application.read']);
    expect(render(<ApplicationsPage />)).not.toContain('data-testid="applications.new"');
  });
});
