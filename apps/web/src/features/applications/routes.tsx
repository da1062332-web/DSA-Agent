// Feature: applications — owner: Dev 3 — UI-APP-001 (Day 3). Replace the elements; keep the paths.
// The lender-case panel on /applications/:id is Dev 4's, mounted through a documented extension point.
import type { RouteObject } from 'react-router-dom';
import { Placeholder } from '../../shell/Placeholder';

export const routes: RouteObject[] = [
  { path: '/applications', element: <Placeholder name="UI-APP-001 applications" owner="Dev 3" /> },
  { path: '/applications/:id', element: <Placeholder name="UI-APP-001 application detail" owner="Dev 3" /> },
];
