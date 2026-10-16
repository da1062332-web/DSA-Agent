import React from 'react';
import type { RouteObject } from 'react-router-dom';
import { LenderCaseDetailPage } from './LenderCaseDetailPage';
import { LenderCasePanel } from './LenderCasePanel';

export const routes: RouteObject[] = [
  { path: '/lender-cases', element: <LenderCasePanel /> },
  { path: '/lender-cases/:id', element: <LenderCaseDetailPage /> },
  { path: '/applications/:applicationId/lender-cases', element: <LenderCasePanel /> },
];

