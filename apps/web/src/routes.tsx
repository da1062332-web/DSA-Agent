// Route table (owner: Dev 1). Every MVP route from Assignment Matrix §5 exists from Gate 0.
// Each feature folder exports `routes` from its own routes.tsx and they are composed here automatically,
// so feature owners never edit this file.
import type { RouteObject } from 'react-router-dom';
import { AcceptInvitationPage } from './auth/AcceptInvitationPage';
import { LoginPage, MfaRedirect } from './auth/LoginPage';
import { ForgotPasswordPage, ResetPasswordPage } from './auth/PasswordPages';
import { SecurityPage } from './auth/SecurityPage';
import { PublicUploadPage } from './features/document-sharing/PublicUploadPage';
import { AppLayout } from './shell/AppLayout';
import { HomePage } from './shell/HomePage';
import { RoleDashboardRouter } from './features/dashboard/RoleDashboardRouter';
import { Placeholder } from './shell/Placeholder';
import { RouteErrorBoundary } from './shell/RouteErrorBoundary';

const featureModules = import.meta.glob<{ routes: RouteObject[] }>('./features/*/routes.tsx', {
  eager: true,
});

// A feature whose routes did not load (a stale dev server, a failed import) is skipped and named in the console, so one
// broken feature cannot take the whole app down with a router error.
export const featureRoutes: RouteObject[] = Object.entries(featureModules).flatMap(([file, m]) => {
  if (!Array.isArray(m?.routes)) {
    console.error(
      `Routes missing for ${file}: restart the dev server (npm run dev -- --force) if this persists.`,
    );
    return [];
  }
  return m.routes.filter((r): r is RouteObject => !!r);
});

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/mfa', element: <MfaRedirect /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/accept-invitation', element: <AcceptInvitationPage /> },
  { path: '/upload/:token', element: <PublicUploadPage /> },
  {
    element: <AppLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { path: '/', element: <RoleDashboardRouter /> },
      { path: '/account/security', element: <SecurityPage /> },
      ...featureRoutes,
      { path: '*', element: <Placeholder name="Page not found" owner="Dev 1" /> },
    ],
  },
];
