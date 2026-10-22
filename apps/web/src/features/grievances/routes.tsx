// Feature: grievances — owner: Dev 3 — MOD-GRV Grievances (Module 13). Composed into the app shell automatically.
// /grievances was a preview with a simulated queue; the live screens are /complaints, so the old path forwards there.
import { Navigate, type RouteObject } from 'react-router-dom';
import { ComplaintDetailPage } from './ComplaintDetailPage';
import { ComplaintsPage } from './ComplaintsPage';

export const routes: RouteObject[] = [
  { path: '/complaints', element: <ComplaintsPage /> },
  { path: '/complaints/:id', element: <ComplaintDetailPage /> },
  { path: '/grievances', element: <Navigate to="/complaints" replace /> },
];
