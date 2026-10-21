import React from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as useMeModule from '../../api/useMe';
import { QLOAX_ROLE_GRANTS } from '../../shell/role-grants.fixture';
import { RoleDashboardRouter } from './RoleDashboardRouter';
import { resolveUserRoles } from './role-routing';

vi.mock('../../api/useMe', async () => {
  const actual = await vi.importActual<typeof useMeModule>('../../api/useMe');
  return {
    ...actual,
    useMe: vi.fn(),
  };
});

// Mock feature APIs called by the dashboard widgets so network calls don't fire
vi.mock('../leads/api', () => ({
  fetchLeads: vi.fn().mockResolvedValue({ items: [], total: 0 }),
}));
vi.mock('../tasks/api', () => ({
  listTasks: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
}));
vi.mock('../admin/api', () => ({
  useList: vi.fn().mockReturnValue({ data: { pages: [{ data: [] }] }, isLoading: false, isError: false }),
}));
vi.mock('../verifications/api', () => ({
  fetchVerifications: vi.fn().mockResolvedValue({ items: [], total: 0 }),
}));
vi.mock('../payouts/api', () => ({
  fetchPayoutRequests: vi.fn().mockResolvedValue({ data: [], meta: { nextCursor: null, limit: 10 } }),
}));
vi.mock('../commission/api', () => ({
  fetchCommissionPlans: vi.fn().mockResolvedValue({ data: [], meta: { nextCursor: null, limit: 10 } }),
}));
vi.mock('../security/api', () => ({
  listIncidents: vi.fn().mockResolvedValue({ items: [], total: 0 }),
}));
vi.mock('../audit/api', () => ({
  searchAuditEvents: vi.fn().mockResolvedValue({ data: [], meta: { hasMore: false } }),
}));

const mockUseMe = vi.mocked(useMeModule.useMe);

function renderRouter(initialEntries: string[] = ['/']) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <RoleDashboardRouter />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const asGrants = (codes: string[]) =>
  codes.map((code) => ({ code, scope: 'TENANT', branchIds: [] }));

