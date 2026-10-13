import type { RouteObject } from 'react-router-dom';
import { LeadList } from './LeadList';
import { LeadCreate } from './LeadCreate';
import { LeadDetail } from './LeadDetail';

export const routes: RouteObject[] = [
  { path: '/leads', element: <LeadList /> },
  { path: '/leads/new', element: <LeadCreate /> },
  { path: '/leads/:id', element: <LeadDetail /> },
];
