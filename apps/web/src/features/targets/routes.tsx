// Feature: targets — owner: Dev 5 — MOD-PERF SUB-PERF.01 Targets (TASK-428). Composed into app shell automatically.
import type { RouteObject } from 'react-router-dom';
import { TargetsPage } from './TargetsPage';

export const routes: RouteObject[] = [{ path: '/targets', element: <TargetsPage /> }];
