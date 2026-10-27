// Feature x role coverage: every sidebar screen is opened by every customer-tenant persona.
// A persona that may open a screen sees its page header; a persona that may not sees the Forbidden page and no sidebar link.
// The allow/deny truth is the one the app itself uses (apps/web/src/shell/access.ts), so this spec fails if a screen is
// reachable by a role that should not have it, or hidden from a role that needs it. Manual flows: Notion guide pages 02 to 13.
import { test, expect, type Page } from '@playwright/test';
import { NAV_GROUPS, routeAllowed, visibleGroups } from '../apps/web/src/shell/access';
import { PERSONAS, type PersonaConfig } from './helpers/mock-session';
import { AuthPage } from './pages';

const FORBIDDEN = 'You do not have permission to access this page.';

/** Page header text of each screen (title prop of its PageHeader). */
const SCREENS: { to: string; label: string; title: string; feature: string }[] = [
  { to: '/tasks', label: 'Tasks', title: 'Tasks', feature: 'Tasks and follow-ups' },
  { to: '/approvals', label: 'Approvals', title: 'Approvals', feature: 'Maker-checker approvals' },
  { to: '/activities', label: 'Activity', title: 'Activities', feature: 'Activity log' },
  { to: '/notifications', label: 'Notifications', title: 'Notification Inbox', feature: 'Notification inbox' },
  { to: '/leads', label: 'Leads', title: 'Leads', feature: 'Lead capture and qualification' },
  { to: '/customers', label: 'Customers', title: 'Customers', feature: 'Customer profiles' },
  { to: '/messaging', label: 'Messaging', title: 'Messaging', feature: 'Messaging and templates' },
  { to: '/complaints', label: 'Grievances', title: 'Complaints', feature: 'Grievances' },
  { to: '/applications', label: 'Applications', title: 'Applications', feature: 'Loan applications' },
  { to: '/documents', label: 'Documents', title: 'Documents', feature: 'Document checklist and storage' },
  { to: '/document-sharing', label: 'Document sharing', title: 'Document Sharing', feature: 'Customer upload links' },
  { to: '/verifications', label: 'Verification', title: 'Verification Cases', feature: 'Verification cases' },
  {
    to: '/verifications/workbench',
    label: 'Verification workbench',
    title: 'Verification Workbench',
    feature: 'Verification workbench',
  },
  { to: '/lender-cases', label: 'Lender cases', title: 'Lender Cases', feature: 'Lender cases' },
  {
    to: '/sanctions',
    label: 'Sanction and disbursement',
    title: 'Sanctions & Disbursements',
    feature: 'Sanction and disbursement',
  },
  { to: '/eligibility', label: 'Eligibility', title: 'Credit & Eligibility Engine', feature: 'Eligibility engine' },
  { to: '/lenders', label: 'Lenders', title: 'Lender Directory', feature: 'Lender directory' },
  { to: '/products', label: 'Products', title: 'Loan Product Catalogue', feature: 'Product catalogue' },
  { to: '/commission', label: 'Commission', title: 'Commission Management Hub', feature: 'Commission' },
  { to: '/payouts', label: 'Payouts', title: 'Payouts & Settlement Hub', feature: 'Payouts' },
  { to: '/ledger', label: 'Ledger', title: 'Ledger Management', feature: 'Ledger' },
  { to: '/invoices', label: 'Invoices', title: 'Invoices & Statements', feature: 'Invoices' },
  { to: '/reconciliation', label: 'Reconciliation', title: 'Reconciliation Management', feature: 'Reconciliation' },
  { to: '/connectors', label: 'Connectors', title: 'Connectors', feature: 'Connector onboarding' },
  { to: '/workforce', label: 'Workforce', title: 'Workforce Management', feature: 'Workforce and availability' },
  { to: '/connector-portal', label: 'Connector portal', title: 'Connector Partner Portal', feature: 'Connector portal' },
  {
    to: '/performance',
    label: 'Performance Dashboard',
    title: 'Team Performance Dashboard',
    feature: 'Performance dashboard',
  },
  { to: '/targets', label: 'Targets', title: 'Performance Targets', feature: 'Targets' },
  { to: '/performance/leaderboard', label: 'Leaderboard', title: 'Performance Leaderboards', feature: 'Leaderboard' },
  { to: '/reports', label: 'Reports & Catalogue', title: 'Reports and Analytics', feature: 'Reports' },
  { to: '/rules', label: 'Rule sets', title: 'Business Rule Engine', feature: 'Rule sets' },
  { to: '/decisions', label: 'Decisions', title: 'Decision Execution Audit Records', feature: 'Decision records' },
  { to: '/automations', label: 'Automation rules', title: 'Workflow Automation Engine', feature: 'Workflow automation' },
  { to: '/users', label: 'Users', title: 'Staff User Management', feature: 'User management' },
  { to: '/roles', label: 'Access control', title: 'Access Control & Roles', feature: 'Roles and permissions' },
  { to: '/admin/organisation', label: 'Organisation', title: 'Organisation', feature: 'Organisation' },
  { to: '/admin/branches', label: 'Branches', title: 'Branches', feature: 'Branches' },
  { to: '/admin/teams', label: 'Teams', title: 'Teams', feature: 'Teams' },
  { to: '/admin/queues', label: 'Work queues', title: 'Work queues', feature: 'Work queues' },
  { to: '/config', label: 'Configuration', title: 'Tenant Configuration & Settings', feature: 'Configuration' },
  { to: '/audit', label: 'Audit', title: 'Audit Trail & Cryptographic Verification', feature: 'Audit trail' },
  { to: '/privacy', label: 'Privacy and consent', title: 'Privacy & Consent Governance', feature: 'Privacy and consent' },
  {
    to: '/security',
    label: 'Security events and incidents',
    title: 'Security events and incidents',
    feature: 'Security incidents',
  },
  { to: '/integrations', label: 'Integrations', title: 'Integration Management', feature: 'Integrations' },
  {
    to: '/api-management',
    label: 'API management',
    title: 'API Management & Credentials',
    feature: 'API management',
  },
  { to: '/admin/import-export', label: 'Import and export', title: 'Import and Export', feature: 'Import and export' },
];

