// apps/web/src/features/audit/Audit.spec.tsx — owner: Akash (Module 37: Audit MOD-AUD)
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditSearchPage } from './AuditSearchPage';
import * as useMeModule from '../../api/useMe';

vi.mock('../../api/useMe', async () => {
  const actual = await vi.importActual<typeof useMeModule>('../../api/useMe');
  return {
    ...actual,
    useMe: vi.fn(),
  };
});

function renderAuditPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/audit']}>
        <AuditSearchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Module 37 — Audit (MOD-AUD) UI Component Suite', () => {
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

  it('TEST-UI-AUD-001 renders AuditSearchPage title, filters, and action buttons when authorized', () => {
    mockGrants(['audit.read', 'config.manage', 'audit.export_evidence']);
    const html = renderAuditPage();

    expect(html).toContain('Audit Trail &amp; Cryptographic Verification');
    expect(html).toContain('Verify Chain Integrity');
    expect(html).toContain('Seal Chain');
    expect(html).toContain('Export Evidence Pack');
    expect(html).toContain('Filter Audit Log');
  });

  it('hides Seal Chain and Export Evidence Pack for view-only auditors', () => {
    mockGrants(['audit.read']);
    const html = renderAuditPage();

    expect(html).toContain('Audit Trail &amp; Cryptographic Verification');
    expect(html).toContain('Verify Chain Integrity');
    expect(html).not.toContain('Seal Chain');
    expect(html).not.toContain('Export Evidence Pack');
  });
});
