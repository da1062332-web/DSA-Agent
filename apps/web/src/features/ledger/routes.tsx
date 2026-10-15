// apps/web/src/features/ledger/routes.tsx — MOD-LED Routes
import React from 'react';
import type { RouteObject } from 'react-router-dom';
import { LedgerPage } from './LedgerPage';

export const routes: RouteObject[] = [
  {
    path: '/ledger',
    element: <LedgerPage />,
  },
];
