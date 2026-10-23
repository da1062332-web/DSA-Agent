// Feature: applications — owner: Dev 3 — UI-APP-001 (Module 16). Paths are unchanged from the placeholder.
// The lender-case panel on /applications/:id is Dev 4's, mounted through the extension slot in ApplicationDetailPage.
import type { RouteObject } from 'react-router-dom';
import { ApplicationDetailPage } from './ApplicationDetailPage';
import { ApplicationsPage } from './ApplicationsPage';
import { EligibilityPage } from './EligibilityPage';

export const routes: RouteObject[] = [
  { path: '/applications', element: <ApplicationsPage /> },
  { path: '/applications/:id', element: <ApplicationDetailPage /> },
  { path: '/eligibility', element: <EligibilityPage /> },
];
