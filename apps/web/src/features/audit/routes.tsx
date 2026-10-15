// apps/web/src/features/audit/routes.tsx — owner: Akash (Module 37: Audit MOD-AUD)
import type { RouteObject } from 'react-router-dom';
import { AuditSearchPage } from './AuditSearchPage';

export const routes: RouteObject[] = [
  {
    path: '/audit',
    element: <AuditSearchPage />,
  },
];
