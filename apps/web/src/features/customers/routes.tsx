// Feature: customers — owner: Dev 5 — UI-LEAD-001 (Day 4). Replace the elements; keep the paths.
import type { RouteObject } from 'react-router-dom';
import { Placeholder } from '../../shell/Placeholder';

export const routes: RouteObject[] = [
  {
    path: '/customers/:id/consents',
    element: <Placeholder name="UI-LEAD-001 customer consents" owner="Dev 5" />,
  },
];
