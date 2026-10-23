// apps/web/src/features/connectors/routes.tsx
import type { RouteObject } from 'react-router-dom';
import { ConnectorPage } from './ConnectorPage';
import { ConnectorPortalPage } from './ConnectorPortalPage';

export const routes: RouteObject[] = [
  { path: '/connectors', element: <ConnectorPage /> },
  { path: '/connector-portal', element: <ConnectorPortalPage /> },
];
