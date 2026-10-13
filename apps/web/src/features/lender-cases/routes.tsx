// apps/web/src/features/lender-cases/routes.tsx — owner: Dev 4 — UI-LCS-001 (Day 3)
import React from 'react';
import type { RouteObject } from 'react-router-dom';
import { LenderCaseDetailPage } from './LenderCaseDetailPage';

export const routes: RouteObject[] = [
  { path: '/lender-cases/:id', element: <LenderCaseDetailPage /> },
];
