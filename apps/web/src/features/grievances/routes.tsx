import type { RouteObject } from 'react-router-dom';
import { GrievancesPage } from './GrievancesPage';

export const routes: RouteObject[] = [
  { path: '/grievances', element: <GrievancesPage /> },
];
