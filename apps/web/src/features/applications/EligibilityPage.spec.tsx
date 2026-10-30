// Eligibility screen (owner: Dev 3; DSA Notion MODULE 17). The list comes from a mocked hook, so the rendered rows can be checked,
// including the missing-value cases that used to show as ₹0 and 36 months.
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as useMeModule from '../../api/useMe';
import { EligibilityPage } from './EligibilityPage';

const list = vi.hoisted(() => ({ rows: [] as unknown[], pending: false }));

vi.mock('../../api/useMe', async () => {
  const actual = await vi.importActual<typeof useMeModule>('../../api/useMe');
  return { ...actual, useMe: vi.fn() };
});

vi.mock('../admin/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useList: () => ({
    data: { pages: [{ data: list.rows }] },
    isPending: list.pending,
    isFetchingNextPage: false,
    hasNextPage: false,
    error: null,
    fetchNextPage: () => undefined,
  }),
  useLookup: () => ({ data: [], isPending: false, error: null }),
  useResource: () => ({ data: undefined, error: null, isPending: false }),
  useCommand: () => ({ mutate: () => undefined, isPending: false, error: null }),
}));

const application = (over: Record<string, unknown> = {}) => ({
  id: 'app_1',
  customerId: 'cust_1',
  applicantType: 'SALARIED',
  status: 'UNDER_REVIEW',
  requestedAmount: '300000.00',
  currency: 'INR',
  tenureMonths: null,
  productVersionId: 'prv_1',
  createdAt: '2026-10-28T00:00:00Z',
  ...over,
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EligibilityPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Eligibility screen (MOD-ELG)', () => {
  const mockUseMe = vi.mocked(useMeModule.useMe);
  const grant = (...codes: string[]) =>
    mockUseMe.mockReturnValue({
      data: {
        id: 'usr_test',
        tenantId: 'ten_test',
        email: 'test@example.com',
        displayName: 'Test User',
        primaryBranchId: null,
        queueIds: [],
        grants: codes.map((code) => ({ code, scope: 'TENANT', branchIds: [] })),
        mfaVerifiedAt: null,
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useMeModule.useMe>);

  beforeEach(() => {
    list.rows = [];
    list.pending = false;
    grant('application.read');
  });

  it('TEST-ELG-UI-001 the page says what a check is, and does not claim credit matrices, FOIR or determinism', () => {
    const html = renderPage();
    expect(html).toContain('Preliminary checks of applications against the approved eligibility rules.');
    expect(html).toContain('a pending check is never a pass');
    expect(html).not.toMatch(/credit matrices|FOIR|deterministic|Engine/);
  });

  it('TEST-ELG-UI-002 a requested amount is shown in rupees, and a zero amount is shown as a zero, not as missing', () => {
    list.rows = [
      application({ requestedAmount: '300000.00' }),
      application({ id: 'app_2', requestedAmount: '0.00' }),
    ];
    const html = renderPage();
    expect(html).toContain('₹3,00,000.00');
    expect(html).toContain('₹0.00');
  });

  it('TEST-ELG-UI-003 a missing tenure is shown as not recorded, never as an invented 36 months', () => {
    list.rows = [application({ tenureMonths: null })];
    const html = renderPage();
    expect(html).toContain('Not recorded');
    expect(html).not.toMatch(/36 ?m(onths)?\b/);
  });

  it('TEST-ELG-UI-004 the screen says how many applications it has loaded, not a total it cannot know', () => {
    list.rows = [application(), application({ id: 'app_2' })];
    const html = renderPage();
    expect(html).toContain('2 applications loaded');
    expect(html).not.toMatch(/Sanctioned|Configured products/);
  });

  it('TEST-ELG-UI-005 an empty or loading list says so, and a user without the read permission is told why', () => {
    expect(renderPage()).toContain('No applications match this filter.');
    list.pending = true;
    expect(renderPage()).toContain('Loading applications');
    list.pending = false;
    grant();
    expect(renderPage()).toContain('You need the application read permission');
  });

  it('TEST-ELG-UI-006 the override capability is named only for users who hold eligibility.override', () => {
    grant('application.read', 'eligibility.override');
    expect(renderPage()).toContain('Can record overrides');
    grant('application.read');
    expect(renderPage()).toContain('Read only');
  });
});
