// apps/web/src/features/documents/routes.tsx — MOD-DOC checklist slice (owner: Dev 3)
import type { RouteObject } from 'react-router-dom';
import { DocumentsPage } from './DocumentsPage';

export const routes: RouteObject[] = [{ path: '/documents', element: <DocumentsPage /> }];
