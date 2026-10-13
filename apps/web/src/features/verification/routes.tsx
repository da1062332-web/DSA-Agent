// apps/web/src/features/verification/routes.tsx — owner: Developer 2 (Module 19: Verification)
import type { RouteObject } from 'react-router-dom';
import { VerificationDetailPage } from './VerificationDetailPage';
import { VerificationListPage } from './VerificationListPage';

export const routes: RouteObject[] = [
  { path: '/verifications', element: <VerificationListPage /> },
  { path: '/verifications/:id', element: <VerificationDetailPage /> },
];
