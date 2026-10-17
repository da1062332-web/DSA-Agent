// apps/web/src/features/security/routes.tsx — Module 39 (owner: Akash)
import type { RouteObject } from 'react-router-dom';
import { SecurityIncidentsPage } from './SecurityIncidentsPage';

export const routes: RouteObject[] = [{ path: '/security', element: <SecurityIncidentsPage /> }];
