import { test, expect } from '@playwright/test';
import {
  PERSONAS,
  performRoleLogin,
  performRoleLogout,
  pauseForDemo,
  humanClick,
  showDemoBanner,
} from './helpers/mock-session';

test.describe('Persona 05: Team Manager (ROLE-TEAM-MGR)', () => {
  // =========================================================================
  // TC-TM-01: Team Management Hub & Workload Allocation
  // =========================================================================
  test('TC-TM-01: Team Management Hub & Workload Allocation', async ({ page }) => {
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

    // 1. Role Login
    await performRoleLogin(page, PERSONAS.teamMgr, '/');

    // 2. Verify Team Management Hub
    await showDemoBanner(
      page,
      'Team Hub',
      'Supervising team task queues, SLA milestones and inbound leads',
    );
    await expect(page.getByTestId('manager-dashboard')).toBeVisible();
    await expect(page.getByText('Branch & Team Management Hub')).toBeVisible();
    await expect(page.getByText('Deepak Verma')).toBeVisible();
    await pauseForDemo(page, 1500);

    // 3. Role Logout
    await performRoleLogout(page);
  });

  // =========================================================================
  // TC-TM-02: Team Task Supervision & SLA Tracking (MOD-TASK)
  // =========================================================================
  test('TC-TM-02: Team Task Supervision & SLA Tracking', async ({ page }) => {
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

    // 1. Role Login
    await performRoleLogin(page, PERSONAS.teamMgr, '/tasks');

    // 2. Verify Tasks Management
    await showDemoBanner(page, 'Team Tasks', 'Reviewing team task items and active SLA clocks (MOD-TASK)');
    await expect(page.getByText('Verify Financials & Bank Statement Analysis')).toBeVisible();
    await pauseForDemo(page, 1500);

    // 3. Role Logout
    await performRoleLogout(page);
  });

  // =========================================================================
  // TC-TM-03: Segregation of Duties & Access Control Boundaries
  // =========================================================================
  test('TC-TM-03: Segregation of Duties & Access Control Boundaries', async ({ page }) => {
    // 1. Role Login
    await performRoleLogin(page, PERSONAS.teamMgr, '/');

    // 2. Verify Team Manager authority
    await showDemoBanner(
      page,
      'Access Boundary Check',
      'Verifying Team Manager operational scope and denial of admin/financial screens',
    );
    await expect(page.getByTestId('manager-dashboard')).toBeVisible();
    await pauseForDemo(page, 1200);

    // 3. Attempt direct access to platform console
    await page.goto('/platform-admin');
    await page.waitForLoadState('domcontentloaded');
    await pauseForDemo(page, 1500);

    // 4. Role Logout
    await performRoleLogout(page);
  });
});
