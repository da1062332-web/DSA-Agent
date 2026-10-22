import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorPage } from './ConnectorPage';
import * as useMeModule from '../../api/useMe';

vi.mock('../../api/useMe', async () => {
  const actual = await vi.importActual<typeof useMeModule>('../../api/useMe');
  return {
    ...actual,
    useMe: vi.fn(),
  };
});

function renderConnectorPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ConnectorPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Module 27 — ConnectorPage Component Rendering & Action Guarding', () => {
  const mockUseMe = vi.mocked(useMeModule.useMe);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockGrants(grants: string[]) {
    mockUseMe.mockReturnValue({
      data: {
        id: 'usr_test',
        tenantId: 'ten_test',
        email: 'test@example.com',
        displayName: 'Test User',
        primaryBranchId: null,
        queueIds: [],
        grants: grants.map((code) => ({ code, scope: 'TENANT', branchIds: [] })),
        mfaVerifiedAt: null,
      },
      isLoading: false,
      isError: false,
    } as any);
  }

  it('renders ConnectorPage header and hides + Onboard Connector for view-only users', () => {
    mockGrants(['connector.read']);
    const html = renderConnectorPage();

    expect(html).toContain('Connector Management (MOD-CON)');
    expect(html).not.toContain('+ Onboard Connector');
  });

  it('renders + Onboard Connector when user has connector.manage', () => {
    mockGrants(['connector.read', 'connector.manage']);
    const html = renderConnectorPage();

    expect(html).toContain('Connector Management (MOD-CON)');
    expect(html).toContain('+ Onboard Connector');
  });

  it('renders clean top-level directory tabs without leaking connector-specific tabs onto main screen', () => {
    mockGrants(['connector.read', 'connector.manage']);
    const html = renderConnectorPage();

    expect(html).toContain('Directory &amp; Onboarding');
    expect(html).toContain('Attribution Requests');
    expect(html).toContain('Disputes &amp; Duplicate Referrals');
    // Connector-specific tabs are NOT rendered on the top-level main screen
    expect(html).not.toContain('Bank Accounts &amp; SOD (');
    expect(html).not.toContain('Agreements &amp; Rate Cards (');
  });
});
