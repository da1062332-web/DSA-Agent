// apps/web/src/features/api-management/routes.tsx — owner: Akash (Module 36: API Management MOD-API)
import type { RouteObject } from 'react-router-dom';
import { ApiManagementPage } from './ApiManagementPage';

export const routes: RouteObject[] = [
  {
    path: '/api-management',
    element: <ApiManagementPage />,
  },
];
