// Feature: lender cases — owner: Dev 4 — UI-LCS-001 (Day 3). Replace the element; keep the path.
import type { RouteObject } from 'react-router-dom';
import { Placeholder } from '../../shell/Placeholder';

export const routes: RouteObject[] = [
  { path: '/lender-cases/:id', element: <Placeholder name="UI-LCS-001 lender case" owner="Dev 4" /> },
];
