// Feature: customers — owner: Dev 5 — UI-LEAD-001 (Day 4).
import type { RouteObject } from 'react-router-dom';
import { CustomerConsents } from './CustomerConsents';

export const routes: RouteObject[] = [
  {
    path: '/customers/:id/consents',
    element: <CustomerConsents />,
  },
];
