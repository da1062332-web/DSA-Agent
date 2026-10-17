import React from 'react';
import type { RouteObject } from 'react-router-dom';
import { LenderCaseDetailPage } from './LenderCaseDetailPage';
import { LenderCaseListPage } from './LenderCaseListPage';
import { LenderCasePanel } from './LenderCasePanel';

export const routes: RouteObject[] = [
  { path: '/lender-cases', element: <LenderCaseListPage /> },
  { path: '/lender-cases/:id', element: <LenderCaseDetailPage /> },
  { path: '/applications/:applicationId/lender-cases', element: <LenderCasePanel /> },
];
