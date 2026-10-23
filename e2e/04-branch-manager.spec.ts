import { test, expect } from '@playwright/test';
import {
  PERSONAS,
  performRoleLogin,
  performRoleLogout,
  pauseForDemo,
  humanClick,
  showDemoBanner,
} from './helpers/mock-session';

test.describe('Persona 04: Branch Manager (ROLE-BRANCH-MGR)', () => {
  // =========================================================================
  // TC-BM-01: Branch Management Hub & Pipeline Queue Monitoring
  // =========================================================================
  test('TC-BM-01: Branch Management Hub & Pipeline Queue Monitoring', async ({ page }) => {
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

    // 1. Role Login
    await performRoleLogin(page, PERSONAS.branchMgr, '/');

    // 2. Verify Branch & Team Management Hub
    await showDemoBanner(
      page,
      'Branch Hub',
      'Supervising team task queues and unassigned lead pipelines',
    );
    await expect(page.getByTestId('manager-dashboard')).toBeVisible();
    await expect(page.getByText('Branch & Team Management Hub')).toBeVisible();
    await expect(page.getByText('Sunil Sharma')).toBeVisible();
    await pauseForDemo(page, 1500);

    // 3. Role Logout
    await performRoleLogout(page);
  });

  // =========================================================================
  // TC-BM-02: Branch Task Queue Oversight & Delegation (MOD-TASK)
  // =========================================================================
  test('TC-BM-02: Branch Task Queue Oversight & Delegation', async ({ page }) => {
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

    // 1. Role Login
    await performRoleLogin(page, PERSONAS.branchMgr, '/tasks');

    // 2. Verify Tasks Management Page
    await showDemoBanner(page, 'Tasks Oversight', 'Reviewing active branch tasks and SLAs (MOD-TASK)');
    await expect(page.getByText('Collect Bank Statements for Pre-Sanction')).toBeVisible();
    await pauseForDemo(page, 1500);

    // 3. Role Logout
    await performRoleLogout(page);
  });

  // =========================================================================
  // TC-BM-03: Branch Data Scope & Operational Boundary Enforcement
  // =========================================================================
  test('TC-BM-03: Branch Data Scope & Operational Boundary Enforcement', async ({ page }) => {
    // 1. Role Login
    await performRoleLogin(page, PERSONAS.branchMgr, '/');

    // 2. Verify Branch Scoping (Assigned to MUM01)
    await showDemoBanner(
      page,
      'Branch Boundary',
      'Verifying Branch Manager operational boundary and lack of platform console access',
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
