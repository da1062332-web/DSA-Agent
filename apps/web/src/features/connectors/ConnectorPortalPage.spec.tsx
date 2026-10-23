import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorPortalPage } from './ConnectorPortalPage';
import * as useMeModule from '../../api/useMe';

vi.mock('../../api/useMe', async () => {
  const actual = await vi.importActual<typeof useMeModule>('../../api/useMe');
  return {
    ...actual,
    useMe: vi.fn(),
  };
});

function renderConnectorPortalPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ConnectorPortalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Module 28 — ConnectorPortalPage Component Rendering & Workflows', () => {
  const mockUseMe = vi.mocked(useMeModule.useMe);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockGrants(grants: string[]) {
    mockUseMe.mockReturnValue({
      data: {
        id: 'usr_connector_01',
        tenantId: 'ten_test',
        email: 'connector@partner.com',
        displayName: 'Partner Connector',
        primaryBranchId: 'br_main',
        queueIds: [],
        grants: grants.map((code) => ({ code, scope: 'TENANT', branchIds: [] })),
        mfaVerifiedAt: null,
      },
      isLoading: false,
      isError: false,
    } as any);
  }

  it('renders Connector Partner Portal header, tabs, and partner scope', () => {
    mockGrants(['connector.read']);
    const html = renderConnectorPortalPage();

    expect(html).toContain('Connector Partner Portal');
    expect(html).toContain('MOD-CPT: Manage referred leads');
    expect(html).toContain('My Referrals');
    expect(html).toContain('Commission Statements');
  });

  it('renders KPI summary cards for connector performance', () => {
    mockGrants(['connector.read']);
    const html = renderConnectorPortalPage();

    expect(html).toContain('TOTAL REFERRALS');
    expect(html).toContain('ACCUMULATED COMMISSION');
    expect(html).toContain('ELIGIBLE FOR PAYOUT');
  });

  it('renders referral and payout action triggers', () => {
    mockGrants(['connector.read']);
    const html = renderConnectorPortalPage();

    expect(html).toContain('Request Payout');
    expect(html).toContain('Submit Referral');
    expect(html).toContain('Loading referrals...');
  });
});
