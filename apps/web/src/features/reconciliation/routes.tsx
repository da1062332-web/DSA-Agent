// apps/web/src/features/reconciliation/routes.tsx
import React from 'react';
import type { RouteObject } from 'react-router-dom';
import { ReconciliationDashboardPage } from './ReconciliationDashboardPage';

export const routes: RouteObject[] = [
  {
    path: '/reconciliation',
    element: <ReconciliationDashboardPage />,
  },
];
