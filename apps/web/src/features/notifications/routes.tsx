// apps/web/src/features/notifications/routes.tsx — owner: Dev 1
import type { RouteObject } from 'react-router-dom';
import { NotificationsPage } from './NotificationsPage';

export const routes: RouteObject[] = [
  {
    path: '/notifications',
    element: <NotificationsPage />,
  },
];
