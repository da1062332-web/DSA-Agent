// Feature: rules and decisions — owner: Dev 6 — UI-BRE-001 (Day 3). Replace the elements; keep the paths.
import type { RouteObject } from 'react-router-dom';
import { Placeholder } from '../../shell/Placeholder';

export const routes: RouteObject[] = [
  { path: '/rules', element: <Placeholder name="UI-BRE-001 rule sets" owner="Dev 6" /> },
  { path: '/rules/:ruleSetId', element: <Placeholder name="UI-BRE-001 rule set" owner="Dev 6" /> },
  {
    path: '/rules/versions/:versionId',
    element: <Placeholder name="UI-BRE-001 rule version" owner="Dev 6" />,
  },
  { path: '/decisions', element: <Placeholder name="UI-BRE-001 decision records" owner="Dev 6" /> },
  { path: '/decisions/:id', element: <Placeholder name="UI-BRE-001 decision record" owner="Dev 6" /> },
];
