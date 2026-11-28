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

import { ApprovalsPage } from './ApprovalsPage';

const render = (...codes: string[]) => {
  me.grants = codes.map((code) => ({ code, scope: 'TENANT', branchIds: [] }));
  return renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ApprovalsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('Approvals page access (tenant realm)', () => {
  it('TEST-APR-005 a user with no relevant permission is told they have no access, and no tab is shown', () => {
    const html = render('lead.read');
    expect(html).toContain('approvals.noAccess');
    expect(html).not.toContain('approvals.tab');
  });

  it('TEST-APR-006 a tenant administrator sees the support access tab, and no data corrections tab', () => {
    const html = render('config.manage');
    expect(html).toContain('approvals.tab.support');
    expect(html).not.toContain('approvals.tab.corrections');
    expect(html).not.toContain('approvals.noAccess');
  });
});
