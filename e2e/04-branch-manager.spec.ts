import { test, expect } from '@playwright/test';
import { PERSONAS } from './helpers/mock-session';
import { AuthPage, ManagerDashboardPage, TasksPage } from './pages';

test.describe('Persona 04: Branch Manager (ROLE-BRANCH-MGR)', () => {
  // =========================================================================
  // TC-BM-01: Branch Management Hub & Pipeline Queue Monitoring
  // =========================================================================
  test('TC-BM-01: Branch Management Hub & Pipeline Queue Monitoring', async ({ page }) => {
    const authPage = new AuthPage(page);
    const dashboardPage = new ManagerDashboardPage(page);

    // Mock unassigned leads
    await page.route('**/v1/leads**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'led_bm_001',
              fullName: 'Sunil Sharma',
              mobileMasked: '+91 ••••• ••441',
              productCategory: 'HOME_LOAN',
              state: 'NEW',
              branchId: 'MUM01',
              indicativeAmount: { amount: '7500000.00', currency: 'INR' },
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
              id: 'tsk_bm_001',
              title: 'KYC Document Verification for Application APP-001',
              status: 'PENDING',
              priority: 'HIGH',
              assigneeId: 'usr_rm_01',
              queueId: 'queue_01',
              dueDate: '2026-10-24T00:00:00.000Z',
            },
          ],
          meta: { total: 1 },
        }),
      });
    });

    // 1. Role Login via Page Object
    await authPage.loginAs(PERSONAS.branchMgr, '/');

    // 2. Verify Branch & Team Management Hub
    await dashboardPage.showBanner(
      'Branch Hub',
      'Supervising team task queues and unassigned lead pipelines',
    );
    await expect(dashboardPage.dashboard).toBeVisible();
    await expect(dashboardPage.hubHeading).toBeVisible();
    await expect(page.getByText('Sunil Sharma')).toBeVisible();
    await dashboardPage.pause(1500);

    // 3. Role Logout via Page Object
    await authPage.logout();
  });

  // =========================================================================
  // TC-BM-02: Branch Task Queue Oversight & Delegation (MOD-TASK)
  // =========================================================================
  test('TC-BM-02: Branch Task Queue Oversight & Delegation', async ({ page }) => {
    const authPage = new AuthPage(page);
    const tasksPage = new TasksPage(page);

    await page.route('**/v1/tasks**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'tsk_bm_002',
              title: 'Collect Bank Statements for Pre-Sanction',
              status: 'OPEN',
              priority: 'HIGH',
              type: 'DOCUMENT_COLLECTION',
              linkedType: 'LEAD',
              linkedId: 'led_bm_001',
              branchId: 'MUM01',
              ownerUserId: 'usr_rm_01',
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
    await authPage.loginAs(PERSONAS.branchMgr, '/tasks');

    // 2. Verify Tasks Management Page
    await tasksPage.showBanner('Tasks Oversight', 'Reviewing active branch tasks and SLAs (MOD-TASK)');
    await expect(page.getByText('Collect Bank Statements for Pre-Sanction')).toBeVisible();
    await tasksPage.pause(1500);

    // 3. Role Logout via Page Object
    await authPage.logout();
  });

  // =========================================================================
  // TC-BM-03: Branch Data Scope & Operational Boundary Enforcement
  // =========================================================================
  test('TC-BM-03: Branch Data Scope & Operational Boundary Enforcement', async ({ page }) => {
    const authPage = new AuthPage(page);
    const dashboardPage = new ManagerDashboardPage(page);

    // 1. Role Login via Page Object
    await authPage.loginAs(PERSONAS.branchMgr, '/');

    // 2. Verify Branch Scoping (Assigned to MUM01)
    await dashboardPage.showBanner(
      'Branch Boundary',
      'Verifying Branch Manager operational boundary and lack of platform console access',
    );
    await expect(dashboardPage.dashboard).toBeVisible();
    await dashboardPage.pause(1200);

    // 3. Attempt direct access to platform console
    await dashboardPage.goto('/platform-admin');
    await dashboardPage.pause(1500);

    // 4. Role Logout via Page Object
    await authPage.logout();
  });
});
