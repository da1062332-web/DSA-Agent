import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentSharingPage } from './DocumentSharingPage';
import * as useMeModule from '../../api/useMe';

vi.mock('../../api/useMe', async () => {
  const actual = await vi.importActual<typeof useMeModule>('../../api/useMe');
  return {
    ...actual,
    useMe: vi.fn(),
  };
});

function renderDocumentSharingPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DocumentSharingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Module 25 — DocumentSharingPage Permission Guarding', () => {
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

  it('renders page header but hides create and generate buttons for view-only users', () => {
    mockGrants(['application.read']);
    const html = renderDocumentSharingPage();

    expect(html).toContain('Document Sharing');
    expect(html).not.toContain('+ Create Share Package');
    expect(html).not.toContain('+ Generate Upload Link');
  });

  it('renders + Create Share Package when user possesses share.create', () => {
    mockGrants(['application.read', 'share.create']);
    const html = renderDocumentSharingPage();

    expect(html).toContain('+ Create Share Package');
    expect(html).not.toContain('+ Generate Upload Link');
  });

  it('renders + Generate Upload Link when user possesses document.upload', () => {
    mockGrants(['application.read', 'document.upload']);
    const html = renderDocumentSharingPage();

    expect(html).not.toContain('+ Create Share Package');
    expect(html).toContain('+ Generate Upload Link');
  });
});
