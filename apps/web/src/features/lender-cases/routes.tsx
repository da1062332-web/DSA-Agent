import React from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import { LenderCaseDetailPage } from './LenderCaseDetailPage';

/** Lender cases are opened from their application (see the application page), so the bare list goes there. */
export const routes: RouteObject[] = [
  { path: '/lender-cases', element: <Navigate to="/applications" replace /> },
  { path: '/lender-cases/:id', element: <LenderCaseDetailPage /> },
];
