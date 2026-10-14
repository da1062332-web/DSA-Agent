import type { RouteObject } from 'react-router-dom';
import { CommissionDashboardPage } from './CommissionDashboardPage';

export const routes: RouteObject[] = [
  { path: '/commission', element: <CommissionDashboardPage /> },
];
