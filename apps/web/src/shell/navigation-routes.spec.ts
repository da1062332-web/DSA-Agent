// Every sidebar link must lead to a real route (owner: Dev 1). A link to a path nobody registered lands on "Page not found".
import { matchPath, type RouteObject } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { featureRoutes } from '../routes';
import { NAV_GROUPS } from './Sidebar';

const SHELL_PATHS = ['/', '/account/security'];
const paths = (routes: RouteObject[]): string[] =>
  routes.flatMap((r) => [...(r.path ? [r.path] : []), ...paths(r.children ?? [])]);
const registered = [...SHELL_PATHS, ...paths(featureRoutes)];

describe('sidebar links and routes', () => {
  it('TEST-NAV-01 every sidebar item that has a link points to a registered route', () => {
    const links = NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.to);
    expect(links.length).toBeGreaterThan(30);
    const dangling = links
      .map((i) => i.to as string)
      .filter(
        (to) => !registered.some((pattern) => matchPath({ path: pattern, end: true }, to.split('?')[0]!)),
      );
    expect(dangling).toEqual([]);
  });

  it('TEST-NAV-02 the only items shown as "Soon" are the ones whose release is not yet reached', () => {
    const soon = NAV_GROUPS.flatMap((g) => g.items)
      .filter((i) => !i.to)
      .map((i) => `${i.label}:${i.task}`)
      .sort();
    // Eligibility authoring is Release 2 (TASK-416); the connector portal is Release 3. Documents and security are real screens now.
    expect(soon).toEqual(['Connector portal:MOD-CPT', 'Eligibility:MOD-ELG']);
  });
});
