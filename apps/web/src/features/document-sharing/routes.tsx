// apps/web/src/features/document-sharing/routes.tsx
import type { RouteObject } from 'react-router-dom';
import { DocumentSharingPage } from './DocumentSharingPage';

export const routes: RouteObject[] = [
  { path: '/document-sharing', element: <DocumentSharingPage /> },
];
