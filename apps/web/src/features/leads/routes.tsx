import type { RouteObject } from 'react-router-dom';
import { LeadList } from './LeadList';
import { LeadCreate } from './LeadCreate';
import { LeadDetail } from './LeadDetail';
import { DuplicateReviewsPage } from './DuplicateReviewsPage';

export const routes: RouteObject[] = [
  { path: '/leads', element: <LeadList /> },
  { path: '/leads/new', element: <LeadCreate /> },
  { path: '/leads/duplicates', element: <DuplicateReviewsPage /> },
  { path: '/leads/:id', element: <LeadDetail /> },
];
