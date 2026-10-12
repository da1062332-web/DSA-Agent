// apps/web/src/features/messaging/routes.tsx — owner: Dev 1
import type { RouteObject } from 'react-router-dom';
import { MessagingPage } from './MessagingPage';

export const routes: RouteObject[] = [
  { path: '/messaging', element: <MessagingPage defaultTab={0} /> },
  { path: '/message-templates', element: <MessagingPage defaultTab={0} /> },
];
