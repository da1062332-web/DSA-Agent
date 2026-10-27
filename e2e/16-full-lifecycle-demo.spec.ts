import { test, expect } from '@playwright/test';
import { VAIBHAV_PERSONAS, apiErrorBody, isHeaded } from './helpers/mock-session';
import {
  AuthPage,
  PlatformAdminPage,
  TenantAdminPage,
  LeadPage,
  ManagerDashboardPage,
  DocumentSharingPage,
  CustomerPortalPage,
  VerificationPage,
  SanctionPage,
  PayoutPage,
  AuditPage,
} from './pages';

/**
 * Spec 16: Master End-to-End Demonstration Suite
 * 
 * Demonstrates the complete real-world operational lifecycle for Vaibhav Finserv Private Limited:
 * from Platform Super Admin multi-tenant organisation setup, to staff governance, sales intake,
 * branch queue allocation, RM qualification & atomic conversion, loan operations document sharing,
 * customer 2FA secure upload portal, verification workbench, lender sanction & dual-control disbursement,
 * commission payout approval, and cryptographic audit chain verification.
 */
test.describe('Master E2E Demonstration Suite: Vaibhav Finserv Lifecycle', () => {

  const TENANT_ID = 'ten_01M5V9DW51908MVT3D6P4M7NDA';
  const TENANT_SLUG = 'vaibhav-finserv';
  const LEAD_ID = 'led_demo_kavya_001';
  const APP_ID = 'app_demo_kavya_001';
  const CUST_ID = 'cus_demo_kavya_001';
  const SHARE_TOKEN = 'tok_secure_kavya_demo_01';
  const CASE_ID = 'lcs_case_kavya_001';
  const SANCTION_ID = 'snc_kavya_001';
  const TRANCHE_ID = 'trn_kavya_001';

  // =========================================================================
  // TC-DEMO-FULL-01: Multi-Tenant Organisation Setup to Customer Document Upload
  // =========================================================================
  test('TC-DEMO-FULL-01: Multi-Tenant Organisation Setup to Customer Secure Document Upload', async ({
    page,
    browser,
  }) => {
    test.setTimeout(isHeaded ? 600_000 : 300_000);

    const authPage = new AuthPage(page);
    const platformPage = new PlatformAdminPage(page);
    const tenantAdminPage = new TenantAdminPage(page);
    const leadPage = new LeadPage(page);
    const dashboardPage = new ManagerDashboardPage(page);
    const sharingPage = new DocumentSharingPage(page);

    // Shared mock state for Kavya Deshmukh's lead
    const mockLead = {
      id: LEAD_ID,
      fullName: 'Kavya Deshmukh',
      mobileMasked: '+91 ••••• ••234',
      emailMasked: 'kavya.deshmukh@example.com',
      pincode: '400008',
      productCategory: 'PERSONAL_LOAN',
      indicativeAmount: { amount: '300000.00', currency: 'INR' },
      priority: 'HIGH',
      state: 'NEW',
      branchId: 'MUM01',
      source: 'WALK_IN',
      duplicateFlag: 'NONE',
      contactAttempts: 0,
      assignedUserId: null as string | null,
      lockVersion: 1,
      createdAt: new Date().toISOString(),
    };

    // -----------------------------------------------------------------------
    // Mock Platform Admin APIs
    // -----------------------------------------------------------------------
    const mockPlatformTenant = {
      id: TENANT_ID,
      slug: TENANT_SLUG,
      legalName: 'Vaibhav Finserv Private Limited',
      tenantType: 'DSA',
      dataRegion: 'ap-south-1',
      timezone: 'Asia/Kolkata',
      status: 'ACTIVE',
      healthStatus: 'HEALTHY',
      activeUsersCount: 14,
      entitlements: ['MOD-LEAD', 'MOD-APP', 'MOD-DOC', 'MOD-SAN', 'MOD-DISB', 'MOD-PAY'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-10-26T00:00:00.000Z',
    };

    await page.route('**/platform/v1/tenants', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [mockPlatformTenant],
          meta: { total: 1 },
        }),
      });
    });

    await page.route(`**/platform/v1/tenants/${TENANT_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockPlatformTenant),
      });
    });

    await page.route(`**/platform/v1/tenants/${TENANT_ID}/flags`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              key: 'FF_ENABLE_NEW_BRE_SIMULATOR',
              description: 'Next-generation rule simulator engine',
              scope: 'TENANT',
              value: true,
              lockVersion: 1,
            },
            {
              key: 'FF_ENABLE_AI_ASSISTANT',
              description: 'AI lead copilot',
              scope: 'TENANT',
              value: true,
              lockVersion: 1,
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
        body: JSON.stringify({
          data: [
            {
              key: 'FF_ENABLE_NEW_BRE_SIMULATOR',
              description: 'Next-generation rule simulator engine',
              scope: 'GLOBAL',
              value: true,
              lockVersion: 1,
            },
          ],
          meta: { total: 1 },
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
              activeJobs: 1,
              completedJobs: 1240,
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

    // -----------------------------------------------------------------------
    // Mock Tenant Staff & Roles APIs
    // -----------------------------------------------------------------------
    await page.route('**/v1/users**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'usr_vaibhav_admin_01',
              email: 'vaibhav+admin@qloax.com',
              displayName: 'Vaibhav Admin',
              status: 'ACTIVE',
              primaryBranch: { id: 'MUM01', name: 'Mumbai Central' },
              roles: ['ROLE-TENANT-ADMIN'],
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'usr_vaibhav_owner_01',
              email: 'vaibhav+owner@qloax.com',
              displayName: 'Vaibhav Owner',
              status: 'ACTIVE',
              primaryBranch: { id: 'MUM01', name: 'Mumbai Central' },
              roles: ['ROLE-ORG-OWNER'],
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'usr_vaibhav_branchmgr_01',
              email: 'vaibhav+branchmgr@qloax.com',
              displayName: 'Vaibhav Branch Mgr',
              status: 'ACTIVE',
              primaryBranch: { id: 'MUM01', name: 'Mumbai Central' },
              roles: ['ROLE-BRANCH-MGR'],
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'usr_vaibhav_rm1_01',
              email: 'vaibhav+rm1@qloax.com',
              displayName: 'Vaibhav RM 1',
              status: 'ACTIVE',
              primaryBranch: { id: 'MUM01', name: 'Mumbai Central' },
              roles: ['ROLE-RM'],
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'usr_vaibhav_sales_01',
              email: 'vaibhav+sales@qloax.com',
              displayName: 'Vaibhav Sales',
              status: 'ACTIVE',
              primaryBranch: { id: 'MUM01', name: 'Mumbai Central' },
              roles: ['ROLE-SALES-EXEC'],
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'usr_vaibhav_loanops_01',
              email: 'vaibhav+loanops@qloax.com',
              displayName: 'Vaibhav Loan Ops',
              status: 'ACTIVE',
              primaryBranch: { id: 'MUM01', name: 'Mumbai Central' },
              roles: ['ROLE-LOAN-OPS'],
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'usr_vaibhav_verifier_01',
              email: 'vaibhav+verifier@qloax.com',
              displayName: 'Vaibhav Verifier',
              status: 'ACTIVE',
              primaryBranch: { id: 'MUM01', name: 'Mumbai Central' },
              roles: ['ROLE-DOC-VERIFIER'],
              createdAt: '2026-01-01T00:00:00.000Z',
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
            { id: 'rol_admin', code: 'ROLE-TENANT-ADMIN', name: 'Tenant Administrator', isTemplate: true, permissions: ['user.manage'] },
            { id: 'rol_owner', code: 'ROLE-ORG-OWNER', name: 'Organisation Owner', isTemplate: true, permissions: ['lead.read'] },
            { id: 'rol_branchmgr', code: 'ROLE-BRANCH-MGR', name: 'Branch Manager', isTemplate: true, permissions: ['lead.read'] },
            { id: 'rol_rm', code: 'ROLE-RM', name: 'Relationship Manager', isTemplate: true, permissions: ['lead.read'] },
            { id: 'rol_sales', code: 'ROLE-SALES-EXEC', name: 'Sales Executive', isTemplate: true, permissions: ['lead.create'] },
            { id: 'rol_loanops', code: 'ROLE-LOAN-OPS', name: 'Loan Operations', isTemplate: true, permissions: ['application.read'] },
            { id: 'rol_verifier', code: 'ROLE-DOC-VERIFIER', name: 'Document Verifier', isTemplate: true, permissions: ['verification.read'] },
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

    // -----------------------------------------------------------------------
    // Mock Leads, Activities, Tasks APIs
    // -----------------------------------------------------------------------
    await page.route('**/v1/leads**', async (route) => {
      const url = route.request().url();
      if (url.includes(`/${LEAD_ID}/conversion`)) {
        mockLead.state = 'CONVERTED';
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            applicationId: APP_ID,
            customerId: CUST_ID,
            leadId: LEAD_ID,
          }),
        });
      } else if (url.includes(`/${LEAD_ID}/transitions`)) {
        const body = JSON.parse(route.request().postData() || '{}');
        if (body.transitionCode === 'T-LEAD-01') {
          mockLead.state = 'CONTACT_ATTEMPTED';
          mockLead.contactAttempts = 1;
          mockLead.lockVersion = 2;
        } else if (body.transitionCode === 'T-LEAD-02') {
          mockLead.state = 'IN_PROGRESS';
          mockLead.lockVersion = 3;
        } else if (body.transitionCode === 'T-LEAD-04') {
          mockLead.state = 'QUALIFIED';
          mockLead.lockVersion = 4;
        }
        await route.fulfill({
          status: 200,
          headers: { ETag: `W/"v${mockLead.lockVersion}"` },
          contentType: 'application/json',
          body: JSON.stringify(mockLead),
        });
      } else if (url.includes(`/${LEAD_ID}`)) {
        await route.fulfill({
          status: 200,
          headers: { ETag: `W/"v${mockLead.lockVersion}"` },
          contentType: 'application/json',
          body: JSON.stringify(mockLead),
        });
      } else if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        mockLead.fullName = body.fullName || mockLead.fullName;
        mockLead.indicativeAmount = { amount: `${body.indicativeAmount || 300000}.00`, currency: 'INR' };
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(mockLead),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [mockLead], meta: { total: 1 } }),
        });
      }
    });

    await page.route('**/v1/activities**', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'act_demo_001',
          kind: 'CALL',
          subjectType: 'LEAD',
          subjectId: LEAD_ID,
          outcomeCode: 'CONNECTED',
          note: 'Borrower confirmed interest in ₹3,00,000 Personal Loan for renovation.',
          createdAt: new Date().toISOString(),
        }),
      });
    });

    await page.route('**/v1/tasks**', async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'tsk_demo_001',
            title: body.title || 'Collect KYC documents',
            status: 'OPEN',
            linkedType: 'LEAD',
            linkedId: LEAD_ID,
            ownerUserId: 'usr_vaibhav_sales_01',
            createdAt: new Date().toISOString(),
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              {
                id: 'tsk_demo_001',
                title: 'Collect PAN card & 6 months bank statements',
                status: 'OPEN',
                priority: 'HIGH',
                linkedType: 'LEAD',
                linkedId: LEAD_ID,
                ownerUserId: 'usr_vaibhav_sales_01',
                createdAt: new Date().toISOString(),
              },
            ],
            meta: { total: 1 },
          }),
        });
      }
    });

    // -----------------------------------------------------------------------
    // Mock Application & Document Sharing APIs
    // -----------------------------------------------------------------------
    await page.route(/\/v1\/applications(\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: APP_ID,
              customerId: CUST_ID,
              branchId: 'MUM01',
              productCategory: 'PERSONAL_LOAN',
              requestedAmount: '300000.00',
              currency: 'INR',
              tenureMonths: 36,
              applicantType: 'SALARIED',
              status: 'DOCUMENTS_PENDING',
              salesOwnerId: 'usr_vaibhav_rm1_01',
              version: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          meta: { nextCursor: null, limit: 50 },
        }),
      });
    });

    await page.route(`**/v1/applications/${APP_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: APP_ID,
          customerId: CUST_ID,
          branchId: 'MUM01',
          productCategory: 'PERSONAL_LOAN',
          requestedAmount: '300000.00',
          currency: 'INR',
          tenureMonths: 36,
          applicantType: 'SALARIED',
          status: 'DOCUMENTS_PENDING',
          salesOwnerId: 'usr_vaibhav_rm1_01',
          version: 1,
          createdAt: new Date().toISOString(),
        }),
      });
    });

    await page.route(`**/v1/applications/${APP_ID}/checklist**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'chk_pan_01',
              applicationId: APP_ID,
              partyId: CUST_ID,
              documentTypeCode: 'PAN_CARD',
              ordinal: 1,
              mandatory: true,
              requiredCount: 1,
              status: 'PENDING',
              rejectReason: null,
              attestationNote: null,
              reviewedBy: null,
              documentId: null,
              version: 1,
            },
          ],
          summary: {
            total: 1,
            mandatory: 1,
            outstandingMandatory: 1,
            accepted: 0,
            rejected: 0,
            expired: 0,
            complete: false,
          },
        }),
      });
    });

    await page.route('**/v1/shares**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    });

    let generatedUploadLink: any = null;
    await page.route('**/v1/upload-links**', async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        generatedUploadLink = {
          id: 'upl_kavya_001',
          tenantId: TENANT_ID,
          applicationId: APP_ID,
          items: body.checklistItemIds || ['chk_pan_01'],
          recipientContactId: CUST_ID,
          expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
          otpRequired: true,
          maxUses: 5,
          uses: 0,
          uploadUrl: `/upload/${SHARE_TOKEN}`,
          createdAt: new Date().toISOString(),
        };
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(generatedUploadLink),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: generatedUploadLink ? [generatedUploadLink] : [],
            meta: { nextCursor: null, limit: 50 },
          }),
        });
      }
    });

    // =======================================================================
    // STAGE 1: PLATFORM SUPER ADMIN (vaibhav.qloax@gmail.com)
    // =======================================================================
    await authPage.loginAs(VAIBHAV_PERSONAS.platformSuperAdmin, '/platform-admin', 'Vaibhav@1234');
    await platformPage.goto('/platform-admin');
    await platformPage.showBanner(
      'Stage 1: Platform Super Admin',
      'Verifying multi-tenant directory & Vaibhav Finserv organisation (MOD-TEN / MOD-ADM)',
    );
    await expect(platformPage.heading).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Vaibhav Finserv Private Limited' })).toBeVisible();
    await expect(page.getByText(TENANT_SLUG)).toBeVisible();
    await expect(page.getByText('ACTIVE').first()).toBeVisible();
    await platformPage.pause(1200);

    // Open Tenant Detail for Vaibhav Finserv
    await platformPage.showBanner(
      'Tenant Overview & Entitlements',
      'Inspecting modular licenses: MOD-LEAD, MOD-APP, MOD-DOC, MOD-SAN',
    );
    await platformPage.click(page.getByRole('link', { name: TENANT_SLUG }).first(), 1000);
    await expect(page.getByRole('heading', { name: /Vaibhav Finserv Private Limited/i }).first()).toBeVisible();
    await expect(page.getByText('ap-south-1').first()).toBeVisible();
    await platformPage.pause(1000);

    // Switch to Tenant Feature Flags tab
    await platformPage.showBanner('Feature Flags Tab', 'Verifying active BRE simulator & AI assistant');
    await platformPage.click(page.getByRole('tab', { name: /Feature Flags/i }), 1000);
    await expect(page.getByText('FF_ENABLE_NEW_BRE_SIMULATOR').first()).toBeVisible();
    await platformPage.pause(1200);

    await authPage.logout();

    // =======================================================================
    // STAGE 2: TENANT ADMINISTRATOR (vaibhav+admin@qloax.com)
    // =======================================================================
    await authPage.loginAs(VAIBHAV_PERSONAS.tenantAdmin, '/users', 'Vaibhav@1234');
    await tenantAdminPage.goto('/users');
    await tenantAdminPage.showBanner(
      'Stage 2: Tenant Administrator',
      'Governing staff user directory & branch role assignments (MOD-USR)',
    );
    await expect(page.getByRole('cell', { name: /Vaibhav Admin/i })).toBeVisible();
    await expect(page.getByRole('cell', { name: /Vaibhav Owner/i })).toBeVisible();
    await expect(page.getByRole('cell', { name: /Vaibhav Branch Mgr/i })).toBeVisible();
    await expect(page.getByRole('cell', { name: /Vaibhav RM 1/i })).toBeVisible();
    await expect(page.getByRole('cell', { name: /Vaibhav Sales/i })).toBeVisible();
    await tenantAdminPage.pause(1200);

    // Inspect Roles Catalogue
    await tenantAdminPage.showBanner(
      'Role & Permission Catalogue',
      'Verifying Segregation of Duties (SoD) access control matrix (MOD-ACL)',
    );
    await tenantAdminPage.gotoRoles();
    await expect(page.getByText('ROLE-TENANT-ADMIN')).toBeVisible();
    await expect(page.getByText('ROLE-RM')).toBeVisible();
    await tenantAdminPage.pause(1200);

    await authPage.logout();

    // =======================================================================
    // STAGE 3: SALES EXECUTIVE (vaibhav+sales@qloax.com)
    // =======================================================================
    await authPage.loginAs(VAIBHAV_PERSONAS.salesExec, '/leads/new', 'Vaibhav@1234');
    await leadPage.goto('/leads/new');
    await leadPage.showBanner(
      'Stage 3: Sales Executive',
      'Field outreach lead intake for borrower Kavya Deshmukh (SUB-LEAD.01)',
    );
    await expect(leadPage.heading).toContainText('Create New Lead');

    // Test form validations: empty submit & invalid mobile
    await leadPage.showBanner('Client-Side Validation Checks', 'Testing required field and format validations');
    await leadPage.click(leadPage.submitLeadBtn, 800);
    await expect(page.getByText('Enter the full name (at least 2 characters).')).toBeVisible();
    await leadPage.type(leadPage.mobileInput, '55555');
    await leadPage.click(leadPage.submitLeadBtn, 800);
    await expect(page.getByText('Enter a 10-digit mobile number starting with 6, 7, 8 or 9.')).toBeVisible();
    await leadPage.pause(1000);

    // Fill valid applicant details for Kavya Deshmukh
    await leadPage.showBanner('Entering Synthetic Lead Data', 'Kavya Deshmukh, ₹3,00,000 Personal Loan, Mumbai Central');
    await leadPage.fillLeadForm({
      fullName: 'Kavya Deshmukh',
      mobile: '9876501234',
      email: 'kavya.deshmukh@example.com',
      pincode: '400008',
      amount: '300000',
    });
    await leadPage.pause(1000);

    await leadPage.showBanner('Submitting Lead Intake', 'Saving lead in state NEW (MUM01 Intake Queue)');
    await leadPage.submitLead(1500);

    // Verify redirected to lead detail
    await expect(page).toHaveURL(new RegExp(`/leads/${LEAD_ID}`));
    await expect(leadPage.heading).toContainText('Kavya Deshmukh');
    await expect(page.getByText('NEW', { exact: true })).toBeVisible();
    await leadPage.pause(1200);

    // Register Customer Contact Attempt (T-LEAD-01 & T-LEAD-02)
    await leadPage.showBanner('Registering Customer Contact Attempt', 'Advancing lead state to CONTACT_ATTEMPTED');
    await leadPage.attemptContact(1200);
    await expect(page.getByText('CONTACT_ATTEMPTED', { exact: true })).toBeVisible();

    await leadPage.showBanner('Advancing Lead to IN_PROGRESS', 'Borrower confirmed interest in loan program');
    await leadPage.markInProgress(1200);
    await expect(page.getByText('IN_PROGRESS', { exact: true })).toBeVisible();

    // Assign follow-up document collection task
    await leadPage.showBanner('Assigning Follow-up Task', 'Collect PAN card & 6 months bank statements');
    await leadPage.addTask('Collect PAN card & 6 months bank statements', 1200);
    await leadPage.pause(1000);

    await authPage.logout();

    // =======================================================================
    // STAGE 4: BRANCH MANAGER (vaibhav+branchmgr@qloax.com)
    // =======================================================================
    await authPage.loginAs(VAIBHAV_PERSONAS.branchMgr, '/', 'Vaibhav@1234');
    await dashboardPage.goto('/');
    await dashboardPage.showBanner(
      'Stage 4: Branch Manager',
      'Supervising Mumbai Central (MUM01) intake queues & workload allocation',
    );
    await expect(dashboardPage.dashboard).toBeVisible();
    await expect(dashboardPage.hubHeading).toBeVisible();
    await expect(page.getByText('Kavya Deshmukh')).toBeVisible();
    await dashboardPage.pause(1200);

    await authPage.logout();

    // =======================================================================
    // STAGE 5: RELATIONSHIP MANAGER 1 (vaibhav+rm1@qloax.com)
    // =======================================================================
    await authPage.loginAs(VAIBHAV_PERSONAS.rm1, `/leads/${LEAD_ID}`, 'Vaibhav@1234');
    await leadPage.goto(`/leads/${LEAD_ID}`);
    await leadPage.showBanner(
      'Stage 5: Relationship Manager 1',
      'Duplicate check, borrower qualification & atomic conversion (SUB-LEAD.06/09)',
    );
    await expect(leadPage.heading).toContainText('Kavya Deshmukh');

    // Verify duplicate badge is clean
    await leadPage.showBanner('Verifying Duplicate Check', 'Zero duplicate conflicts detected (Duplicate: NONE)');
    await expect(page.getByTestId('lead.duplicate-flag')).toHaveCount(0);
    await leadPage.pause(1000);

    // Open Qualify Dialog & qualify terms
    await leadPage.showBanner('Qualifying Loan Terms', 'Monthly Income: ₹75,000, Approved Amount: ₹3,00,000');
    await leadPage.openQualifyDialog();
    await leadPage.submitQualification('300000', '75000');
    await expect(page.getByText('QUALIFIED', { exact: true })).toBeVisible();
    await leadPage.pause(1200);

    // Execute Atomic Conversion to Customer & Loan Application
    await leadPage.showBanner(
      'Atomic Conversion',
      'Creating Master Customer (cus_demo_kavya_001) & Loan Application (app_demo_kavya_001)',
    );
    await leadPage.convertLead(1500);
    await expect(page.getByRole('heading', { name: 'Lead Converted Successfully' })).toBeVisible();
    await expect(page.getByRole('link', { name: APP_ID })).toBeVisible();
    await expect(page.getByText(CUST_ID, { exact: true })).toBeVisible();
    await leadPage.pause(1500);

    await authPage.logout();

    // =======================================================================
    // STAGE 6: LOAN OPERATIONS (vaibhav+loanops@qloax.com)
    // =======================================================================
    await authPage.loginAs(
      VAIBHAV_PERSONAS.loanOps,
      `/document-sharing?applicationId=${APP_ID}&action=upload-link`,
      'Vaibhav@1234',
    );
    await sharingPage.goto(`/document-sharing?applicationId=${APP_ID}&action=upload-link`);
    await sharingPage.showBanner(
      'Stage 6: Loan Operations',
      'Generating secure 2FA customer upload link with 7-day TTL (MOD-DSH)',
    );

    await expect(sharingPage.linkItemChips).toHaveCount(1);
    await sharingPage.click(sharingPage.linkItemChips.first(), 800);

    await sharingPage.showBanner('Authorizing Secure Link', 'Attaching PAN Card requirement with OTP protection');
    await sharingPage.click(sharingPage.generateLinkBtn, 1500);

    // Verify public upload URL is displayed
    await expect(page.getByText(`/upload/${SHARE_TOKEN}`)).toBeVisible();
    await sharingPage.showBanner('Link Created', `Public URL ready: /upload/${SHARE_TOKEN}`);
    await sharingPage.pause(1200);
    await sharingPage.click(sharingPage.closeDialogBtn, 800);

    await authPage.logout();

    // =======================================================================
    // STAGE 7: EXTERNAL CUSTOMER SECURE PORTAL (Borrower Kavya Deshmukh)
    // Unauthenticated context simulates external mobile/desktop borrower session
    // =======================================================================
    const customerContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const customerPage = await customerContext.newPage();
    const portalPage = new CustomerPortalPage(customerPage);

    // Mock Customer Portal Endpoints
    await customerPage.route(`**/public/v1/upload/${SHARE_TOKEN}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token: SHARE_TOKEN,
          status: 'ACTIVE',
          otpRequired: true,
          maskedContact: '+91 ******1234',
          expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
          requestedItems: [
            { checklistItemId: 'chk_pan_01', documentTypeCode: 'PAN_CARD', ordinal: 1, mandatory: true },
          ],
        }),
      });
    });

    await customerPage.route(`**/public/v1/upload/${SHARE_TOKEN}/otp-verification`, async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.otp === '123456') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            uploadSessionToken: 'mock-session-token-kavya-deshmukh',
          }),
        });
      } else {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'INVALID_OTP', message: 'Invalid or expired OTP verification code.' },
          }),
        });
      }
    });

    await customerPage.route(`**/public/v1/upload/${SHARE_TOKEN}/files`, async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          documentId: 'doc_kavya_pan_01',
          checklistItemId: 'chk_pan_01',
          filename: 'kavya_pan_card.pdf',
          fileSizeBytes: 102400,
          uploadedAt: new Date().toISOString(),
        }),
      });
    });

    await portalPage.goto(`/upload/${SHARE_TOKEN}`);
    await portalPage.showBanner(
      'Stage 7: External Customer Portal',
      'Two-Step Identity Verification gate with masked mobile +91 ******1234',
    );
    await expect(portalPage.portalHeader).toBeVisible();
    await expect(portalPage.identityVerificationHeader).toBeVisible();
    await expect(customerPage.getByText('+91 ******1234')).toBeVisible();
    await portalPage.pause(1000);

    // Test Invalid OTP rejection
    await portalPage.showBanner('Testing Invalid OTP', 'Entering incorrect code "999999" (Expect rejection)');
    await portalPage.type(portalPage.otpInput, '999999');
    await portalPage.click(portalPage.verifyOtpBtn, 1000);
    await expect(customerPage.getByText('Invalid or expired OTP verification code.').first()).toBeVisible();
    await portalPage.pause(1000);

    // Submit Valid OTP
    await portalPage.showBanner('Entering Valid 6-Digit OTP', 'Verifying code "123456" to unlock upload portal');
    await portalPage.verifyOtp('123456', 1500);

    // Verify upload portal unlocked
    await portalPage.showBanner('Upload Portal Unlocked', 'Checklist item: PAN CARD (Mandatory)');
    await expect(portalPage.uploadPortalHeading).toBeVisible();
    await expect(portalPage.checklistHeading).toBeVisible();
    await expect(customerPage.getByText('PAN CARD').first()).toBeVisible();
    await portalPage.pause(1000);

    // Attach synthetic PDF file
    await portalPage.showBanner('Attaching KYC Document', 'Attaching kavya_pan_card.pdf (%PDF-1.4 header)');
    await portalPage.attachFile(
      'kavya_pan_card.pdf',
      'application/pdf',
      '%PDF-1.4 synthetic kavya pan card test document payload',
    );
    await portalPage.pause(1000);

    // Submit upload
    await portalPage.showBanner('Submitting Encrypted Upload', 'Sending document to server with SHA-256 integrity hash');
    await portalPage.submitUpload(2000);

    // Verify upload success
    await portalPage.showBanner('Document Upload Successful!', 'Receipt generated & attached to application checklist');
    await expect(customerPage.getByText(/Successfully uploaded/i).first()).toBeVisible();
    await portalPage.pause(2000);

    await customerContext.close();
  });

  // =========================================================================
  // TC-DEMO-FULL-02: Complete Loan Fulfillment, Dual-Control Disbursal, Payout & Audit
  // =========================================================================
  test('TC-DEMO-FULL-02: Complete Loan Fulfillment, Dual-Control Disbursal, Commission Payout & Cryptographic Audit', async ({
    page,
  }) => {
    test.setTimeout(isHeaded ? 600_000 : 300_000);

    const authPage = new AuthPage(page);
    const vrfPage = new VerificationPage(page);
    const sanctionPage = new SanctionPage(page);
    const payoutPage = new PayoutPage(page);
    const auditPage = new AuditPage(page);

    const VRF_CASE_ID = 'vrf_case_kavya_001';

    page.on('response', async (res) => {
      if (res.status() >= 400) {
        const text = await res.text().catch(() => '');
        console.log(`[HTTP ${res.status()}] ${res.url()}: ${text}`);
      }
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        console.log(`[CONSOLE ${msg.type()}] ${msg.text()}`);
      }
    });

    // -----------------------------------------------------------------------
    // Mock Verification APIs
    // -----------------------------------------------------------------------
    const mockVrfCase = {
      id: VRF_CASE_ID,
      applicationId: APP_ID,
      verificationType: 'DOCUMENT_REVIEW',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      findingsSummary: null as string | null,
      lockVersion: 1,
      checklistItmIds: ['chk_pan_01'],
      createdAt: new Date().toISOString(),
    };

    await page.route('**/v1/verification-requests**', async (route) => {
      const url = route.request().url();
      if (url.includes(`/${VRF_CASE_ID}/attestation`)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      } else if (url.includes(`/${VRF_CASE_ID}/complete`)) {
        mockVrfCase.status = 'COMPLETED';
        mockVrfCase.findingsSummary = 'POSITIVE';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: mockVrfCase }),
        });
      } else if (url.includes(`/${VRF_CASE_ID}`)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: mockVrfCase }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [mockVrfCase], meta: { total: 1 } }),
        });
      }
    });

    // -----------------------------------------------------------------------
    // Mock Sanctions & Disbursements APIs
    // -----------------------------------------------------------------------
    const mockSanctions: any[] = [];
    const mockTranches: any[] = [];

    await page.route(`**/v1/lender-cases/${CASE_ID}/sanctions`, async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        const newSanction = {
          id: SANCTION_ID,
          lenderCaseId: CASE_ID,
          amount: body.amount || '280000',
          tenureMonths: body.tenureMonths || '36',
          rateValue: body.rateValue || '11.5',
          rateType: 'FIXED',
          status: 'ACTIVE',
          sanctionDate: new Date().toISOString().split('T')[0],
          validUntil: '2027-10-26',
          createdAt: new Date().toISOString(),
        };
        mockSanctions.push(newSanction);
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: newSanction }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: mockSanctions }) });
      }
    });

    await page.route(`**/v1/sanctions/${SANCTION_ID}/tranches`, async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        const newTranche = {
          id: TRANCHE_ID,
          sanctionId: SANCTION_ID,
          trancheNo: 1,
          amount: body.amount || '140000',
          disbursedOn: new Date().toISOString().split('T')[0],
          status: 'RECORDED',
          utrMasked: 'UTR***0001',
          loanAccountMasked: 'LA***0123',
          recordedBy: 'usr_vaibhav_loanops_01',
          verifiedBy: null,
          createdAt: new Date().toISOString(),
        };
        mockTranches.push(newTranche);
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: newTranche }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: mockTranches }) });
      }
    });

    await page.route(new RegExp(`/v1/(sanctions/)?tranches/${TRANCHE_ID}/(verification|verify)`), async (route) => {
      const tranche = mockTranches[0];
      if (tranche) {
        tranche.status = 'VERIFIED';
        tranche.verifiedBy = 'usr_vaibhav_branchmgr_01';
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: tranche }) });
    });

    // -----------------------------------------------------------------------
    // Mock Finance Payouts APIs (SOD-03 Maker-Checker)
    // -----------------------------------------------------------------------
    const mockPayout = {
      id: 'pay_req_kavya_001',
      connectorId: 'con_direct_sales',
      origin: 'COMMISSION_ENGINE',
      total: '1400.00',
      status: 'SUBMITTED',
      submittedBy: 'usr_vaibhav_finance_01',
      submittedAt: new Date().toISOString(),
      lines: [
        {
          id: 'pline_001',
          payableId: 'pay_kavya_tranche_1',
          amount: '1400.00',
          currency: 'INR',
          description: '1.0% Commission on Disbursed Tranche #1 (₹1,40,000)',
        },
      ],
    };

    await page.route('**/v1/payout-requests**', async (route) => {
      const url = route.request().url();
      if (url.includes('/approval')) {
        mockPayout.status = 'APPROVED';
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: mockPayout }) });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [mockPayout], meta: { limit: 50, nextCursor: null } }),
        });
      }
    });

    // -----------------------------------------------------------------------
    // Mock Compliance Audit Ledger APIs
    // -----------------------------------------------------------------------
    const mockAuditEvents = [
      {
        id: 'aud_01J00000000000000000000001',
        tenantId: TENANT_ID,
        entityType: 'LOAN_APPLICATION',
        entityId: APP_ID,
        action: 'LEAD_CONVERSION',
        actorId: 'usr_vaibhav_rm1_01',
        actorType: 'USER',
        prevHash: '0000000000000000000000000000000000000000000000000000000000000000',
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        occurredAt: new Date().toISOString(),
      },
      {
        id: 'aud_01J00000000000000000000002',
        tenantId: TENANT_ID,
        entityType: 'DOCUMENT',
        entityId: 'doc_kavya_pan_01',
        action: 'CUSTOMER_UPLOAD',
        actorId: 'PUBLIC_BORROWER',
        actorType: 'EXTERNAL',
        prevHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
        occurredAt: new Date().toISOString(),
      },
      {
        id: 'aud_01J00000000000000000000003',
        tenantId: TENANT_ID,
        entityType: 'SANCTION',
        entityId: SANCTION_ID,
        action: 'SANCTION_RECORDED',
        actorId: 'usr_vaibhav_loanops_01',
        actorType: 'USER',
        prevHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
        hash: '879942a1efb96b4bf04f141fb13ec4c01828bf4e75618451877bd36f5cc767b4',
        occurredAt: new Date().toISOString(),
      },
    ];

    await page.route('**/v1/audit-events**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: mockAuditEvents, meta: { total: 3, hasMore: false } }),
      });
    });

    await page.route('**/v1/audit-chain/verification', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'VERIFIED',
          tenantId: TENANT_ID,
          totalEvents: 3,
          sealedEvents: 3,
          unsealedEvents: 0,
          verifiedRange: {
            fromSeq: 1,
            toSeq: 3,
            genesisHash: '0000000000000000000000000000000000000000000000000000000000000000',
            latestHash: '879942a1efb96b4bf04f141fb13ec4c01828bf4e75618451877bd36f5cc767b4',
          },
          verifiedAt: new Date().toISOString(),
        }),
      });
    });

    await page.route('**/v1/evidence-packs**', async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'evp_demo_20261026_001',
            entityType: 'LOAN_APPLICATION',
            entityId: body.entityId || APP_ID,
            purpose: body.purpose || 'REGULATORY_AUDIT',
            status: 'COMPLETED',
            packHashSha256: '879942a1efb96b4bf04f141fb13ec4c01828bf4e75618451877bd36f5cc767b4',
            createdAt: new Date().toISOString(),
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        });
      }
    });

    // =======================================================================
    // STAGE 8: DOCUMENT VERIFIER (vaibhav+verifier@qloax.com)
    // =======================================================================
    await authPage.loginAs(VAIBHAV_PERSONAS.docVerifier, '/verifications', 'Vaibhav@1234');
    await vrfPage.showBanner(
      'Stage 8: Document Verifier',
      'Reviewing uploaded KYC document checklist on Workbench (MOD-VRF)',
    );
    await expect(page.getByText(VRF_CASE_ID)).toBeVisible();
    await vrfPage.pause(1000);

    // Open Case Detail
    await vrfPage.goto(`/verifications/${VRF_CASE_ID}`);
    await vrfPage.showBanner('Attesting PAN Card Validity', 'Confirming document authenticity: ACCEPTED');
    await expect(vrfPage.getAttestBtn('chk_pan_01')).toBeVisible();
    await vrfPage.attestChecklistItem('chk_pan_01', 'ACCEPTED', 'Verified against NSDL ITD Database');
    await expect(page.getByRole('alert')).toContainText(/marked as ACCEPTED/i);
    await vrfPage.pause(1200);

    // Finalize assessment with positive verdict
    await vrfPage.showBanner('Completing Verification Assessment', 'Assessment Verdict: POSITIVE');
    await vrfPage.completeVerification('All KYC documents verified with positive validation.');
    await vrfPage.pause(1200);

    await authPage.logout();

    // =======================================================================
    // STAGE 9: LOAN OPERATIONS (vaibhav+loanops@qloax.com)
    // Sanction recording & disbursement tranche #1 logging
    // =======================================================================
    await authPage.loginAs(VAIBHAV_PERSONAS.loanOps, `/sanctions/${CASE_ID}`, 'Vaibhav@1234');
    await sanctionPage.showBanner(
      'Stage 9: Loan Operations — Sanction & Disbursal',
      'Recording approved terms from Demo Bank (₹2,80,000 @ 11.5%, 36 mos)',
    );
    await expect(sanctionPage.sanctionsPanel).toBeVisible();

    // Record Sanction
    await sanctionPage.showBanner('Recording Sanction Terms', 'Approved: ₹2,80,000, 36 months, 11.5% fixed rate');
    await sanctionPage.recordSanction({
      amount: '280000',
      tenureMonths: '36',
      rateValue: '11.5',
    });
    await sanctionPage.pause(1200);

    // Record Disbursement Tranche #1
    await sanctionPage.showBanner('Recording Tranche #1 Disbursal', 'Tranche: ₹1,40,000, UTR: UTR-DEMO-20261026-001');
    await sanctionPage.recordTranche({
      amount: '140000',
      utr: 'UTR-DEMO-20261026-001',
      loanAccount: 'LA000000123',
    });
    await sanctionPage.pause(1200);

    await authPage.logout();

    // =======================================================================
    // STAGE 10: BRANCH MANAGER (vaibhav+branchmgr@qloax.com)
    // Maker-Checker dual-control disbursal verification (SOD-04)
    // =======================================================================
    await authPage.loginAs(VAIBHAV_PERSONAS.branchMgr, `/sanctions/${CASE_ID}`, 'Vaibhav@1234');
    await sanctionPage.showBanner(
      'Stage 10: Branch Manager (Checker)',
      'SOD-04 Maker-Checker verification on Tranche #1 with bank credit confirmation',
    );
    await expect(sanctionPage.sanctionsPanel).toBeVisible();

    const verifyTrancheBtn = sanctionPage.getVerifyTrancheBtn(TRANCHE_ID);
    if (await verifyTrancheBtn.isVisible()) {
      await sanctionPage.showBanner('Authorizing Tranche Verification', 'Dual-control confirmation on ₹1,40,000 disbursal');
      await sanctionPage.click(verifyTrancheBtn, 1000);
      const submitDecisionBtn = page.getByRole('button', { name: 'Submit Decision' });
      if (await submitDecisionBtn.isVisible()) {
        await sanctionPage.click(submitDecisionBtn, 1500);
      }
      await expect(page.getByText('VERIFIED').first()).toBeVisible();
    }
    await sanctionPage.pause(1200);

    await authPage.logout();

    // =======================================================================
    // STAGE 11: COMMISSION APPROVER / OWNER (vaibhav+commission@qloax.com)
    // SOD-03 Dual Control payout review & approval
    // =======================================================================
    await authPage.loginAs(VAIBHAV_PERSONAS.commissionApprover, '/payouts', 'Vaibhav@1234');
    await payoutPage.showBanner(
      'Stage 11: Commission Approver (Finance)',
      'SOD-03 Independent dual-control payout authorization (1.0% = ₹1,400.00)',
    );
    await expect(page.getByText('Payouts & Settlement Hub')).toBeVisible();

    await payoutPage.switchToApprovalQueue();
    const decideBtn = page.getByRole('row').filter({ hasText: 'pay_req_kavya_001' }).getByRole('button', { name: /Review & Decide/i });
    if (await decideBtn.isVisible()) {
      await payoutPage.showBanner('Approving Commission Payout', 'Authorizing ₹1,400.00 payout for Kavya Deshmukh tranche');
      await payoutPage.click(decideBtn, 1000);
      if (await payoutPage.decisionCommentInput.isVisible()) {
        await payoutPage.type(payoutPage.decisionCommentInput, 'Approved: Validated against Demo Bank scheduled disbursement tranche');
      }
      await payoutPage.click(payoutPage.confirmApprovedBtn, 1500);
    }
    await payoutPage.pause(1200);

    await authPage.logout();

    // =======================================================================
    // STAGE 12: COMPLIANCE OFFICER (vaibhav+compliance@qloax.com)
    // Cryptographic audit chain SHA-256 verification & evidence pack export
    // =======================================================================
    await authPage.loginAs(VAIBHAV_PERSONAS.compliance, '/audit', 'Vaibhav@1234');
    await auditPage.showBanner(
      'Stage 12: Compliance Officer',
      'Inspecting cryptographic SHA-256 audit ledger & verifying Merkle chain integrity (MOD-AUD)',
    );
    await expect(page.getByText(APP_ID)).toBeVisible();
    await expect(page.getByText('LOAN_APPLICATION')).toBeVisible();

    // Verify cryptographic audit chain integrity
    await auditPage.showBanner('Executing Merkle Root Verification', 'Cryptographic verification across all events');
    await auditPage.verifyChainIntegrity(1500);

    // Verify modal rendered with VERIFIED status
    await auditPage.showBanner('Audit Integrity Confirmed', '100% Tamper-Evident: Cryptographic status VERIFIED');
    await expect(page.getByText(/Chain Status:/i)).toBeVisible();
    await expect(page.getByText('VERIFIED', { exact: true }).first()).toBeVisible();
    await auditPage.pause(1500);

    await auditPage.closeModal();

    // Export evidence pack
    await auditPage.showBanner('Exporting Regulatory Evidence Pack', 'Sealing cryptographic evidence for statutory audit');
    await auditPage.exportEvidencePack('RBI Statutory Audit & DPDP Compliance Inspection', 2000);
    await expect(page.getByText(/export requested/i)).toBeVisible();
    await auditPage.closeModal();
    await auditPage.pause(1000);

    await authPage.logout();
    await auditPage.showBanner('E2E Demonstration Complete!', 'Unbroken lifecycle from organisation setup to audit complete');
    await auditPage.pause(2000);
  });
});
