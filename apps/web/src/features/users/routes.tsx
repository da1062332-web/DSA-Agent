// Feature: users — owner: Akash (Developer 2) (Module 4: Users).
import type { RouteObject } from 'react-router-dom';
import { UserCreatePage } from './UserCreatePage';
import { UserDetailPage } from './UserDetailPage';
import { UserListPage } from './UserListPage';

export const routes: RouteObject[] = [
  { path: '/users', element: <UserListPage /> },
  { path: '/users/new', element: <UserCreatePage /> },
  { path: '/users/:id', element: <UserDetailPage /> },
];
