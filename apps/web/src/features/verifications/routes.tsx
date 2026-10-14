// apps/web/src/features/verifications/routes.tsx
import type { RouteObject } from 'react-router-dom';
import { VerificationPage } from './VerificationPage';

export const routes: RouteObject[] = [
  { path: '/verifications', element: <VerificationPage /> },
];
