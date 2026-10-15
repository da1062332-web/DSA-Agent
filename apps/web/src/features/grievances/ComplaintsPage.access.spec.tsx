import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Me } from '../../api/useMe';

const me = vi.hoisted(() => ({ grants: [] as { code: string; scope: string; branchIds: string[] }[] }));
vi.mock('../../api/useMe', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useMe: () => ({ data: { grants: me.grants } as Me }),
}));

import { ComplaintsPage } from './ComplaintsPage';

const render = (...codes: string[]) => {
  me.grants = codes.map((code) => ({ code, scope: 'TENANT', branchIds: [] }));
  return renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ComplaintsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('Complaints page access', () => {
  it("tells a user with no complaint permission that they don't have access", () => {
    const html = render('lead.read');
    expect(html).toContain('complaints.noAccess');
    expect(html).toContain('have access to complaints');
  });

  it('shows the queue, not the warning, for a handler', () => {
    const html = render('complaint.manage');
    expect(html).not.toContain('complaints.noAccess');
  });

  it('lets a user who can only record complaints see the intake button without the warning', () => {
    const html = render('complaint.create');
    expect(html).not.toContain('complaints.noAccess');
    expect(html).toContain('complaints.new');
  });
});
