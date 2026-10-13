// Feature: grievances — owner: Dev 3 — MOD-GRV Grievances (Module 13). Composed into the app shell automatically.
import type { RouteObject } from 'react-router-dom';
import { ComplaintDetailPage } from './ComplaintDetailPage';
import { ComplaintsPage } from './ComplaintsPage';

export const routes: RouteObject[] = [
  { path: '/complaints', element: <ComplaintsPage /> },
  { path: '/complaints/:id', element: <ComplaintDetailPage /> },
];
