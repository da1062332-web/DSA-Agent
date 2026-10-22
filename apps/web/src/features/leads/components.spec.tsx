import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LeadList } from './LeadList';
import { LeadCreate } from './LeadCreate';
import { LeadDetail } from './LeadDetail';
import * as useMeModule from '../../api/useMe';

vi.mock('../../api/useMe', async () => {
  const actual = await vi.importActual<typeof useMeModule>('../../api/useMe');
  return {
    ...actual,
    useMe: vi.fn(),
  };
});

function renderWithProviders(ui: React.ReactElement, initialPath = '/') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Leads Frontend Components Rendering', () => {
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

  it('LeadList renders title, filter controls, and hides Create Lead for view-only users', () => {
    mockGrants(['lead.read']);
    const html = renderWithProviders(<LeadList />);
    expect(html).toContain('Leads');
    expect(html).not.toContain('Create Lead');
    expect(html).toContain('Owner / Staff');
    expect(html).toContain('State');
  });

  it('LeadList renders Create Lead when user possesses lead.create', () => {
    mockGrants(['lead.read', 'lead.create']);
    const html = renderWithProviders(<LeadList />);
    expect(html).toContain('Leads');
    expect(html).toContain('Create Lead');
  });

  it('LeadCreate renders form inputs and mandatory DPDP consent section', () => {
    const html = renderWithProviders(<LeadCreate />);
    expect(html).toContain('Create New Lead');
    expect(html).toContain('Full Name');
    expect(html).toContain('Mobile Number');
    expect(html).toContain('Product Category');
    expect(html).toContain('Indicative Amount');
    expect(html).toContain('Consent Details (DPDP Mandatory)');
    expect(html).toContain('Notice Version');
  });

  it('LeadDetail renders in loading/query container when mounted', () => {
    const html = renderWithProviders(
      <Routes>
        <Route path="/leads/:id" element={<LeadDetail />} />
      </Routes>,
      '/leads/lead_test_123',
    );
    expect(html).toBeDefined();
    // In server/mock mode without fetched data, CircularProgress or container is rendered
    expect(html).toContain('MuiCircularProgress-root');
  });
});
