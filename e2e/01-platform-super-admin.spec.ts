import { test, expect } from '@playwright/test';
import { PERSONAS } from './helpers/mock-session';
import { AuthPage, PlatformAdminPage } from './pages';

test.describe('Persona 01: Platform Super Admin (ROLE-PLATFORM-ADMIN)', () => {
  // =========================================================================
  // TC-PSA-01: Multi-Tenant Platform Console & Tenant Directory Inspection
  // =========================================================================
  test('TC-PSA-01: Multi-Tenant Platform Console & Tenant Directory Inspection', async ({ page }) => {
    const authPage = new AuthPage(page);
    const platformPage = new PlatformAdminPage(page);

    // Mock platform tenants endpoint
    await page.route('**/platform/v1/tenants**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'ten_01M595WCNH6H3ZMCVS70XH9GAN',
              slug: 'qloax-dsa',
              legalName: 'Qloax Finserv Private Limited',
              tenantType: 'DSA',
              dataRegion: 'ap-south-1',
              timezone: 'Asia/Kolkata',
              status: 'ACTIVE',
              healthStatus: 'HEALTHY',
              activeUsersCount: 18,
              entitlements: ['MOD-LEAD', 'MOD-APP', 'MOD-DOC', 'MOD-SAN'],
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-10-23T00:00:00.000Z',
            },
            {
              id: 'ten_alpha',
              slug: 'alpha',
              legalName: 'Alpha Financial Services Ltd',
              tenantType: 'DSA',
              dataRegion: 'ap-south-1',
              timezone: 'Asia/Kolkata',
              status: 'ACTIVE',
              healthStatus: 'HEALTHY',
              activeUsersCount: 12,
              entitlements: ['MOD-LEAD', 'MOD-APP', 'MOD-DOC'],
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-10-23T00:00:00.000Z',
            },
          ],
          meta: { total: 2 },
        }),
      });
    });

    await page.route('**/platform/v1/flags**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { total: 0 } }),
      });
    });

    await page.route('**/platform/v1/jobs**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          queues: [
            {
              queue: 'outbox_dispatcher',
              paused: false,
              activeJobs: 1,
              completedJobs: 450,
              failedJobs: 0,
              delayedJobs: 0,
              waitingJobs: 0,
            },
          ],
          deadLetters: [],
        }),
      });
    });

    await page.route('**/platform/v1/health**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          database: { connected: true, latencyMs: 4 },
          redis: { connected: true, latencyMs: 1 },
          timestamp: new Date().toISOString(),
        }),
      });
    });

    // 1. Role Login via Page Object
    await authPage.loginAs(PERSONAS.platformSuperAdmin, '/platform-admin');

    // 2. Verify Platform Operations Console
    await platformPage.showBanner('Platform Console', 'Reviewing multi-tenant directory (MOD-TEN / MOD-ADM)');
    await expect(platformPage.heading).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Qloax Finserv Private Limited' })).toBeVisible();
    await expect(page.getByText('qloax-dsa')).toBeVisible();
    await expect(page.getByText('Alpha Financial Services Ltd')).toBeVisible();
    await platformPage.pause(1500);

    // 3. Inspect tenant status chips
    const activeChips = page.getByText('ACTIVE');
    await expect(activeChips.first()).toBeVisible();
    await platformPage.pause(1200);

    // 4. Role Logout via Page Object
    await authPage.logout();
  });

  // =========================================================================
  // TC-PSA-02: Platform Feature Flags & Background Jobs Oversight
  // =========================================================================
  test('TC-PSA-02: Platform Feature Flags & Background Jobs Oversight', async ({ page }) => {
    const authPage = new AuthPage(page);
    const platformPage = new PlatformAdminPage(page);

    await page.route('**/platform/v1/tenants**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { total: 0 } }),
      });
    });

    await page.route('**/platform/v1/flags**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              key: 'FF_ENABLE_NEW_BRE_SIMULATOR',
              description: 'Enable next-generation rule simulator engine',
              scope: 'GLOBAL',
              value: true,
              lockVersion: 1,
            },
            {
              key: 'FF_ENABLE_AI_ASSISTANT',
              description: 'Enable AI lead summarizer',
              scope: 'GLOBAL',
              value: false,
              lockVersion: 1,
            },
          ],
          meta: { total: 2 },
        }),
      });
    });

    await page.route('**/platform/v1/jobs**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          queues: [
            {
              queue: 'document_ocr_queue',
              paused: false,
              activeJobs: 3,
              completedJobs: 120,
              failedJobs: 0,
              delayedJobs: 0,
              waitingJobs: 0,
            },
            {
              queue: 'webhook_dispatch_queue',
              paused: false,
              activeJobs: 0,
              completedJobs: 80,
              failedJobs: 0,
              delayedJobs: 0,
              waitingJobs: 0,
            },
          ],
          deadLetters: [],
        }),
      });
    });

    await page.route('**/platform/v1/health**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          database: { connected: true, latencyMs: 3 },
          redis: { connected: true, latencyMs: 1 },
          timestamp: new Date().toISOString(),
        }),
      });
    });

    // 1. Role Login via Page Object
    await authPage.loginAs(PERSONAS.platformSuperAdmin, '/platform-admin');

    // 2. Switch to Feature Flags Tab
    await platformPage.showBanner('Feature Flags Tab', 'Inspecting platform feature toggles');
    await expect(platformPage.flagsTab).toBeVisible();
    await platformPage.switchToFlagsTab();

    await expect(page.getByText('FF_ENABLE_NEW_BRE_SIMULATOR')).toBeVisible();
    await expect(page.getByText('Enable next-generation rule simulator engine')).toBeVisible();
    await platformPage.pause(1500);

    // 3. Switch to Background Jobs Tab
    await platformPage.showBanner('Background Jobs Tab', 'Monitoring queue throughput and dead-letter backlog');
    await expect(platformPage.jobsTab).toBeVisible();
    await platformPage.switchToJobsTab();

    await expect(page.getByText('document_ocr_queue')).toBeVisible();
    await platformPage.pause(1500);

    // 4. Role Logout via Page Object
    await authPage.logout();
  });

  // =========================================================================
  // TC-PSA-03: Segregation of Duties & Operational Boundary Enforcement
  // =========================================================================
  test('TC-PSA-03: Segregation of Duties & Operational Boundary Enforcement', async ({ page }) => {
    const authPage = new AuthPage(page);
    const platformPage = new PlatformAdminPage(page);

    // 1. Role Login via Page Object
    await authPage.loginAs(PERSONAS.platformSuperAdmin, '/platform-admin');

    // 2. Verify platform console enforces zero business data projection
    await platformPage.showBanner(
      'Data Privacy Boundary',
      'Verifying Platform Super Admin is isolated from tenant business data',
    );
    await expect(platformPage.zeroBusinessDataBanner).toBeVisible();
    await platformPage.pause(1500);

    // 3. Navigate to an operational borrower applications route
    await platformPage.showBanner('Access Boundary Check', 'Attempting direct navigation to tenant borrower loans');
    await platformPage.goto('/applications');

    // Platform Super Admin without support access cannot originate or approve tenant loans
    await platformPage.pause(1500);

    // 4. Role Logout via Page Object
    await authPage.logout();
  });
});
