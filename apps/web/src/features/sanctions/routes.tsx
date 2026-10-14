import React from 'react';
import type { RouteObject } from 'react-router-dom';
import { SanctionsPanel } from './SanctionsPanel';

export const routes: RouteObject[] = [
  { path: '/sanctions', element: <SanctionsPanel lenderCaseId="lcs_demo_001" /> },
  { path: '/sanctions/:lenderCaseId', element: <SanctionsPanel lenderCaseId="lcs_demo_001" /> },
];
