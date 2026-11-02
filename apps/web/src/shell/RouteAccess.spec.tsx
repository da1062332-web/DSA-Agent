// Dashboards offer only links the user can open (owner: Dev 1; audit F-07). A Branch Manager used to see a Performance button and a
// Sanctioned Volume card that both led to "You do not have permission"; an RM saw a Connectors button. The same rule the sidebar and the
// route guard use now decides each link, and a card whose screen is closed keeps its figure and stops being a link.
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { Me } from '../api/useMe';
import { KpiMetricCard } from '../features/dashboard/components/KpiMetricCard';
import { PipelineFunnelChart } from '../features/dashboard/components/PipelineFunnelChart';
import { TaskWorkQueue } from '../features/dashboard/components/TaskWorkQueue';
import { GuardedRouterLink } from './GuardedRouterLink';
import { RouteAccessProvider, pathOf, routeAccessFor } from './RouteAccess';

const me = (codes: string[], extra: Partial<Me> = {}): Me => ({
  id: 'usr_01',
  tenantId: 'ten_01JTESTTENANT00000000000000',
  email: 'x@example.test',
  displayName: 'Test User',
  primaryBranchId: null,
  queueIds: [],
  grants: codes.map((code) => ({ code, scope: 'TENANT', branchIds: [] })),
  mfaVerifiedAt: null,
  ...extra,
});

const render = (who: Me | undefined, node: ReactNode) =>
  renderToString(
    <MemoryRouter>
      <RouteAccessProvider me={who}>{node}</RouteAccessProvider>
    </MemoryRouter>,
  );
const hrefs = (html: string) => [...html.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]!);

describe('the rule behind dashboard links', () => {
  it('TEST-DASH-01 a link target is judged by its path, so a query string does not change the answer', () => {
    expect(pathOf('/applications?status=DRAFT')).toBe('/applications');
    expect(pathOf('/leads?filter[state]=NEW#top')).toBe('/leads');
    expect(pathOf('')).toBe('/');
    const can = routeAccessFor(me(['application.read']));
    expect(can('/applications?status=SUBMITTED')).toBe(true);
    expect(can('/sanctions')).toBe(false);
  });

  it('TEST-DASH-01 it fails closed while the profile has not loaded', () => {
    const can = routeAccessFor(undefined);
    expect(can('/leads')).toBe(false);
    expect(can('/applications')).toBe(false);
  });

  it('TEST-DASH-01 a screen of a module the tenant has switched off is closed even to someone who holds its permission', () => {
    const who = me(['verification.read'], { disabledModules: ['MOD-VER'] });
    expect(routeAccessFor(who)('/verifications')).toBe(false);
    expect(routeAccessFor(me(['verification.read']))('/verifications')).toBe(true);
  });
});

describe('guarded link', () => {
  it('TEST-DASH-02 renders the link when the user may open it, and nothing when not', () => {
    const open = render(me(['lead.read']), <GuardedRouterLink to="/leads">Leads</GuardedRouterLink>);
    expect(hrefs(open)).toEqual(['/leads']);
    const closed = render(
      me(['lead.read']),
      <GuardedRouterLink to="/performance">Performance</GuardedRouterLink>,
    );
    expect(closed).toBe('');
    expect(closed).not.toContain('Performance');
  });
});

describe('KpiMetricCard', () => {
  it('TEST-DASH-03 keeps its figure but is not a link when the user may not open its screen', () => {
    const card = (to: string) => <KpiMetricCard title="Sanctioned Volume" value={7} format="raw" to={to} />;
    const closed = render(me(['application.read']), card('/sanctions'));
    expect(closed).toContain('Sanctioned Volume');
    expect(closed).toContain('7');
    expect(hrefs(closed)).toEqual([]);
    const open = render(me(['sanction.read']), card('/sanctions'));
    expect(hrefs(open)).toEqual(['/sanctions']);
  });
});

describe('PipelineFunnelChart', () => {
  const stages = [
    { key: 'a', label: 'Draft files', count: 3, color: '#111', to: '/applications?status=DRAFT' },
    { key: 'b', label: 'Sanctioned files', count: 2, color: '#222', to: '/sanctions' },
  ];

  for (const variant of ['bars', 'columns'] as const) {
    it(`TEST-DASH-04 (${variant}) links only the stages whose screen the user may open, and keeps every count`, () => {
      const html = render(
        me(['application.read']),
        <PipelineFunnelChart stages={stages} variant={variant} />,
      );
      expect(html).toContain('Draft files');
      expect(html).toContain('Sanctioned files');
      expect(hrefs(html)).toEqual(['/applications?status=DRAFT']);
    });
  }
});

describe('TaskWorkQueue', () => {
  const items = [
    {
      id: 't1',
      title: 'Check the file',
      priority: 'HIGH' as const,
      entityLink: { label: 'APP-0001', to: '/applications/app_1' },
      actionLabel: 'Open',
    },
  ];

  it('TEST-DASH-05 shows the record label as plain text and offers no "view all" when the user may not open those screens', () => {
    const html = render(
      me(['lead.read']),
      <TaskWorkQueue title="My queue" items={items} viewAllTo="/tasks" />,
    );
    expect(html).toContain('APP-0001');
    expect(hrefs(html)).toEqual([]);
    expect(html).not.toContain('View all');
  });

  it('TEST-DASH-05 links the record and the queue for a user who may open them', () => {
    const html = render(
      me(['application.read', 'task.read']),
      <TaskWorkQueue title="My queue" items={items} viewAllTo="/tasks" />,
    );
    expect(hrefs(html)).toEqual(expect.arrayContaining(['/tasks', '/applications/app_1']));
  });
});
