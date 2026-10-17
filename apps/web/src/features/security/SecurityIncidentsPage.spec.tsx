import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Me } from '../../api/useMe';

const me = vi.hoisted(() => ({ grants: [] as { code: string; scope: string; branchIds: string[] }[] }));
vi.mock('../../api/useMe', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useMe: () => ({ data: { id: 'usr_me', grants: me.grants } as Me }),
}));

import { SecurityIncidentsPage } from './SecurityIncidentsPage';
import { routes } from './routes';

const render = (...codes: string[]) => {
  me.grants = codes.map((code) => ({ code, scope: 'TENANT', branchIds: [] }));
  return renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <SecurityIncidentsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('security events and incidents screen', () => {
  it('TEST-UI-SEC-08 without security.incident the user is told they have no access and no data screen is shown', () => {
    const html = render('lead.read');
    expect(html).toContain('security-no-access');
    expect(html).not.toContain('Record incident');
  });

  it('TEST-UI-SEC-09 with security.incident the incidents and events tabs and the record button are shown', () => {
    const html = render('security.incident');
    expect(html).not.toContain('security-no-access');
    expect(html).toContain('Security events and incidents');
    expect(html).toContain('Incidents');
    expect(html).toContain('Security events');
    expect(html).toContain('Record incident');
  });

  it('TEST-UI-SEC-10 the screen is routed at /security', () => {
    expect(routes.map((r) => r.path)).toContain('/security');
  });
});
