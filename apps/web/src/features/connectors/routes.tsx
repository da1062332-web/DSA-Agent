// apps/web/src/features/connectors/routes.tsx
import type { RouteObject } from 'react-router-dom';
import { ConnectorPage } from './ConnectorPage';

export const routes: RouteObject[] = [
  { path: '/connectors', element: <ConnectorPage /> },
];
