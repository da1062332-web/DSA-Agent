// Feature: workforce — owner: Dev 1 — MOD-WRK Workforce (TASK-428). Composed into app shell automatically.
import type { RouteObject } from 'react-router-dom';
import { WorkforcePage } from './WorkforcePage';

export const routes: RouteObject[] = [
  { path: '/workforce', element: <WorkforcePage /> },
];
