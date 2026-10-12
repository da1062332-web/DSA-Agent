// Feature: leads — owner: Dev 5 — UI-LEAD-001 (Day 4). Replace the elements; keep the paths.
import type { RouteObject } from 'react-router-dom';
import { Placeholder } from '../../shell/Placeholder';

export const routes: RouteObject[] = [
  { path: '/leads', element: <Placeholder name="UI-LEAD-001 lead list" owner="Dev 5" /> },
  { path: '/leads/new', element: <Placeholder name="UI-LEAD-001 create lead" owner="Dev 5" /> },
  { path: '/leads/:id', element: <Placeholder name="UI-LEAD-001 lead detail" owner="Dev 5" /> },
];
