import { PLATFORM_TENANT_ID } from '@dsa/contracts';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from './HomePage';

let tenantId = 'ten_01JTESTTENANT00000000000000';
vi.mock('../api/useMe', () => ({
  useMe: () => ({ data: { displayName: 'Test User', tenantId }, isError: false }),
}));

const render = () =>
  renderToString(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );

describe('home page by realm', () => {
  beforeEach(() => {
    tenantId = 'ten_01JTESTTENANT00000000000000';
  });

  it('TEST-REALM-WEB-005 a platform user is offered only the Platform Console', () => {
    tenantId = PLATFORM_TENANT_ID;
    const html = render();
    expect(html).toContain('href="/platform-admin"');
    expect((html.match(/href="\//g) ?? []).length).toBe(1);
    for (const tenantScreen of ['/leads', '/tasks', '/applications', '/users', '/payouts', '/config'])
      expect(html).not.toContain(`href="${tenantScreen}"`);
  });

  it('TEST-REALM-WEB-006 a customer-tenant user still sees the full Home page, without the Platform Console', () => {
    const html = render();
    for (const screen of ['/leads', '/tasks', '/applications', '/users', '/payouts', '/config'])
      expect(html).toContain(`href="${screen}"`);
    expect(html).not.toContain('href="/platform-admin"');
    expect((html.match(/href="\//g) ?? []).length).toBeGreaterThan(15);
  });
});
