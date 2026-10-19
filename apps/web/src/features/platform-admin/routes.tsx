import React from 'react';
import type { RouteObject } from 'react-router-dom';
import { PlatformConsolePage } from './PlatformConsolePage';
import { TenantDetailPage } from './TenantDetailPage';

export const routes: RouteObject[] = [
  { path: '/platform-admin', element: <PlatformConsolePage /> },
  { path: '/platform-console', element: <PlatformConsolePage /> },
  { path: '/platform-admin/tenants/:tenantId', element: <TenantDetailPage /> },
  { path: '/platform-console/tenants/:tenantId', element: <TenantDetailPage /> },
];
