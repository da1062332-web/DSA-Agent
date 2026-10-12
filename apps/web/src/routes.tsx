// Route table (owner: Dev 1). Every MVP route from Assignment Matrix §5 exists from Gate 0.
// Each feature folder exports `routes` from its own routes.tsx and they are composed here automatically,
// so feature owners never edit this file.
import type { RouteObject } from 'react-router-dom';
import { AppLayout } from './shell/AppLayout';
import { Placeholder } from './shell/Placeholder';

const featureModules = import.meta.glob<{ routes: RouteObject[] }>('./features/*/routes.tsx', {
  eager: true,
});

export const featureRoutes: RouteObject[] = Object.values(featureModules).flatMap((m) => m.routes);

export const routes: RouteObject[] = [
  { path: '/login', element: <Placeholder name="UI-PLT-001 sign in" owner="Dev 1" /> },
  { path: '/mfa', element: <Placeholder name="UI-PLT-001 TOTP challenge" owner="Dev 1" /> },
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <Placeholder name="UI-PLT-001 home" owner="Dev 1" /> },
      ...featureRoutes,
      { path: '*', element: <Placeholder name="Page not found" owner="Dev 1" /> },
    ],
  },
];
