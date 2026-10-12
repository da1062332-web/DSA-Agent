import { describe, expect, it } from 'vitest';
import { routes } from './routes';
import { LeadList } from './LeadList';
import { LeadCreate } from './LeadCreate';
import { LeadDetail } from './LeadDetail';

describe('leads feature routes and components', () => {
  it('exports all 3 MVP routes with proper paths', () => {
    const paths = routes.map((r) => r.path);
    expect(paths).toEqual(['/leads', '/leads/new', '/leads/:id']);
  });

  it('binds valid React elements to each route', () => {
    expect(routes[0]?.element).toBeDefined();
    expect(routes[1]?.element).toBeDefined();
    expect(routes[2]?.element).toBeDefined();
    expect(typeof LeadList).toBe('function');
    expect(typeof LeadCreate).toBe('function');
    expect(typeof LeadDetail).toBe('function');
  });
});
