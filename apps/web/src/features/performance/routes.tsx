// Feature: performance — owner: Dev 5 — MOD-PERF SUB-PERF.02 & SUB-PERF.03. Composed into app shell automatically.
import type { RouteObject } from 'react-router-dom';
import { PerformanceDashboardPage } from './PerformanceDashboardPage';
import { LeaderboardPage } from './LeaderboardPage';

export const routes: RouteObject[] = [
  { path: '/performance', element: <PerformanceDashboardPage /> },
  { path: '/performance/leaderboard', element: <LeaderboardPage /> },
];
