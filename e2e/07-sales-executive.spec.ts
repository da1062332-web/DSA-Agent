import { test, expect } from '@playwright/test';
import { PERSONAS, setupPersonaSession, pauseForDemo } from './helpers/mock-session';

test.describe('Persona 07: Sales Executive (ROLE-SALES-EXEC)', () => {
  test.beforeEach(async ({ page }) => {
    await setupPersonaSession(page, PERSONAS.salesExec);
  });

  test('TC-SE-01: Sales Executive pipeline visibility and activity tracking', async ({ page }) => {
    // Mock leads list
    await page.route('**/v1/leads**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'led_se_001',
              fullName: 'Aarav Patel',
              mobileMasked: '******9876',
              productCategory: 'HL',
              state: 'NEW',
              branchId: 'MUM01',
              indicativeAmount: { amount: '4500000.00', currency: 'INR' },
              priority: 'HIGH',
              createdAt: new Date().toISOString(),
            },
          ],
          meta: { total: 1 },
        }),
      });
    });

    // 1. Visit Leads list
    await page.goto('/leads');
    await expect(page.getByText('Aarav Patel')).toBeVisible();
    await pauseForDemo(page, 3000);

    // 2. Visit Tasks
    await page.route('**/v1/tasks**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'tsk_001',
              title: 'Call customer for income proof',
              status: 'OPEN',
              priority: 'HIGH',
              dueDate: new Date().toISOString(),
            },
          ],
        }),
      });
    });
    await page.goto('/tasks');
    await expect(page.locator('body')).toContainText(/tasks/i);
    await pauseForDemo(page, 3000);

    // 3. Verify Access Control: Sales Executive cannot access Commission or Audit
    await page.goto('/commission');
    // Expect Forbidden page
    await expect(page.locator('[data-testid="shell.forbidden"]')).toBeVisible();
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await pauseForDemo(page, 3000);

    await page.goto('/audit');
    await expect(page.locator('[data-testid="shell.forbidden"]')).toBeVisible();
    await pauseForDemo(page, 3000);
  });
});
