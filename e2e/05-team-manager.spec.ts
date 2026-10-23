import { test, expect } from '@playwright/test';
import { PERSONAS } from './helpers/mock-session';
import { AuthPage, ManagerDashboardPage, TasksPage } from './pages';

test.describe('Persona 05: Team Manager (ROLE-TEAM-MGR)', () => {
  // =========================================================================
  // TC-TM-01: Team Management Hub & Workload Allocation
  // =========================================================================
  test('TC-TM-01: Team Management Hub & Workload Allocation', async ({ page }) => {
    const authPage = new AuthPage(page);
    const dashboardPage = new ManagerDashboardPage(page);

    // Mock unassigned leads for team queue
    await page.route('**/v1/leads**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'led_tm_001',
              fullName: 'Deepak Verma',
              mobileMasked: '+91 ••••• ••892',
              productCategory: 'BUSINESS_LOAN',
              state: 'NEW',
              branchId: 'MUM01',
              indicativeAmount: { amount: '1500000.00', currency: 'INR' },
              createdAt: '2026-10-23T00:00:00.000Z',
            },
          ],
          meta: { total: 1 },
        }),
      });
    });

    // Mock team tasks
    await page.route('**/v1/tasks**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'tsk_tm_001',
              title: 'First Contact Follow-up with Applicant',
              status: 'OPEN',
              priority: 'HIGH',
              type: 'FOLLOW_UP',
              linkedType: 'LEAD',
              linkedId: 'led_tm_001',
              branchId: 'MUM01',
              ownerUserId: 'usr_sales_01',
              dueAt: new Date(Date.now() + 86400000).toISOString(),
              lockVersion: 1,
              createdAt: new Date().toISOString(),
            },
          ],
          pagination: { nextCursor: null, hasMore: false },
        }),
      });
    });

    // 1. Role Login via Page Object
    await authPage.loginAs(PERSONAS.teamMgr, '/');

    // 2. Verify Team Management Hub
    await dashboardPage.showBanner(
      'Team Hub',
      'Supervising team task queues, SLA milestones and inbound leads',
    );
    await expect(dashboardPage.dashboard).toBeVisible();
    await expect(dashboardPage.hubHeading).toBeVisible();
    await expect(page.getByText('Deepak Verma')).toBeVisible();
    await dashboardPage.pause(1500);

    // 3. Role Logout via Page Object
    await authPage.logout();
  });

  // =========================================================================
  // TC-TM-02: Team Task Supervision & SLA Tracking (MOD-TASK)
  // =========================================================================
  test('TC-TM-02: Team Task Supervision & SLA Tracking', async ({ page }) => {
    const authPage = new AuthPage(page);
    const tasksPage = new TasksPage(page);

    await page.route('**/v1/tasks**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'tsk_tm_002',
              title: 'Verify Financials & Bank Statement Analysis',
              status: 'OPEN',
              priority: 'HIGH',
              type: 'DOCUMENT_COLLECTION',
              linkedType: 'LEAD',
              linkedId: 'led_tm_001',
              branchId: 'MUM01',
              ownerUserId: 'usr_sales_01',
              dueAt: new Date(Date.now() + 86400000).toISOString(),
              lockVersion: 1,
              createdAt: new Date().toISOString(),
            },
          ],
          pagination: { nextCursor: null, hasMore: false },
        }),
      });
    });

    // 1. Role Login via Page Object
    await authPage.loginAs(PERSONAS.teamMgr, '/tasks');

    // 2. Verify Tasks Management
    await tasksPage.showBanner('Team Tasks', 'Reviewing team task items and active SLA clocks (MOD-TASK)');
    await expect(page.getByText('Verify Financials & Bank Statement Analysis')).toBeVisible();
    await tasksPage.pause(1500);

    // 3. Role Logout via Page Object
    await authPage.logout();
  });

  // =========================================================================
  // TC-TM-03: Segregation of Duties & Access Control Boundaries
  // =========================================================================
  test('TC-TM-03: Segregation of Duties & Access Control Boundaries', async ({ page }) => {
    const authPage = new AuthPage(page);
    const dashboardPage = new ManagerDashboardPage(page);

    // 1. Role Login via Page Object
    await authPage.loginAs(PERSONAS.teamMgr, '/');

    // 2. Verify Team Manager authority
    await dashboardPage.showBanner(
      'Access Boundary Check',
      'Verifying Team Manager operational scope and denial of admin/financial screens',
    );
    await expect(dashboardPage.dashboard).toBeVisible();
    await dashboardPage.pause(1200);

    // 3. Admin and financial screens are refused (no user.manage, config.manage or finance grant)
    await dashboardPage.expectForbidden('/platform-admin');
    await dashboardPage.expectForbidden('/users');
    await dashboardPage.expectForbidden('/config');
    await dashboardPage.expectForbidden('/commission');
    await dashboardPage.expectForbidden('/payouts');
    await dashboardPage.pause(1500);

    // 4. Role Logout via Page Object
    await authPage.logout();
  });
});
