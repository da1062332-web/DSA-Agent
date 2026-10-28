// The tenant page of the platform console: how the screen is reached, what it shows, and that every call names the tenant on screen.
// Rendering is static (no browser here), so the data is put in the query cache first; the calls themselves are checked at the fetch.
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { PlatformTenantSummary, TenantFeatureFlag } from '@dsa/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../auth/supabase', () => ({
  getSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
  }),
}));
vi.mock('../../config', () => ({
  readConfig: () => ({ success: true, data: { VITE_API_BASE_URL: 'http://api.test' } }),
}));

import { ApiError } from '../../api/client';
import { fetchPlatformTenant, fetchTenantFeatureFlags, updateTenantFeatureFlag } from './api';
import { PlatformConsolePage } from './PlatformConsolePage';
import { TenantDetailPage } from './TenantDetailPage';
import { routes } from './routes';
import { confirmMessage, flagState, updateRequest } from './tenant-flags-model';

const tenant = (id: string, slug: string): PlatformTenantSummary => ({
  id,
  slug,
  legalName: `${slug} Pvt Ltd`,
  tenantType: 'DSA_ORG',
  dataRegion: 'IN',
  timezone: 'Asia/Kolkata',
  status: 'ACTIVE',
  createdAt: '2026-10-01T00:00:00.000Z',
  createdBy: 'SYSTEM:platform',
  healthStatus: 'HEALTHY',
  activeUsersCount: 7,
  applicationsCount: null,
  entitlements: [],
});

