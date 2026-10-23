import { test, expect } from '@playwright/test';
import { PERSONAS } from './helpers/mock-session';
import { AuthPage, OrgOwnerPage } from './pages';

test.describe('Persona 03: Organisation Owner (ROLE-ORG-OWNER)', () => {
  // =========================================================================
  // TC-OWN-01: Executive Portfolio Overview & Platform Financial Visibility
  // =========================================================================
  test('TC-OWN-01: Executive Portfolio Overview & Platform Financial Visibility', async ({ page }) => {
    const authPage = new AuthPage(page);
    const orgOwnerPage = new OrgOwnerPage(page);

    // 1. Role Login via Page Object
    await authPage.loginAs(PERSONAS.orgOwner, '/');

    // 2. Verify Executive Overview
    await orgOwnerPage.showBanner(
      'Executive Overview',
      'Reviewing high-level DSA portfolio and financial operations',
    );
    await expect(orgOwnerPage.leadsCrmHeading).toBeVisible();
    await expect(orgOwnerPage.loanAppsHeading).toBeVisible();
    await orgOwnerPage.pause(1500);

    // 3. Role Logout via Page Object
    await authPage.logout();
  });

  // =========================================================================
  // TC-OWN-02: Channel Partner & Connector Management (MOD-CON)
  // =========================================================================
  test('TC-OWN-02: Channel Partner & Connector Management', async ({ page }) => {
    const authPage = new AuthPage(page);
    const orgOwnerPage = new OrgOwnerPage(page);

    await page.route('**/v1/connectors**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 'con_apex_001',
              code: 'APEX-FIN',
              legalName: 'Apex Advisory Partners',
              contactPerson: 'Apex Partner',
              connectorType: 'INDIVIDUAL',
              status: 'ACTIVE',
              mobileE164: '+91 98765 43210',
              email: 'partner@apexfin.com',
              panMasked: 'ABCDE••••F',
              gstin: null,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'con_bluestar_002',
              code: 'BLUE-STAR',
              legalName: 'BlueStar Wealth Management',
              contactPerson: 'BlueStar Contact',
              connectorType: 'INSTITUTIONAL',
              status: 'ACTIVE',
              mobileE164: '+91 98111 22334',
              email: 'contact@bluestar.com',
              panMasked: 'XYZPQ••••R',
              gstin: '27XYZPQ1234R1Z5',
              createdAt: '2026-01-02T00:00:00.000Z',
            },
          ],
        }),
      });
    });

    await page.route('**/v1/attribution-change-requests**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] }),
      });
    });

    await page.route('**/v1/attribution-disputes**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] }),
      });
    });

    // 1. Role Login via Page Object
    await authPage.loginAs(PERSONAS.orgOwner, '/connectors');

    // 2. Verify Connectors Directory
    await orgOwnerPage.showBanner('Connector Directory', 'Inspecting channel partners, commission tiers and bank accounts');
    await expect(page.getByText('Apex Advisory Partners')).toBeVisible();
    await expect(page.getByText('BlueStar Wealth Management')).toBeVisible();
    await expect(page.getByText('INDIVIDUAL')).toBeVisible();
    await expect(page.getByText('INSTITUTIONAL')).toBeVisible();
    await orgOwnerPage.pause(1500);

    // 3. Role Logout via Page Object
    await authPage.logout();
  });

  // =========================================================================
  // TC-OWN-03: Segregation of Duties Enforcement (SOD-03 / Dual-Control)
  // =========================================================================
  test('TC-OWN-03: Segregation of Duties Enforcement (SOD-03 / Dual-Control)', async ({ page }) => {
    const authPage = new AuthPage(page);
    const orgOwnerPage = new OrgOwnerPage(page);

    // 1. Role Login via Page Object
    await authPage.loginAs(PERSONAS.orgOwner, '/');

    // 2. Verify Org Owner operational visibility
    await orgOwnerPage.showBanner('Dual-Control Enforcement', 'Verifying maker-checker segregation on financial authorizations');
    await expect(authPage.accountBtn).toBeVisible();
    await orgOwnerPage.pause(1200);

    // 3. Role Logout via Page Object
    await authPage.logout();
  });
});
