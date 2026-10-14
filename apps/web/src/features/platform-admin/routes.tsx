import React from 'react';
import type { RouteObject } from 'react-router-dom';
import { PlatformConsolePage } from './PlatformConsolePage';

export const routes: RouteObject[] = [
  { path: '/platform-admin', element: <PlatformConsolePage /> },
  { path: '/platform-console', element: <PlatformConsolePage /> },
];
