// apps/web/src/features/verifications/routes.tsx — Module 22: Verification (MOD-VER)
import type { RouteObject } from 'react-router-dom';
import { VerificationDetailPage } from './VerificationDetailPage';
import { VerificationListPage } from './VerificationListPage';
import { VerificationPage } from './VerificationPage';

export const routes: RouteObject[] = [
  { path: '/verifications', element: <VerificationListPage /> },
  { path: '/verifications/workbench', element: <VerificationPage /> },
  { path: '/verifications/:id', element: <VerificationDetailPage /> },
];
