import React from 'react';
import { useParams, type RouteObject } from 'react-router-dom';
import { SanctionsPanel } from './SanctionsPanel';
import { SanctionsListPage } from './SanctionsListPage';

function SanctionsForCase() {
  const { lenderCaseId } = useParams<{ lenderCaseId: string }>();
  return lenderCaseId ? <SanctionsPanel lenderCaseId={lenderCaseId} /> : <SanctionsListPage />;
}

export const routes: RouteObject[] = [
  { path: '/sanctions', element: <SanctionsListPage /> },
  { path: '/sanctions/:lenderCaseId', element: <SanctionsForCase /> },
];
