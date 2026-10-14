// Feature: admin — owner: Dev 1 — MOD-TEN / MOD-ORG administration (TASK-104, TASK-412, TASK-435).
// Lenders (Dev 3, MOD-LND) and products (MOD-PRD) live in the "Lenders and products" domain at /lenders and /products.
import type { RouteObject } from 'react-router-dom';
import { AdminLayout } from './AdminLayout';
import { BranchesPage } from './BranchesPage';
import { LenderDetailPage } from './LenderDetailPage';
import { LendersPage } from './LendersPage';
import { OrganisationPage } from './OrganisationPage';
import { ProductDetailPage } from './ProductDetailPage';
import { ProductsPage } from './ProductsPage';
import { QueueDetailPage, QueuesPage } from './QueuesPage';
import { TeamDetailPage, TeamsPage } from './TeamsPage';

export const routes: RouteObject[] = [
  { path: '/lenders', element: <LendersPage /> },
  { path: '/lenders/:id', element: <LenderDetailPage /> },
  { path: '/products', element: <ProductsPage /> },
  { path: '/products/:id', element: <ProductDetailPage /> },
  {
    path: '/admin',
    element: <AdminLayout />,
    children: [
      { path: '/admin/organisation', element: <OrganisationPage /> },
      { path: '/admin/branches', element: <BranchesPage /> },
      { path: '/admin/teams', element: <TeamsPage /> },
      { path: '/admin/teams/:id', element: <TeamDetailPage /> },
      { path: '/admin/queues', element: <QueuesPage /> },
      { path: '/admin/queues/:id', element: <QueueDetailPage /> },
    ],
  },
];
