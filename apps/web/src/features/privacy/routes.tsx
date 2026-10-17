// apps/web/src/features/privacy/routes.tsx
import React from 'react';
import type { RouteObject } from 'react-router-dom';
import { PrivacyDashboard } from './PrivacyDashboard';

export const routes: RouteObject[] = [{ path: '/privacy', element: <PrivacyDashboard /> }];
