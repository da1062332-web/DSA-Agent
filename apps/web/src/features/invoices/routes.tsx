// Feature: invoices — owner: Dev 5 — MOD-INV Invoices (TASK-418). Composed into app shell automatically.
import type { RouteObject } from 'react-router-dom';
import { InvoicesPage } from './InvoicesPage';

export const routes: RouteObject[] = [
  { path: '/invoices', element: <InvoicesPage /> },
];
