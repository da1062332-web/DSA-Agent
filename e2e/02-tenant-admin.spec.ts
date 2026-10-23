import { test, expect } from '@playwright/test';
import { PERSONAS } from './helpers/mock-session';
import { AuthPage, TenantAdminPage } from './pages';

test.describe('Persona 02: Tenant Admin (ROLE-TENANT-ADMIN)', () => {
  // =========================================================================
  // TC-TA-01: Staff User Directory & User Profile Management (MOD-USR)
  // =========================================================================
  test('TC-TA-01: Staff User Directory & User Profile Management', async ({ page }) => {
    const authPage = new AuthPage(page);
    const tenantAdminPage = new TenantAdminPage(page);

    await page.route('**/v1/users**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'usr_admin_01',
              email: 'admin@qloax.com',
              displayName: 'Asha Admin',
              status: 'ACTIVE',
              primaryBranch: { id: 'MUM01', name: 'Mumbai Central' },
              roles: ['ROLE-TENANT-ADMIN'],
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'usr_rm_01',
              email: 'rm@qloax.com',
              displayName: 'Riya RM',
              status: 'ACTIVE',
              primaryBranch: { id: 'MUM01', name: 'Mumbai Central' },
              roles: ['ROLE-RM'],
              createdAt: '2026-01-02T00:00:00.000Z',
            },
            {
              id: 'usr_sales_01',
              email: 'sales@qloax.com',
              displayName: 'Sameer Sales',
              status: 'ACTIVE',
              primaryBranch: { id: 'MUM01', name: 'Mumbai Central' },
              roles: ['ROLE-SALES-EXEC'],
              createdAt: '2026-01-03T00:00:00.000Z',
            },
            {
              id: 'usr_branchmgr_01',
              email: 'branchmgr@qloax.com',
              displayName: 'Bhavna Branch Mgr',
              status: 'ACTIVE',
              primaryBranch: { id: 'MUM01', name: 'Mumbai Central' },
              roles: ['ROLE-BRANCH-MGR'],
              createdAt: '2026-01-04T00:00:00.000Z',
            },
          ],
          meta: { limit: 50, nextCursor: null },
        }),
      });
    });

    await page.route('**/v1/roles**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: 'rol_admin', code: 'ROLE-TENANT-ADMIN', name: 'Tenant Administrator' },
            { id: 'rol_rm', code: 'ROLE-RM', name: 'Relationship Manager' },
            { id: 'rol_sales', code: 'ROLE-SALES-EXEC', name: 'Sales Executive' },
          ],
        }),
      });
    });

    // 1. Role Login via Page Object
    await authPage.loginAs(PERSONAS.tenantAdmin, '/users');

    // 2. Verify Staff Users list
    await tenantAdminPage.showBanner('Staff Management', 'Viewing tenant staff directory and role assignments (MOD-USR)');
    await expect(page.getByRole('cell', { name: /Asha Admin/i })).toBeVisible();
    await expect(page.getByRole('cell', { name: /Riya RM/i })).toBeVisible();
    await expect(page.getByRole('cell', { name: /Sameer Sales/i })).toBeVisible();
    await expect(page.getByRole('cell', { name: /Bhavna Branch/i })).toBeVisible();
    await tenantAdminPage.pause(1500);

    // 3. Search filter
    if (await tenantAdminPage.searchInput.isVisible()) {
      await tenantAdminPage.showBanner('User Search', 'Filtering staff users by name or email');
      await tenantAdminPage.searchUser('Riya');
      await tenantAdminPage.pause(1000);
    }

    // 4. Role Logout via Page Object
    await authPage.logout();
  });

  // =========================================================================
  // TC-TA-02: Role Catalogue & Permission Matrix Governance (MOD-ACL)
  // =========================================================================
  test('TC-TA-02: Role Catalogue & Permission Matrix Governance', async ({ page }) => {
    const authPage = new AuthPage(page);
    const tenantAdminPage = new TenantAdminPage(page);

    await page.route('**/v1/roles**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'rol_admin',
              code: 'ROLE-TENANT-ADMIN',
              name: 'Tenant Administrator',
              description: 'Full tenant-level authority',
              isTemplate: true,
              version: 1,
              permissions: ['user.manage', 'role.manage', 'config.manage'],
            },
            {
              id: 'rol_rm',
              code: 'ROLE-RM',
              name: 'Relationship Manager',
              description: 'Lead qualification and borrower intake',
              isTemplate: true,
              version: 1,
              permissions: ['lead.read', 'lead.qualify'],
            },
            {
              id: 'rol_loanops',
              code: 'ROLE-LOAN-OPS',
              name: 'Loan Operations',
              description: 'Underwriting and lender case submission',
              isTemplate: true,
              version: 1,
              permissions: ['application.read', 'sanction.record'],
            },
            {
              id: 'rol_verifier',
              code: 'ROLE-DOC-VERIFIER',
              name: 'Document Verifier',
              description: 'Field KYC & document verification',
              isTemplate: true,
              version: 1,
              permissions: ['verification.read', 'document.review'],
            },
          ],
        }),
      });
    });

    await page.route('**/v1/permissions**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { code: 'user.manage', domain: 'Administration', description: 'Manage staff users' },
            { code: 'role.manage', domain: 'Administration', description: 'Configure roles and permissions' },
            { code: 'lead.create', domain: 'Leads', description: 'Create leads' },
            { code: 'lead.qualify', domain: 'Leads', description: 'Qualify leads' },
          ],
        }),
      });
    });

    // 1. Role Login via Page Object
    await authPage.loginAs(PERSONAS.tenantAdmin, '/roles');

    // 2. Verify Access Control Roles List
    await tenantAdminPage.showBanner('Access Control', 'Inspecting role-based access matrix (MOD-ACL / MOD-5)');
    await expect(page.getByText('ROLE-TENANT-ADMIN')).toBeVisible();
    await expect(page.getByText('ROLE-RM')).toBeVisible();
    await expect(page.getByText('ROLE-LOAN-OPS')).toBeVisible();
    await expect(page.getByText('ROLE-DOC-VERIFIER')).toBeVisible();
    await tenantAdminPage.pause(1500);

    // 3. Role Logout via Page Object
    await authPage.logout();
  });

  // =========================================================================
  // TC-TA-03: Segregation of Duties & Access Control Enforcement
  // =========================================================================
  test('TC-TA-03: Segregation of Duties & Access Control Enforcement', async ({ page }) => {
    const authPage = new AuthPage(page);
    const tenantAdminPage = new TenantAdminPage(page);

    // 1. Role Login via Page Object
    await authPage.loginAs(PERSONAS.tenantAdmin, '/');

    // 2. Verify tenant administration authority is present
    await tenantAdminPage.showBanner('Tenant Scope', 'Verifying Tenant Admin authority within tenant domain');
    await expect(tenantAdminPage.userManagementHeading).toBeVisible();
    await expect(tenantAdminPage.accessControlHeading).toBeVisible();
    await tenantAdminPage.pause(1200);

    // 3. Attempt access to platform-wide operator console
    await tenantAdminPage.showBanner('Security Boundary', 'Verifying Tenant Admin cannot access multi-tenant platform console');
    // The Platform Console belongs to the platform realm only (Notion Roles §1, §6.1)
    await tenantAdminPage.expectForbidden('/platform-admin');
    await tenantAdminPage.pause(1500);

    // payout.approve is ROLE-COMMISSION-APPROVER only (Notion Roles §7, SOD-03): the admin may request a payout but the
    // approval queue offers no approve action
    await tenantAdminPage.showBanner('Dual-Control Boundary', 'Tenant Admin cannot approve connector payouts (SOD-03)');
    await page.route('**/v1/payout-requests**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'pay_req_qa_admin_001',
              connectorId: 'con_qa_001',
              origin: 'MANUAL',
              total: '5000',
              status: 'SUBMITTED',
              submittedBy: 'usr_finance_01',
              submittedAt: new Date().toISOString(),
              paymentRefMasked: null,
              lines: [{ id: 'pline_qa_admin_001', payableId: 'pyb_qa_001', amount: '5000', currency: 'INR' }],
            },
          ],
          meta: { nextCursor: null, limit: 50 },
        }),
      });
    });
    await tenantAdminPage.goto('/payouts');
    await page.getByRole('tab', { name: /Approval Queue/i }).click();
    await expect(page.getByRole('button', { name: /Review & Decide \(SOD-03\)/i })).toBeDisabled();
    await tenantAdminPage.pause(1500);

    // 4. Role Logout via Page Object
    await authPage.logout();
  });
});
