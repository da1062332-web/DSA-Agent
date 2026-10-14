// apps/web/src/features/rules/routes.tsx — owner: Dev 6 — UI-BRE-001 (Day 3)
import type { RouteObject } from 'react-router-dom';
import { DecisionRecordDetailPage } from './DecisionRecordDetailPage';
import { DecisionRecordsListPage } from './DecisionRecordsListPage';
import { RuleSetDetailPage } from './RuleSetDetailPage';
import { RulesListPage } from './RulesListPage';
import { RuleVersionDetailPage } from './RuleVersionDetailPage';

export const routes: RouteObject[] = [
  { path: '/rules', element: <RulesListPage /> },
  { path: '/rules/:ruleSetId', element: <RuleSetDetailPage /> },
  { path: '/rules/versions/:versionId', element: <RuleVersionDetailPage /> },
  { path: '/decisions', element: <DecisionRecordsListPage /> },
  { path: '/decisions/:id', element: <DecisionRecordDetailPage /> },
];
