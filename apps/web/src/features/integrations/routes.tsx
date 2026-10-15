// apps/web/src/features/integrations/routes.tsx
import React from 'react';
import type { RouteObject } from 'react-router-dom';
import { IntegrationsPage } from './IntegrationsPage';

export const routes: RouteObject[] = [
  { path: '/integrations', element: <IntegrationsPage /> },
  { path: '/admin/integrations', element: <IntegrationsPage /> },
];
