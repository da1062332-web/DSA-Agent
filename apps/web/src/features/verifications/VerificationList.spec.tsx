// apps/web/src/features/verification/VerificationList.spec.tsx — owner: Developer 2
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VerificationListPage } from './VerificationListPage';
import * as useMeModule from '../../api/useMe';

vi.mock('../../api/useMe', async () => {
  const actual = await vi.importActual<typeof useMeModule>('../../api/useMe');
  return {
    ...actual,
    useMe: vi.fn(),
  };
});

function renderVerificationList(initialPath = '/verifications') {
  return renderToString(
    <MemoryRouter initialEntries={[initialPath]}>
      <VerificationListPage />
    </MemoryRouter>,
  );
}

describe('Module 19 — VerificationListPage Component Rendering', () => {
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

  it('renders page header and hides + New Verification for view-only users', () => {
    mockGrants(['verification.read']);
    const html = renderVerificationList();

    expect(html).toContain('Verification Cases (Module 19)');
    expect(html).not.toContain('+ New Verification');
    expect(html).toContain('Workbench View');
    expect(html).toContain('Manage document attestation, identity KYC, and field investigation workflows');
  });

  it('renders + New Verification when user possesses verification.perform', () => {
    mockGrants(['verification.read', 'verification.perform']);
    const html = renderVerificationList();

    expect(html).toContain('Verification Cases (Module 19)');
    expect(html).toContain('+ New Verification');
  });

  it('renders KPI summary cards', () => {
    const html = renderVerificationList();

    expect(html).toContain('Total Verifications');
    expect(html).toContain('Pending Initiation');
    expect(html).toContain('Under Review / Assigned');
    expect(html).toContain('Verified / Complete');
  });

  it('renders filter controls for status, type, and priority', () => {
    const html = renderVerificationList();

    expect(html).toContain('Status');
    expect(html).toContain('Verification Type');
    expect(html).toContain('Priority');
    expect(html).toContain('Refresh');
  });

  it('renders table columns correctly', () => {
    const html = renderVerificationList();

    expect(html).toContain('Verification ID');
    expect(html).toContain('Application ID');
    expect(html).toContain('Type');
    expect(html).toContain('Priority');
    expect(html).toContain('Status');
    expect(html).toContain('Outcome');
    expect(html).toContain('Assignee / Branch');
    expect(html).toContain('Actions');
  });
});
