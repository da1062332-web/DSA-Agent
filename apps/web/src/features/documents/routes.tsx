// apps/web/src/features/documents/routes.tsx — MOD-DOC checklist slice and document types (owner: Dev 3)
import type { RouteObject } from 'react-router-dom';
import { DocumentsPage } from './DocumentsPage';
import { DocumentTypesPage } from './DocumentTypesPage';

export const routes: RouteObject[] = [
  { path: '/documents', element: <DocumentsPage /> },
  { path: '/documents/types', element: <DocumentTypesPage /> },
];
