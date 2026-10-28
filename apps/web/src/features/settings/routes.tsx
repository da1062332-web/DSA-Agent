// Feature: settings — owner: Dev 1 — Dedicated Settings Hub (MOD-CFG, MOD-TEN, MOD-USR, MOD-SEC)
import type { RouteObject } from 'react-router-dom';
import { SettingsLayout } from './SettingsLayout';
import { SettingsOverviewPage } from './SettingsOverviewPage';

export const routes: RouteObject[] = [
  {
    path: '/settings',
    element: <SettingsLayout />,
    children: [
      { index: true, element: <SettingsOverviewPage /> },
    ],
  },
];
