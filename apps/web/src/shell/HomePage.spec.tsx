import { PLATFORM_TENANT_ID } from '@dsa/contracts';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from './HomePage';
import { QLOAX_ROLE_GRANTS } from './role-grants.fixture';
import { routeAllowed } from './access';

let tenantId = 'ten_01JTESTTENANT00000000000000';
let grants: { code: string; scope: string; branchIds: string[] }[] = [];
// The real hasPermission is kept: Home filters its cards with the same rules as the sidebar and the route guard (audit F-07).
vi.mock('../api/useMe', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useMe: () => ({ data: { displayName: 'Test User', tenantId, grants }, isError: false }),
}));

const asGrants = (codes: string[]) => codes.map((code) => ({ code, scope: 'TENANT', branchIds: [] }));
const render = () =>
  renderToString(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
const hrefs = (html: string) => [...html.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]!);

describe('home page by realm', () => {
  beforeEach(() => {
    tenantId = 'ten_01JTESTTENANT00000000000000';
    grants = [];
  });

  it('TEST-REALM-WEB-005 a platform user is offered only the Platform Console', () => {
    tenantId = PLATFORM_TENANT_ID;
    grants = asGrants(['platform.console']);
    const html = render();
    expect(html).toContain('href="/platform-admin"');
    expect((html.match(/href="\//g) ?? []).length).toBe(1);
    for (const tenantScreen of ['/leads', '/tasks', '/applications', '/users', '/payouts', '/config'])
      expect(html).not.toContain(`href="${tenantScreen}"`);
  });

  it('TEST-REALM-WEB-006 a customer-tenant administrator still sees the full Home page, without the Platform Console', () => {
    // every permission the screens ask for, plus the platform ones that ROLE-TENANT-ADMIN holds by mistake on hosted
    grants = asGrants([...new Set(Object.values(QLOAX_ROLE_GRANTS).flat())]);
    const html = render();
    for (const screen of ['/leads', '/tasks', '/applications', '/users', '/payouts', '/config'])
      expect(html).toContain(`href="${screen}"`);
    expect(html).not.toContain('href="/platform-admin"');
    expect((html.match(/href="\//g) ?? []).length).toBeGreaterThan(15);
  });
});

describe('F-07 Home cards follow the user’s permissions', () => {
  beforeEach(() => {
    tenantId = 'ten_01JTESTTENANT00000000000000';
  });

  it('TEST-ACC-HOME-01 a user with no permissions is offered no card at all', () => {
    grants = [];
    expect(hrefs(render())).toEqual([]);
  });

  it('TEST-ACC-HOME-02 a sales executive is offered Leads and Tasks, and not Commissions, Payouts, Users, Access Control or Configuration', () => {
    grants = asGrants(QLOAX_ROLE_GRANTS['ROLE-SALES-EXEC']!);
    const shown = hrefs(render());
    for (const yes of ['/leads', '/tasks', '/messaging']) expect(shown, yes).toContain(yes);
    for (const no of [
      '/commission',
      '/payouts',
      '/sanctions',
      '/users',
      '/roles',
      '/config',
      '/rules',
      '/applications',
    ])
      expect(shown, no).not.toContain(no);
  });

  it('TEST-ACC-HOME-03 for each of the 14 live roles, every card is a page that role can open, and the DSA owner is offered Access Control', () => {
    for (const [role, codes] of Object.entries(QLOAX_ROLE_GRANTS)) {
      grants = asGrants(codes);
      const held = new Set(codes);
      const shown = hrefs(render());
      for (const to of shown)
        expect(
          routeAllowed(to, (c) => held.has(c), false),
          `${role} ${to}`,
        ).toBe(true);
      expect(shown, role).not.toContain('/platform-admin');
    }
    grants = asGrants(QLOAX_ROLE_GRANTS['ROLE-ORG-OWNER']!);
    expect(hrefs(render())).toContain('/roles');
  });
});