const flag = (over: Partial<TenantFeatureFlag> = {}): TenantFeatureFlag => ({
  tenantId: 'ten_alpha',
  key: 'crm.lead_auto_qualify',
  scope: 'TENANT',
  description: 'Automatic qualification when BRE score is above 750',
  owner: 'CRM Squad',
  defaultValue: false,
  value: false,
  overridden: false,
  lockVersion: 0,
  updatedAt: null,
  updatedBy: null,
  ...over,
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function render(path: string, seed: (qc: QueryClient) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed(qc);
  return renderToString(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/platform-admin" element={<PlatformConsolePage />} />
          <Route path="/platform-admin/tenants/:tenantId" element={<TenantDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('tenant page: reaching it', () => {
  it('TEST-UI-TEN-01 the tenant page has its own routes, under both console paths, with the tenant id in the URL', () => {
    const paths = routes.map((r) => r.path);
    expect(paths).toContain('/platform-admin/tenants/:tenantId');
    expect(paths).toContain('/platform-console/tenants/:tenantId');
  });

  it("TEST-UI-TEN-02 every tenant row in the directory links to that tenant's page (the slug and a Manage button)", () => {
    const html = render('/platform-admin', (qc) =>
      qc.setQueryData(['platform-tenants'], {
        data: [tenant('ten_alpha', 'alpha'), tenant('ten_beta', 'beta')],
        meta: { total: 2 },
      }),
    );
    expect(html).toContain('href="/platform-admin/tenants/ten_alpha"');
    expect(html).toContain('href="/platform-admin/tenants/ten_beta"');
    expect(html).toContain('Manage');
    // one link per row for the slug and one for the button, each to its own tenant
    expect(html.split('href="/platform-admin/tenants/ten_alpha"').length - 1).toBe(2);
  });
});

describe('tenant page: what it shows', () => {
  it('TEST-UI-TEN-03 the overview shows the selected tenant only, with the no-business-data notice', () => {
    const html = render('/platform-admin/tenants/ten_alpha', (qc) =>
      qc.setQueryData(['platform-tenant', 'ten_alpha'], tenant('ten_alpha', 'alpha')),
    );
    expect(html).toContain('alpha Pvt Ltd');
    expect(html).not.toContain('>ten_alpha<');
    expect(html).toContain('Overview');
    expect(html).toContain('Feature Flags');
    expect(html).toContain('Zero Business Data Projection');
    expect(html).not.toContain('beta');
  });

  it("TEST-UI-TEN-04 the flags tab (?tab=flags) shows default, this tenant's value and state per flag, and says the change is for this tenant only", () => {
    const html = render('/platform-admin/tenants/ten_alpha?tab=flags', (qc) => {
      qc.setQueryData(['platform-tenant', 'ten_alpha'], tenant('ten_alpha', 'alpha'));
      qc.setQueryData(['platform-tenant-flags', 'ten_alpha'], {
        data: [
          flag(),
          flag({
            key: 'crm.other',
            value: true,
            overridden: true,
            lockVersion: 3,
            updatedAt: '2026-10-17T10:00:00.000Z',
            updatedBy: 'usr_op',
          }),
        ],
        meta: { total: 2 },
      });
      qc.setQueryData(['platform-flags'], {
        data: [
          {
            key: 'bre.v2_engine',
            scope: 'GLOBAL',
            value: true,
            owner: 'x',
            lockVersion: 1,
            updatedAt: '',
            updatedBy: '',
          },
          {
            key: 'crm.lead_auto_qualify',
            scope: 'TENANT',
            value: false,
            owner: 'x',
            lockVersion: 1,
            updatedAt: '',
            updatedBy: '',
          },
        ],
        meta: { total: 2 },
      });
    });
    expect(html).toContain('apply to');
    expect(html).toContain('only');
    expect(html).toContain('crm.lead_auto_qualify');
    expect(html).toContain('Using default (OFF)');
    expect(html).toContain('Overridden (ON, default OFF)');
    expect(html.replace(/<!-- -->/g, '')).toContain('v3'); // the server renderer splits "v" and the number with a comment
    // the global flags are context, read-only chips: the TENANT default row is not among them
    expect(html).toContain('Global flags (same for every tenant, read-only here)');
    expect(html).toContain('bre.v2_engine: ON');
    expect(html).not.toContain('crm.lead_auto_qualify: OFF');
  });
});

describe('tenant page: what it sends', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());
  const urlOf = (i: number) => new URL(String(fetchMock.mock.calls[i]![0]));
  const initOf = (i: number) => fetchMock.mock.calls[i]![1] as RequestInit;

  it("TEST-UI-TEN-05 reads go to the selected tenant's own routes; the tenant id is encoded into the path, not into a query", async () => {
    fetchMock.mockImplementation(async () => json(200, { data: [], meta: { total: 0 } }));
    await fetchPlatformTenant('ten_alpha');
    await fetchTenantFeatureFlags('ten_alpha');
    expect(urlOf(0).pathname).toBe('/platform/v1/tenants/ten_alpha');
    expect(urlOf(1).pathname).toBe('/platform/v1/tenants/ten_alpha/flags');
    expect(urlOf(1).search).toBe('');
    expect(new Headers(initOf(1).headers).get('Authorization')).toBe('Bearer test-token');
  });

  it("TEST-UI-TEN-06 a tenant update is a PUT to that tenant's flag with only the value in the body and the version seen as If-Match", async () => {
    fetchMock.mockImplementation(async () =>
      json(200, flag({ value: true, overridden: true, lockVersion: 1 })),
    );
    await updateTenantFeatureFlag('ten_alpha', 'crm.lead_auto_qualify', true, 0);
    const u = urlOf(0);
    expect(u.pathname).toBe('/platform/v1/tenants/ten_alpha/flags/crm.lead_auto_qualify');
    expect(initOf(0).method).toBe('PUT');
    expect(JSON.parse(String(initOf(0).body))).toEqual({ value: true }); // no scope, no tenantId in the body
    expect(new Headers(initOf(0).headers).get('If-Match')).toBe('"0"');
    // never the global route
    expect(u.pathname).not.toMatch(/^\/platform\/v1\/flags/);

    await updateTenantFeatureFlag('ten_alpha', 'crm.lead_auto_qualify', false, 4);
    expect(new Headers(initOf(1).headers).get('If-Match')).toBe('"4"');
  });

  it('TEST-UI-TEN-07 a call without a tenant id is refused before anything is sent, so it can never become a platform-wide call', async () => {
    await expect(fetchPlatformTenant('')).rejects.toThrow('A tenant id is required.');
    await expect(fetchTenantFeatureFlags('')).rejects.toThrow('A tenant id is required.');
    await expect(updateTenantFeatureFlag('', 'k', true, 0)).rejects.toThrow('A tenant id is required.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('TEST-UI-TEN-08 the API refusals reach the screen as they are: 409 stale version, 403 not a platform operator, 404 unknown tenant', async () => {
    const refusal = (code: string, httpStatus: number, message: string) =>
      json(httpStatus, {
        error: { code, message, httpStatus, correlationId: 'c1', details: [], retryable: false },
      });
    fetchMock.mockImplementationOnce(async () => refusal('VERSION_CONFLICT', 409, 'Current version: 2.'));
    await expect(updateTenantFeatureFlag('ten_alpha', 'k', true, 0)).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      httpStatus: 409,
    });
    fetchMock.mockImplementationOnce(async () =>
      refusal('FORBIDDEN', 403, 'This action is for platform operators only.'),
    );
    const forbidden = await fetchTenantFeatureFlags('ten_alpha').catch((e) => e);
    expect(forbidden).toBeInstanceOf(ApiError);
    expect(forbidden).toMatchObject({ code: 'FORBIDDEN', httpStatus: 403 });
    fetchMock.mockImplementationOnce(async () => refusal('NOT_FOUND', 404, 'Tenant not found.'));
    await expect(fetchPlatformTenant('ten_missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      httpStatus: 404,
    });
  });
});

describe('tenant page: the confirmation and the request it builds', () => {
  it('TEST-UI-TEN-09 the confirmation names the tenant and says what is not changed', () => {
    const msg = confirmMessage('alpha Pvt Ltd', flag(), true);
    expect(msg).toContain('crm.lead_auto_qualify ON for alpha Pvt Ltd only');
    expect(msg).toContain('platform default (OFF)');
    expect(msg).toContain('every other tenant are not changed');
  });

  it('TEST-UI-TEN-10 the request carries the tenant on screen and the version read; a flag of another tenant is refused', () => {
    expect(updateRequest('ten_alpha', flag({ lockVersion: 3 }), true)).toEqual({
      tenantId: 'ten_alpha',
      key: 'crm.lead_auto_qualify',
      value: true,
      version: 3,
    });
    expect(() => updateRequest('ten_beta', flag(), true)).toThrow(/different tenant/);
    expect(flagState(flag()).overridden).toBe(false);
    expect(flagState(flag({ overridden: true, value: true })).label).toBe('Overridden (ON, default OFF)');
  });
});
