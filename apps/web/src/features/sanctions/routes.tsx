import React from 'react';
import { Navigate, useParams, type RouteObject } from 'react-router-dom';
import { SanctionsPanel } from './SanctionsPanel';

/** A sanction belongs to a lender case, so the case comes from the URL. Opened without one, go to the applications list. */
function SanctionsForCase() {
  const { lenderCaseId } = useParams<{ lenderCaseId: string }>();
  return lenderCaseId ? <SanctionsPanel lenderCaseId={lenderCaseId} /> : <Navigate to="/applications" replace />;
}

export const routes: RouteObject[] = [
  { path: '/sanctions', element: <SanctionsForCase /> },
  { path: '/sanctions/:lenderCaseId', element: <SanctionsForCase /> },
];
