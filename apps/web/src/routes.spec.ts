import { createMemoryRouter, type RouteObject } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { routes } from './routes';

// Assignment Matrix §5 — every MVP route must exist from Gate 0 so owners only replace elements.
const MVP_PATHS = [
  '/login',
  '/mfa',
  '/',
  '/leads',
  '/leads/new',
  '/leads/:id',
  '/customers/:id/consents',
  '/rules',
  '/rules/:ruleSetId',
  '/rules/versions/:versionId',
  '/decisions',
  '/decisions/:id',
  '/tasks',
  '/applications',
  '/applications/:id',
  '/lender-cases/:id',
];

const collectPaths = (rs: RouteObject[]): string[] =>
  rs.flatMap((r) => [...(r.path ? [r.path] : []), ...collectPaths(r.children ?? [])]);

describe('route table', () => {
  it('registers every MVP route from Assignment Matrix §5', () => {
    expect(collectPaths(routes)).toEqual(expect.arrayContaining(MVP_PATHS));
  });

  it('registers no path twice', () => {
    const paths = collectPaths(routes);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('builds a router from the whole table (an undefined route entry would throw here)', () => {
    expect(() => createMemoryRouter(routes)).not.toThrow();
    expect(routes.flatMap((r) => r.children ?? []).every((r) => r !== undefined && r !== null)).toBe(true);
  });
});