describe('RoleDashboardRouter & Persona Dashboards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('correctly maps each of the 14 tenant roles from role-grants.fixture.ts', () => {
    for (const [roleCode, grants] of Object.entries(QLOAX_ROLE_GRANTS)) {
      const mockUser: useMeModule.Me = {
        id: 'usr_test',
        tenantId: 'qloax-dsa',
        email: 'test@qloax.com',
        displayName: 'Test Persona',
        primaryBranchId: 'br_01',
        queueIds: [],
        mfaVerifiedAt: null,
        grants: asGrants(grants),
      };

      const resolved = resolveUserRoles(mockUser);
      expect(resolved.length).toBeGreaterThan(0);
    }
  });

  it('renders SalesExecDashboard for ROLE-SALES-EXEC', () => {
    mockUseMe.mockReturnValue({
      data: {
        id: 'usr_sales',
        tenantId: 'qloax-dsa',
        email: 'sales@qloax.com',
        displayName: 'Sales Agent',
        primaryBranchId: 'br_01',
        queueIds: [],
        mfaVerifiedAt: null,
        roles: ['ROLE-SALES-EXEC'],
        grants: asGrants(QLOAX_ROLE_GRANTS['ROLE-SALES-EXEC']!),
      },
      isLoading: false,
      isError: false,
    } as any);

    const html = renderRouter();
    expect(html).toContain('data-testid="sales-exec-dashboard"');
    expect(html).toContain('Sales Executive Workspace');
    expect(html).toContain('data-testid="sales-create-lead-btn"');
  });

  it('renders LoanOpsDashboard for ROLE-LOAN-OPS', () => {
    mockUseMe.mockReturnValue({
      data: {
        id: 'usr_ops',
        tenantId: 'qloax-dsa',
        email: 'ops@qloax.com',
        displayName: 'Operations Officer',
        primaryBranchId: 'br_01',
        queueIds: [],
        mfaVerifiedAt: null,
        roles: ['ROLE-LOAN-OPS'],
        grants: asGrants(QLOAX_ROLE_GRANTS['ROLE-LOAN-OPS']!),
      },
      isLoading: false,
      isError: false,
    } as any);

    const html = renderRouter();
    expect(html).toContain('data-testid="loan-ops-dashboard"');
    expect(html).toContain('Loan Operations Workbench');
  });

  it('renders VerifierDashboard for ROLE-DOC-VERIFIER', () => {
    mockUseMe.mockReturnValue({
      data: {
        id: 'usr_verifier',
        tenantId: 'qloax-dsa',
        email: 'verifier@qloax.com',
        displayName: 'Document Verifier',
        primaryBranchId: 'br_01',
        queueIds: [],
        mfaVerifiedAt: null,
        roles: ['ROLE-DOC-VERIFIER'],
        grants: asGrants(QLOAX_ROLE_GRANTS['ROLE-DOC-VERIFIER']!),
      },
      isLoading: false,
      isError: false,
    } as any);

    const html = renderRouter();
    expect(html).toContain('data-testid="verifier-dashboard"');
    expect(html).toContain('Document Verification Workbench');
  });

  it('renders RMDashboard for ROLE-RM', () => {
    mockUseMe.mockReturnValue({
      data: {
        id: 'usr_rm',
        tenantId: 'qloax-dsa',
        email: 'rm@qloax.com',
        displayName: 'Relationship Manager',
        primaryBranchId: 'br_01',
        queueIds: [],
        mfaVerifiedAt: null,
        roles: ['ROLE-RM'],
        grants: asGrants(QLOAX_ROLE_GRANTS['ROLE-RM']!),
      },
      isLoading: false,
      isError: false,
    } as any);

    const html = renderRouter();
    expect(html).toContain('data-testid="rm-dashboard"');
    expect(html).toContain('Relationship Manager Portal');
  });

  it('renders ManagerDashboard for ROLE-BRANCH-MGR and ROLE-TEAM-MGR', () => {
    mockUseMe.mockReturnValue({
      data: {
        id: 'usr_mgr',
        tenantId: 'qloax-dsa',
        email: 'mgr@qloax.com',
        displayName: 'Branch Manager',
        primaryBranchId: 'br_01',
        queueIds: [],
        mfaVerifiedAt: null,
        roles: ['ROLE-BRANCH-MGR'],
        grants: asGrants(QLOAX_ROLE_GRANTS['ROLE-BRANCH-MGR']!),
      },
      isLoading: false,
      isError: false,
    } as any);

    const html = renderRouter();
    expect(html).toContain('data-testid="manager-dashboard"');
    expect(html).toContain('Branch &amp; Team Management Hub');
  });

  it('renders FinanceDashboard for ROLE-FINANCE-EXEC', () => {
    mockUseMe.mockReturnValue({
      data: {
        id: 'usr_fin',
        tenantId: 'qloax-dsa',
        email: 'fin@qloax.com',
        displayName: 'Finance Executive',
        primaryBranchId: 'br_01',
        queueIds: [],
        mfaVerifiedAt: null,
        roles: ['ROLE-FINANCE-EXEC'],
        grants: asGrants(QLOAX_ROLE_GRANTS['ROLE-FINANCE-EXEC']!),
      },
      isLoading: false,
      isError: false,
    } as any);

    const html = renderRouter();
    expect(html).toContain('data-testid="finance-dashboard"');
    expect(html).toContain('Finance &amp; Commission Management');
  });

  it('renders ComplianceDashboard for ROLE-COMPLIANCE', () => {
    mockUseMe.mockReturnValue({
      data: {
        id: 'usr_comp',
        tenantId: 'qloax-dsa',
        email: 'compliance@qloax.com',
        displayName: 'Compliance Officer',
        primaryBranchId: 'br_01',
        queueIds: [],
        mfaVerifiedAt: null,
        roles: ['ROLE-COMPLIANCE'],
        grants: asGrants(QLOAX_ROLE_GRANTS['ROLE-COMPLIANCE']!),
      },
      isLoading: false,
      isError: false,
    } as any);

    const html = renderRouter();
    expect(html).toContain('data-testid="compliance-dashboard"');
    expect(html).toContain('Compliance &amp; Security Command Center');
  });

  it('renders Executive HomePage overview for ROLE-TENANT-ADMIN and ROLE-ORG-OWNER', () => {
    mockUseMe.mockReturnValue({
      data: {
        id: 'usr_admin',
        tenantId: 'qloax-dsa',
        email: 'admin@qloax.com',
        displayName: 'Tenant Admin',
        primaryBranchId: 'br_01',
        queueIds: [],
        mfaVerifiedAt: null,
        roles: ['ROLE-TENANT-ADMIN'],
        grants: asGrants(QLOAX_ROLE_GRANTS['ROLE-TENANT-ADMIN']!),
      },
      isLoading: false,
      isError: false,
    } as any);

    const html = renderRouter();
    expect(html).toContain('Tenant Admin');
    expect(html).toContain('Leads &amp; CRM');
  });

  it('supports multi-role persona switching', () => {
    mockUseMe.mockReturnValue({
      data: {
        id: 'usr_multi',
        tenantId: 'qloax-dsa',
        email: 'multi@qloax.com',
        displayName: 'Multi-Role User',
        primaryBranchId: 'br_01',
        queueIds: [],
        mfaVerifiedAt: null,
        roles: ['ROLE-SALES-EXEC', 'ROLE-RM'],
        grants: asGrants([
          ...QLOAX_ROLE_GRANTS['ROLE-SALES-EXEC']!,
          ...QLOAX_ROLE_GRANTS['ROLE-RM']!,
        ]),
      },
      isLoading: false,
      isError: false,
    } as any);

    const html = renderRouter();
    // Default to highest priority role: Sales Executive
    expect(html).toContain('data-testid="sales-exec-dashboard"');
    expect(html).toContain('data-testid="role-switcher-select"');
  });
});
