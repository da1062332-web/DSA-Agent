import type { RouteObject } from 'react-router-dom';
import { PermissionsCatalogPage } from './PermissionsCatalogPage';
import { RoleDetailPage } from './RoleDetailPage';
import { RolesListPage } from './RolesListPage';

export const routes: RouteObject[] = [
  {
    path: '/roles',
    element: <RolesListPage />,
  },
  {
    path: '/roles/:id',
    element: <RoleDetailPage />,
  },
  {
    path: '/permissions',
    element: <PermissionsCatalogPage />,
  },
];
