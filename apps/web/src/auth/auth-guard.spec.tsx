// apps/web/src/auth/auth-guard.spec.tsx — Tests authentication and MFA guards
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppLayout } from '../shell/AppLayout';
import * as AuthProviderModule from './AuthProvider';
import * as useMeModule from '../api/useMe';

// Mock Navigate to assert destination and state in SSR test runs
const mockNavigateFn = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom');
  return {
    ...actual,
    Navigate: (props: { to: string; state?: any; replace?: boolean }) => {
      mockNavigateFn(props);
      return (
        <div
          data-testid="mock-navigate"
          data-to={props.to}
          data-state={JSON.stringify(props.state ?? null)}
        />
      );
    },
  };
});

vi.mock('./AuthProvider', async () => {
  const actual = await vi.importActual<typeof AuthProviderModule>('./AuthProvider');
  return {
    ...actual,
    useAuth: vi.fn(),
  };
});

vi.mock('../api/useMe', async () => {
  const actual = await vi.importActual<typeof useMeModule>('../api/useMe');
  return {
    ...actual,
    useMe: vi.fn(),
    useTenant: vi.fn(),
  };
});

describe('Authentication & MFA Guards (AppLayout)', () => {
  const mockUseAuth = vi.mocked(AuthProviderModule.useAuth);
  const mockUseMe = vi.mocked(useMeModule.useMe);
  const mockUseTenant = vi.mocked(useMeModule.useTenant);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTenant.mockReturnValue({
      data: {
        id: 'ten_01',
        slug: 'test-dsa',
        legalName: 'Test DSA',
        tenantType: 'DSA',
        dataRegion: 'ap-south-1',
        timezone: 'Asia/Kolkata',
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
      },
      isPending: false,
      isError: false,
    } as any);
  });

  function renderWithRouter(initialEntry = '/') {
    return renderToString(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<div>Protected Dashboard Content</div>} />
            <Route path="/tasks" element={<div>Tasks Content</div>} />
            <Route path="/config" element={<div>Config Content</div>} />
            <Route path="/payouts" element={<div>Payouts Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  }

  it('TEST-GUARD-01: unauthenticated user (session: null) is redirected to /login with origin path', () => {
    mockUseAuth.mockReturnValue({
      session: null,
      aal: undefined,
      recovering: false,
      refreshAal: vi.fn(),
      signOut: vi.fn(),
    });
    mockUseMe.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: false,
    } as any);

    const html = renderWithRouter('/tasks');

    expect(html).toContain('data-testid="mock-navigate"');
    expect(html).toContain('data-to="/login"');
    expect(html).toContain('&quot;from&quot;:&quot;/tasks&quot;');
    expect(mockNavigateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/login',
        replace: true,
        state: { from: '/tasks' },
      }),
    );
  });

  it('TEST-GUARD-02: user with mandatory MFA role not yet enrolled (aal.next != aal2) is redirected to /login for enrolment', () => {
    mockUseAuth.mockReturnValue({
      session: { user: { id: 'usr_admin' } } as any,
      aal: { current: 'aal1', next: 'aal1' },
      recovering: false,
      refreshAal: vi.fn(),
      signOut: vi.fn(),
    });
    mockUseMe.mockReturnValue({
      data: {
        id: 'usr_admin',
        tenantId: 'ten_01',
        email: 'admin@dsa.com',
        displayName: 'Admin User',
        primaryBranchId: null,
        queueIds: [],
        grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }],
        mfaVerifiedAt: null,
      },
      isPending: false,
      isError: false,
    } as any);

    const html = renderWithRouter('/config');

    expect(html).toContain('data-testid="mock-navigate"');
    expect(html).toContain('data-to="/login"');
    expect(html).toContain('&quot;from&quot;:&quot;/config&quot;');
    expect(mockNavigateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/login',
        replace: true,
        state: { from: '/config' },
      }),
    );
  });

  it('TEST-GUARD-03: user enrolled in MFA but at aal1 this session (needs challenge) is redirected to /login', () => {
    mockUseAuth.mockReturnValue({
      session: { user: { id: 'usr_fin' } } as any,
      aal: { current: 'aal1', next: 'aal2' },
      recovering: false,
      refreshAal: vi.fn(),
      signOut: vi.fn(),
    });
    mockUseMe.mockReturnValue({
      data: {
        id: 'usr_fin',
        tenantId: 'ten_01',
        email: 'finance@dsa.com',
        displayName: 'Finance User',
        primaryBranchId: null,
        queueIds: [],
        grants: [{ code: 'payout.approve', scope: 'TENANT', branchIds: [] }],
        mfaVerifiedAt: null,
      },
      isPending: false,
      isError: false,
    } as any);

    const html = renderWithRouter('/payouts');

    expect(html).toContain('data-testid="mock-navigate"');
    expect(html).toContain('data-to="/login"');
    expect(html).toContain('&quot;from&quot;:&quot;/payouts&quot;');
    expect(mockNavigateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/login',
        replace: true,
        state: { from: '/payouts' },
      }),
    );
  });

  it('TEST-GUARD-04: user with aal2 session passes MFA guard and accesses protected content', () => {
    mockUseAuth.mockReturnValue({
      session: { user: { id: 'usr_admin' } } as any,
      aal: { current: 'aal2', next: 'aal2' },
      recovering: false,
      refreshAal: vi.fn(),
      signOut: vi.fn(),
    });
    mockUseMe.mockReturnValue({
      data: {
        id: 'usr_admin',
        tenantId: 'ten_01',
        email: 'admin@dsa.com',
        displayName: 'Admin User',
        primaryBranchId: null,
        queueIds: [],
        grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }],
        mfaVerifiedAt: new Date().toISOString(),
      },
      isPending: false,
      isError: false,
    } as any);

    const html = renderWithRouter('/');

    expect(html).not.toContain('data-testid="mock-navigate"');
    expect(html).toContain('Protected Dashboard Content');
    // Verify useTenant was enabled because mfaPassed is true
    expect(mockUseTenant).toHaveBeenCalledWith(true);
  });

  it('TEST-GUARD-05: non-MFA role user passes guard at aal1', () => {
    mockUseAuth.mockReturnValue({
      session: { user: { id: 'usr_agent' } } as any,
      aal: { current: 'aal1', next: 'aal1' },
      recovering: false,
      refreshAal: vi.fn(),
      signOut: vi.fn(),
    });
    mockUseMe.mockReturnValue({
      data: {
        id: 'usr_agent',
        tenantId: 'ten_01',
        email: 'agent@dsa.com',
        displayName: 'Agent User',
        primaryBranchId: null,
        queueIds: [],
        grants: [{ code: 'lead.create', scope: 'TENANT', branchIds: [] }],
        mfaVerifiedAt: null,
      },
      isPending: false,
      isError: false,
    } as any);

    const html = renderWithRouter('/');

    expect(html).not.toContain('data-testid="mock-navigate"');
    expect(html).toContain('Protected Dashboard Content');
    expect(mockUseTenant).toHaveBeenCalledWith(true);
  });

  it('TEST-GUARD-06: loading session shows progress indicator', () => {
    mockUseAuth.mockReturnValue({
      session: undefined,
      aal: undefined,
      recovering: false,
      refreshAal: vi.fn(),
      signOut: vi.fn(),
    });
    mockUseMe.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    } as any);

    const html = renderWithRouter('/');

    expect(html).toContain('MuiCircularProgress-root');
    expect(html).not.toContain('data-testid="mock-navigate"');
    expect(html).not.toContain('Protected Dashboard Content');
  });

  it('TEST-GUARD-07: me fetch error displays error alert with Sign out option', () => {
    mockUseAuth.mockReturnValue({
      session: { user: { id: 'usr_err' } } as any,
      aal: { current: 'aal2', next: 'aal2' },
      recovering: false,
      refreshAal: vi.fn(),
      signOut: vi.fn(),
    });
    mockUseMe.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error('Network failure loading profile'),
    } as any);

    const html = renderWithRouter('/');
    expect(html).toContain('Your account could not be loaded:');
    expect(html).toContain('Network failure loading profile');
    expect(html).toContain('Sign out');
    expect(html).not.toContain('Protected Dashboard Content');
  });
});
