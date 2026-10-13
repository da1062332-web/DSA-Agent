// Route table (owner: Dev 1). Every MVP route from Assignment Matrix §5 exists from Gate 0.
// Each feature folder exports `routes` from its own routes.tsx and they are composed here automatically,
// so feature owners never edit this file.
import type { RouteObject } from 'react-router-dom';
import { LoginPage } from './auth/LoginPage';
import { MfaPage } from './auth/MfaPage';
import { ForgotPasswordPage, ResetPasswordPage } from './auth/PasswordPages';
import { SecurityPage } from './auth/SecurityPage';
import { AppLayout } from './shell/AppLayout';
import { HomePage } from './shell/HomePage';
import { Placeholder } from './shell/Placeholder';

const featureModules = import.meta.glob<{ routes: RouteObject[] }>('./features/*/routes.tsx', {
  eager: true,
});

export const featureRoutes: RouteObject[] = Object.values(featureModules).flatMap((m) => m.routes);

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/mfa', element: <MfaPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/account/security', element: <SecurityPage /> },
      ...featureRoutes,
      { path: '*', element: <Placeholder name="Page not found" owner="Dev 1" /> },
    ],
  },
];
