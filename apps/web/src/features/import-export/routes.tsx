// apps/web/src/features/import-export/routes.tsx — owner: Platform Squad (MOD-IMP, TASK-413)
import type { RouteObject } from 'react-router-dom';
import { ImportExportPage } from './ImportExportPage';

export const routes: RouteObject[] = [{ path: '/admin/import-export', element: <ImportExportPage /> }];
