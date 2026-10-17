import type { RouteObject } from 'react-router-dom';
import { PayoutsDashboardPage } from './PayoutsDashboardPage';

export const routes: RouteObject[] = [{ path: '/payouts', element: <PayoutsDashboardPage /> }];
