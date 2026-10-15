// apps/web/src/features/reporting/routes.tsx — Routes for MOD-RPT Reporting & Analytics
import type { RouteObject } from 'react-router-dom';
import { ReportingPage } from './ReportingPage';

export const routes: RouteObject[] = [
  {
    path: '/reports',
    element: <ReportingPage />,
  },
];
