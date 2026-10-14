// apps/web/src/features/activities/routes.tsx — owner: Dev 1 / Dev 5
import type { RouteObject } from 'react-router-dom';
import { ActivitiesPage } from './ActivitiesPage';

export const routes: RouteObject[] = [
  { path: '/activities', element: <ActivitiesPage /> },
];
