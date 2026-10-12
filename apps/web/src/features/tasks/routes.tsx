// Feature: tasks — owner: Dev 6 — UI-TASK-001 (Day 4). Replace the element; keep the path.
// Also serves the follow-up deep link: /tasks?new=1&subjectType=<LEAD|LOAN_APPLICATION|LENDER_CASE>&subjectId=<id>
import type { RouteObject } from 'react-router-dom';
import { Placeholder } from '../../shell/Placeholder';

export const routes: RouteObject[] = [
  { path: '/tasks', element: <Placeholder name="UI-TASK-001 tasks" owner="Dev 6" /> },
];