const TENANT_PERSONAS = Object.entries(PERSONAS).filter(
  ([key]) => key !== 'platformSuperAdmin',
) as [string, PersonaConfig][];

/** Answer every other /v1 call with an empty list so a screen renders its header without a real API. */
async function stubEmptyApi(page: Page) {
  await page.route('**/v1/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], meta: { nextCursor: null, limit: 50 } }),
    });
  });
  // Screens that read one object, not a list, crash on an empty list.
  await page.route('**/v1/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { ETag: '"1"' },
      body: JSON.stringify({
        tenant: {
          id: 'ten_e2e',
          slug: 'qloax-dsa',
          legalName: 'Qloax Finserv Private Limited',
          tenantType: 'DSA',
          dataRegion: 'ap-south-1',
          timezone: 'Asia/Kolkata',
          status: 'ACTIVE',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        organisation: { id: 'org_e2e', name: 'Qloax Finserv', constitution: 'PRIVATE_LIMITED', lockVersion: 1 },
        operationalSettings: {},
      }),
    });
  });
}

test.describe('Feature x role matrix (all customer-tenant roles)', () => {
  test('TC-MATRIX-00: every sidebar screen is covered by this matrix', () => {
    const inMenu = NAV_GROUPS.flatMap((g) => g.items)
      .filter((i) => i.to && i.to !== '/' && i.to !== '/platform-admin' && i.to !== '/account/security')
      .map((i) => i.to);
    const covered = SCREENS.map((s) => s.to);
    expect(inMenu.filter((to) => !covered.includes(to))).toEqual([]);
  });

  for (const [key, persona] of TENANT_PERSONAS) {
    const can = (code: string) => persona.permissions.includes(code);

    test(`TC-MATRIX-${persona.roleCode}: sidebar shows exactly the screens this role may open`, async ({ page }) => {
      const auth = new AuthPage(page);
      await stubEmptyApi(page);
      await auth.loginAs(persona, '/');

      const sidebar = page.getByTestId('shell.sidebar');
      await expect(sidebar).toBeVisible();

      const shown = new Set(
        visibleGroups(false, can)
          .flatMap((g) => g.items)
          .filter((i) => i.to)
          .map((i) => i.label),
      );
      for (const screen of SCREENS) {
        const link = sidebar.getByRole('link', { name: screen.label, exact: true });
        if (shown.has(screen.label)) {
          await expect(link, `${key} should see ${screen.label}`).toBeVisible();
        } else {
          await expect(link, `${key} should not see ${screen.label}`).toHaveCount(0);
        }
      }
      await auth.logout();
    });

    test(`TC-MATRIX-${persona.roleCode}-ROUTES: each screen opens or is refused for this role`, async ({ page }) => {
      test.setTimeout(900_000);
      const auth = new AuthPage(page);
      await stubEmptyApi(page);
      await auth.loginAs(persona, '/');

      for (const screen of SCREENS) {
        await page.goto(screen.to);
        if (routeAllowed(screen.to, can, false)) {
          await expect(page.getByText(FORBIDDEN), `${key} should open ${screen.feature}`).toHaveCount(0);
          await expect(
            page.getByText(screen.title, { exact: false }).first(),
            `${key} on ${screen.to}: header "${screen.title}"`,
          ).toBeVisible();
        } else {
          await expect(page.getByText(FORBIDDEN), `${key} must be refused ${screen.feature}`).toBeVisible();
        }
      }
      await auth.logout();
    });
  }
});
