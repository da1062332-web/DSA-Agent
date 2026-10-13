// Feature: tasks — owner: Dev 6 — UI-TASK-001 (Day 4).
// Also serves the follow-up deep link: /tasks?new=1&subjectType=<LEAD|LOAN_APPLICATION|LENDER_CASE>&subjectId=<id>
import type { RouteObject } from 'react-router-dom';
import { TaskList } from './TaskList';

export const routes: RouteObject[] = [
  { path: '/tasks', element: <TaskList /> },
];
