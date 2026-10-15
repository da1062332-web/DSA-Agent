// apps/web/src/features/automation/routes.tsx — owner: Akash (Module 24: Workflow Automation MOD-WFA)
import type { RouteObject } from 'react-router-dom';
import { AutomationListPage } from './AutomationListPage';
import { AutomationDetailPage } from './AutomationDetailPage';

export const routes: RouteObject[] = [
  {
    path: '/automations',
    element: <AutomationListPage />,
  },
  {
    path: '/automations/:id',
    element: <AutomationDetailPage />,
  },
];
