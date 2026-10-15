// Feature: customers — owner: Dev 5 (MOD-CUST Customers)
import type { RouteObject } from 'react-router-dom';
import { CustomerConsents } from './CustomerConsents';
import { CustomerDetailPage } from './CustomerDetailPage';
import { CustomerListPage } from './CustomerListPage';

export const routes: RouteObject[] = [
  {
    path: '/customers',
    element: <CustomerListPage />,
  },
  {
    path: '/customers/:id',
    element: <CustomerDetailPage />,
  },
  {
    path: '/customers/:id/consents',
    element: <CustomerConsents />,
  },
];
