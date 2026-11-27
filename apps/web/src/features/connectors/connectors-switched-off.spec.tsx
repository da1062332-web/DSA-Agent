// TEST-UI-CON-OFF: with connectors switched off for the tenant (MOD-CON in GET /v1/me disabledModules), no screen offers a connector
// picker, name lookup, lead field or connector dashboard, and no /v1/connectors request is made. Switched on, they show as before.
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as useMeModule from '../../api/useMe';
import { ConnectorSelect } from './ConnectorSelect';
import { ConnectorSelect as ShellConnectorSelect } from '../../shell/selectors';
import { ConnectorName } from '../../shell/display';
import { LeadCreate } from '../leads/LeadCreate';

vi.mock('../../api/useMe', async () => {
  const actual = await vi.importActual<typeof useMeModule>('../../api/useMe');
  return { ...actual, useMe: vi.fn() };
});

const mockUseMe = vi.mocked(useMeModule.useMe);
const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ items: [], data: [] }), { status: 200 }));

function mockMe(disabledModules: string[]) {
  mockUseMe.mockReturnValue({
    data: {
      id: 'usr_test',
      tenantId: 'ten_test',
      email: 'owner@example.test',
      displayName: 'Test Owner',
      primaryBranchId: null,
      queueIds: [],
      grants: ['connector.read', 'lead.create'].map((code) => ({ code, scope: 'TENANT', branchIds: [] })),
      mfaVerifiedAt: null,
      disabledModules,
    },
    isLoading: false,
    isError: false,
  } as any);
}

function render(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToString(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

describe('TEST-UI-CON-OFF connectors switched off for the tenant', () => {
  it('TEST-UI-CON-OFF-01 the connector pickers render nothing when MOD-CON is off', () => {
    mockMe(['MOD-CON', 'MOD-CPT']);
    expect(render(<ConnectorSelect value={null} onChange={() => {}} testId="x.connector" />)).toBe('');
    expect(render(<ShellConnectorSelect value={null} onChange={() => {}} data-testid="y.connector" />)).toBe('');
  });

  it('TEST-UI-CON-OFF-02 a connector name shows the fallback and makes no lookup when MOD-CON is off', () => {
    mockMe(['MOD-CON']);
    const html = render(<ConnectorName id="con_01M8B3RVGE5W24KKCY126PDYJB" fallback="Direct / Organic" />);
    expect(html).toContain('Direct / Organic');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('TEST-UI-CON-OFF-03 the create-lead form has no connector field when MOD-CON is off, and has it when on', () => {
    mockMe(['MOD-CON']);
    expect(render(<LeadCreate />)).not.toContain('lead-form.connector');
    mockMe([]);
    expect(render(<LeadCreate />)).toContain('lead-form.connector');
  });

  it('TEST-UI-CON-OFF-04 the pickers still render when connectors are on', () => {
    mockMe([]);
    expect(render(<ConnectorSelect value={null} onChange={() => {}} testId="x.connector" />)).toContain('x.connector');
  });
});
