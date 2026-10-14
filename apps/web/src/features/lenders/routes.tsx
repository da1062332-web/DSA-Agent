import type { RouteObject } from 'react-router-dom';
import { LenderDetailPage } from './LenderDetailPage';
import { LenderListPage } from './LenderListPage';

export const routes: RouteObject[] = [
  { path: '/lenders', element: <LenderListPage /> },
  { path: '/lenders/:id', element: <LenderDetailPage /> },
];
