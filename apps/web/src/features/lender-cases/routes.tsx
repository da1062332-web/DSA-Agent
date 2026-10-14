import React from 'react';
import type { RouteObject } from 'react-router-dom';
import { LenderCaseDetailPage } from './LenderCaseDetailPage';
import { LenderCasePanel } from './LenderCasePanel';

export const routes: RouteObject[] = [
  { path: '/lender-cases', element: <LenderCasePanel applicationId="app_demo_001" /> },
  { path: '/lender-cases/:id', element: <LenderCaseDetailPage /> },
];

