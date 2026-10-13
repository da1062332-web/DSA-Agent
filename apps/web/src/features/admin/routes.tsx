// Feature: admin — owner: Dev 1 — MOD-TEN / MOD-ORG administration (TASK-104, TASK-412, TASK-435).
import type { RouteObject } from 'react-router-dom';
import { AdminLayout } from './AdminLayout';
import { BranchesPage } from './BranchesPage';
import { LenderDetailPage } from './LenderDetailPage';
import { LendersPage } from './LendersPage';
import { OrganisationPage } from './OrganisationPage';
import { QueueDetailPage, QueuesPage } from './QueuesPage';
import { TeamDetailPage, TeamsPage } from './TeamsPage';

export const routes: RouteObject[] = [
  {
    path: '/admin',
    element: <AdminLayout />,
    children: [
      { path: '/admin/organisation', element: <OrganisationPage /> },
      { path: '/admin/branches', element: <BranchesPage /> },
      { path: '/admin/lenders', element: <LendersPage /> },
      { path: '/admin/lenders/:id', element: <LenderDetailPage /> },
      { path: '/admin/teams', element: <TeamsPage /> },
      { path: '/admin/teams/:id', element: <TeamDetailPage /> },
      { path: '/admin/queues', element: <QueuesPage /> },
      { path: '/admin/queues/:id', element: <QueueDetailPage /> },
    ],
  },
];
