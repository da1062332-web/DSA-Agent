import { test, expect } from '@playwright/test';
import { PERSONAS, ADITYA_PERSONAS, isHeaded } from './helpers/mock-session';
import {
  AuthPage,
  PlatformAdminPage,
  TenantAdminPage,
  OrgOwnerPage,
  ManagerDashboardPage,
  TasksPage,
} from './pages';

/**
 * Spec 20: Adity Finserv Administrative & Team Setup Master Suite
 *
 * Demonstrates the unbroken multi-stage setup workflow from platform provisioning
 * to frontline team management with human pacing, visual subheaders, and creation actions:
 *
 * Stage 1: Platform Super Admin (vaibhav.qloax@gmail.com / ROLE-PLATFORM-SUPERADMIN)
 *          - Multi-tenant directory inspection for Adity Finserv (adity-finserv)
 *          - Tenant workspace detail & configuration drill-down
 *          - Tenant feature flag & circuit breaker verification
 *          - Background jobs queue throughput inspection
 *          - Clean logout
 *
 * Stage 2: Tenant Administrator (admin@adityfinserv.com / ROLE-TENANT-ADMIN)
 *          - Branch network governance: inspect MUM01 and provision new regional branch (PUN01)
 *          - Intake queue provisioning: create automated work queue (PUN01-INTAKE)
 *          - Staff user onboarding: invite frontline staff user (Aditya Pune RM / ROLE-RM)
 *          - Staff directory hierarchy & search filtering
 *          - Clean logout
 *
 * Stage 3: Organisation Owner (owner@adityfinserv.com / ROLE-ORG-OWNER)
 *          - Executive command center: pipeline funnel, branch metrics & origination volume
 *          - Strategic channel partner directory & commission agreement governance
 *          - Clean logout
 *
 * Stage 4: Team Manager (teammgr@adityfinserv.com / ROLE-TEAM-MGR)
 *          - MUM01 sales team supervision & inbound borrower lead backlog
 *          - Frontline task queue & SLA milestone tracking
 *          - Clean logout
 */
test.describe('Adity Finserv Administrative & Team Setup Master Suite', () => {
  const TENANT_ID = 'ten_01M5XZ4V895M211J3ZRVGTVBHY';
  const TENANT_SLUG = 'adity-finserv';
  const STANDARD_PASSWORD = 'Admin@123';

  test('TC-ADITYA-ADMIN-01: End-to-End Administrative & Team Setup Flow', async ({ page }) => {
    test.setTimeout(isHeaded ? 600_000 : 300_000);

    const authPage = new AuthPage(page);
    const platformPage = new PlatformAdminPage(page);
    const tenantAdminPage = new TenantAdminPage(page);
    const orgOwnerPage = new OrgOwnerPage(page);
    const dashboardPage = new ManagerDashboardPage(page);
    const tasksPage = new TasksPage(page);

    // Dynamic state stores
    const branchesList = [
      {
        id: 'MUM01',
        code: 'MUM01',
        name: 'Mumbai Central',
        pincode: '400008',
        timezone: 'Asia/Kolkata',
        status: 'ACTIVE',
        version: 1,
      },
      {
        id: 'PUN01',
        code: 'PUN01',
        name: 'Pune Camp',
        pincode: '411001',
        timezone: 'Asia/Kolkata',
        status: 'ACTIVE',
        version: 1,
      },
    ];

    const workQueuesList = [
      {
        id: 'q_mum01_intake',
        code: 'MUM01-INTAKE',
        name: 'Mumbai Central Inbound Intake Queue',
        kind: 'INTAKE',
        branchId: 'MUM01',
        recordTypes: ['LEAD'],
        active: true,
        memberCount: 4,
        version: 1,
      },
    ];

    const adityaUsers = [
      {
        id: ADITYA_PERSONAS.tenantAdmin.userId,
        email: ADITYA_PERSONAS.tenantAdmin.email,
        displayName: ADITYA_PERSONAS.tenantAdmin.displayName,
        status: 'ACTIVE',
        primaryBranch: { id: 'MUM01', name: 'Mumbai Central' },
        roles: ['ROLE-TENANT-ADMIN'],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: ADITYA_PERSONAS.orgOwner.userId,
        email: ADITYA_PERSONAS.orgOwner.email,
        displayName: ADITYA_PERSONAS.orgOwner.displayName,
        status: 'ACTIVE',
        primaryBranch: { id: 'MUM01', name: 'Mumbai Central' },
        roles: ['ROLE-ORG-OWNER'],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: ADITYA_PERSONAS.teamMgr.userId,
        email: ADITYA_PERSONAS.teamMgr.email,
        displayName: ADITYA_PERSONAS.teamMgr.displayName,
        status: 'ACTIVE',
        primaryBranch: { id: 'MUM01', name: 'Mumbai Central' },
        roles: ['ROLE-TEAM-MGR'],
        createdAt: '2026-01-02T00:00:00.000Z',
      },
      {
        id: ADITYA_PERSONAS.rm1.userId,
        email: ADITYA_PERSONAS.rm1.email,
        displayName: ADITYA_PERSONAS.rm1.displayName,
        status: 'ACTIVE',
        primaryBranch: { id: 'MUM01', name: 'Mumbai Central' },
        roles: ['ROLE-RM'],
        createdAt: '2026-01-02T00:00:00.000Z',
      },
      {
        id: ADITYA_PERSONAS.salesExec.userId,
        email: ADITYA_PERSONAS.salesExec.email,
        displayName: ADITYA_PERSONAS.salesExec.displayName,
        status: 'ACTIVE',
        primaryBranch: { id: 'MUM01', name: 'Mumbai Central' },
        roles: ['ROLE-SALES-EXEC'],
        createdAt: '2026-01-03T00:00:00.000Z',
      },
    ];

    // Ensure Auth config endpoint returns mfaEnabled: false so login completes instantly
    await page.route('**/public/v1/auth/config**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mfaEnabled: false }),
      });
    });

    // -----------------------------------------------------------------------
    // Mock Platform Endpoints (Stage 1)
    // -----------------------------------------------------------------------
    await page.route('**/platform/v1/tenants', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: TENANT_ID,
              slug: TENANT_SLUG,
              legalName: 'Adity Finserv Private Limited',
              tenantType: 'DSA',
              dataRegion: 'ap-south-1',
              timezone: 'Asia/Kolkata',
              status: 'ACTIVE',
              healthStatus: 'HEALTHY',
              activeUsersCount: 14,
              entitlements: ['MOD-LEAD', 'MOD-APP', 'MOD-DOC', 'MOD-SAN', 'MOD-PAY'],
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-10-23T00:00:00.000Z',
            },
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
              entitlements: ['MOD-LEAD', 'MOD-APP', 'MOD-DOC'],
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-10-23T00:00:00.000Z',
            },
          ],
          meta: { total: 2 },
        }),
      });
    });

    await page.route(`**/platform/v1/tenants/${TENANT_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: TENANT_ID,
          slug: TENANT_SLUG,
          legalName: 'Adity Finserv Private Limited',
          tenantType: 'DSA',
          dataRegion: 'ap-south-1',
          timezone: 'Asia/Kolkata',
          status: 'ACTIVE',
          healthStatus: 'HEALTHY',
          activeUsersCount: 14,
          entitlements: ['MOD-LEAD', 'MOD-APP', 'MOD-DOC', 'MOD-SAN', 'MOD-PAY'],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-10-23T00:00:00.000Z',
        }),
      });
    });

    await page.route(`**/platform/v1/tenants/${TENANT_ID}/flags**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              key: 'FF_ENABLE_AI_ASSISTANT',
              description: 'Enable AI lead summarizer & intake assistant for Adity Finserv',
              scope: 'TENANT',
              value: true,
              lockVersion: 1,
            },
          ],
          meta: { total: 1 },
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
              key: 'FF_ENABLE_AI_ASSISTANT',
              description: 'Enable AI lead summarizer & intake assistant for Adity Finserv',
              scope: 'TENANT',
              value: true,
              lockVersion: 1,
            },
            {
              key: 'FF_ENABLE_NEW_BRE_SIMULATOR',
              description: 'Next-generation credit rule simulator engine',
              scope: 'GLOBAL',
              value: true,
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
              queue: 'tenant_provisioning_queue',
              paused: false,
              activeJobs: 0,
              completedJobs: 42,
              failedJobs: 0,
              delayedJobs: 0,
              waitingJobs: 0,
            },
            {
              queue: 'outbox_dispatcher',
              paused: false,
              activeJobs: 1,
              completedJobs: 512,
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
          database: { connected: true, latencyMs: 2 },
          redis: { connected: true, latencyMs: 1 },
          timestamp: new Date().toISOString(),
        }),
      });
    });

    // -----------------------------------------------------------------------
    // Mock Tenant Admin & Org Endpoints (Stage 2 & 3)
    // -----------------------------------------------------------------------
    await page.route('**/v1/branches**', async (route) => {
      const method = route.request().method();
      if (method === 'POST') {
        const body = route.request().postDataJSON() || {};
        const newBranch = {
          id: `br_${body.code?.toLowerCase() || 'new'}`,
          code: body.code?.toUpperCase() || 'PUN01',
          name: body.name || 'Pune Branch',
          pincode: body.pincode || '411001',
          timezone: body.timezone || 'Asia/Kolkata',
          status: 'ACTIVE',
          version: 1,
        };
        branchesList.push(newBranch);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(newBranch),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: branchesList }),
      });
    });

    await page.route('**/v1/work-queues**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      if (method === 'POST') {
        const body = route.request().postDataJSON() || {};
        const newQueue = {
          id: `q_${body.code?.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'new'}`,
          code: body.code?.toUpperCase() || 'PUN01-INTAKE',
          name: body.name || 'Pune Inbound Leads Queue',
          kind: body.kind || 'INTAKE',
          branchId: body.branchId || 'MUM01',
          recordTypes: body.recordTypes || ['LEAD'],
          active: true,
          memberCount: 0,
          members: [],
          version: 1,
          createdAt: new Date().toISOString(),
        };
        workQueuesList.push(newQueue);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(newQueue),
        });
        return;
      }

      // Check single queue detail
      const singleQueueMatch = url.match(/\/work-queues\/([a-zA-Z0-9_-]+)(?:\?|$)/);
      if (singleQueueMatch && singleQueueMatch[1] && singleQueueMatch[1] !== 'work-queues') {
        const qId = singleQueueMatch[1];
        const queueObj = workQueuesList.find((q) => q.id === qId || q.code === qId) || workQueuesList[0];
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...queueObj,
            members: [],
            createdAt: new Date().toISOString(),
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: workQueuesList,
          meta: { nextCursor: null, limit: 50 },
        }),
      });
    });

    await page.route('**/v1/teams**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'tm_mum01_sales',
              name: 'MUM01 Direct Sales Team',
              branchId: 'MUM01',
              status: 'ACTIVE',
            },
          ],
        }),
      });
    });

    await page.route('**/v1/users**', async (route) => {
      const url = route.request().url();
      if (url.includes('/invitations')) {
        const body = route.request().postDataJSON() || {};
        const newUser = {
          id: 'usr_aditya_pune_rm_01',
          tenantId: TENANT_ID,
          email: body.email || 'punerm@adityfinserv.com',
          displayName: body.displayName || 'Aditya Pune RM',
          mobileE164: body.mobileE164 || '+919820011223',
          userType: 'STAFF',
          status: 'INVITED',
          availability: 'AVAILABLE',
          primaryBranchId: body.primaryBranchId || 'MUM01',
          primaryBranch: { id: 'MUM01', name: 'Mumbai Central' },
          roles: ['ROLE-RM'],
          assignedRoles: ['ROLE-RM'],
          lockVersion: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        adityaUsers.push(newUser);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(newUser),
        });
        return;
      }

      if (url.includes('/usr_aditya_pune_rm_01/invitation')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            userStatus: 'INVITED',
            invitationState: 'PENDING',
            deliveryState: 'SENT',
            lastFailure: null,
            sentAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 604800000).toISOString(),
            resendCount: 0,
            acceptedAt: null,
            nextResendAt: null,
          }),
        });
        return;
      }

      if (url.includes('/usr_aditya_pune_rm_01')) {
        const user = adityaUsers.find((u) => u.id === 'usr_aditya_pune_rm_01') || adityaUsers[0];
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(user),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: adityaUsers,
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
            {
              id: 'rol_aditya_admin',
              code: 'ROLE-TENANT-ADMIN',
              name: 'Tenant Administrator',
              permissions: ['user.manage', 'config.manage', 'role.manage'],
            },
            {
              id: 'rol_aditya_owner',
              code: 'ROLE-ORG-OWNER',
              name: 'Organisation Owner',
              permissions: ['target.manage', 'finance.view', 'connector.manage'],
            },
            {
              id: 'rol_aditya_teammgr',
              code: 'ROLE-TEAM-MGR',
              name: 'Team Manager',
              permissions: ['lead.assign', 'task.assign', 'task.read'],
            },
            {
              id: 'rol_aditya_rm',
              code: 'ROLE-RM',
              name: 'Relationship Manager',
              permissions: ['lead.create', 'lead.qualify', 'application.create'],
            },
            {
              id: 'rol_aditya_sales',
              code: 'ROLE-SALES-EXEC',
              name: 'Sales Executive',
              permissions: ['lead.create', 'lead.read'],
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
            { code: 'user.manage', domain: 'Administration', description: 'Manage staff users and invitations' },
            { code: 'role.manage', domain: 'Administration', description: 'Configure roles and RBAC mappings' },
            { code: 'config.manage', domain: 'Administration', description: 'Manage branches, teams and queues' },
            { code: 'lead.assign', domain: 'Leads', description: 'Assign inbound borrower leads across reps' },
            { code: 'task.assign', domain: 'Tasks', description: 'Delegate frontline workflow tasks' },
          ],
        }),
      });
    });

    await page.route('**/v1/audit/events**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'evt_aditya_01',
              action: 'tenant.provisioned',
              actorUserId: PERSONAS.platformSuperAdmin.userId,
              resourceType: 'TENANT',
              resourceId: TENANT_ID,
              occurredAt: new Date().toISOString(),
            },
          ],
          meta: { nextCursor: null, limit: 20 },
        }),
      });
    });

    await page.route('**/v1/applications**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'app_aditya_owner_01',
              leadId: 'led_aditya_inbound_01',
              borrowerName: 'Deepak Verma',
              amount: '500000.00',
              status: 'NEW',
              branchId: 'MUM01',
              createdAt: new Date().toISOString(),
            },
          ],
          meta: { total: 1, limit: 50 },
        }),
      });
    });

    await page.route('**/v1/leads**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'led_aditya_inbound_01',
              fullName: 'Deepak Verma',
              mobileMasked: '+91 ••••• ••892',
              productCategory: 'PERSONAL_LOAN',
              state: 'NEW',
              branchId: 'MUM01',
              assignedUserId: null,
              indicativeAmount: { amount: '500000.00', currency: 'INR' },
              createdAt: new Date().toISOString(),
            },
          ],
          meta: { total: 1 },
        }),
      });
    });

    await page.route('**/v1/tasks**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'tsk_aditya_tm_001',
              title: 'Verify Initial Income Eligibility & Collect PAN',
              status: 'OPEN',
              priority: 'HIGH',
              type: 'DOCUMENT_COLLECTION',
              linkedType: 'LEAD',
              linkedId: 'led_aditya_inbound_01',
              branchId: 'MUM01',
              ownerUserId: ADITYA_PERSONAS.rm1.userId,
              dueAt: new Date(Date.now() + 86400000).toISOString(),
              lockVersion: 1,
              createdAt: new Date().toISOString(),
            },
          ],
          pagination: { nextCursor: null, hasMore: false },
        }),
      });
    });

    // =======================================================================
    // STAGE 1: PLATFORM SUPER ADMIN (ROLE-PLATFORM-SUPERADMIN)
    // Multi-tenant directory, tenant workspace inspection & feature toggles
    // =======================================================================
    await authPage.showBanner(
      'Stage 1: Platform Super Admin',
      'Signing in to Multi-Tenant Platform Console (vaibhav.qloax@gmail.com)',
    );
    await authPage.loginAs(PERSONAS.platformSuperAdmin, '/platform-admin');
    await platformPage.pause(1200);

    // Verify Platform Operations Console & Tenant Directory
    await platformPage.showBanner(
      'Multi-Tenant Platform Directory',
      'Inspecting active tenants directory and zero business data isolation (MOD-TEN)',
    );
    await expect(platformPage.heading).toBeVisible();
    await expect(page.getByText('Adity Finserv Private Limited').first()).toBeVisible();
    await expect(page.getByText('adity-finserv').first()).toBeVisible();
    await platformPage.pause(1500);

    // Drill down to Adity Finserv Tenant Workspace Detail
    await platformPage.showBanner(
      'Tenant Workspace Configuration',
      'Drilling into Adity Finserv workspace detail: AWS ap-south-1 & core module entitlements',
    );
    const manageAdityaBtn = page.getByRole('link', { name: 'Manage' }).first();
    if (await manageAdityaBtn.isVisible()) {
      await platformPage.click(manageAdityaBtn, 1200);
      await expect(page.getByText('Adity Finserv Private Limited').first()).toBeVisible();
      await expect(page.getByText('adity-finserv').first()).toBeVisible();
      await platformPage.pause(1200);

      // Verify Tenant Feature Flags
      const tenantFlagsTab = page.getByRole('tab', { name: /Feature Flags/i });
      if (await tenantFlagsTab.isVisible()) {
        await platformPage.click(tenantFlagsTab, 1000);
        await expect(page.getByText('FF_ENABLE_AI_ASSISTANT')).toBeVisible();
        await platformPage.pause(1200);
      }

      // Return to main platform console
      await platformPage.goto('/platform-admin');
      await platformPage.pause(1000);
    }

    // Switch to Global Feature Flags Tab
    await platformPage.showBanner(
      'Global Feature Flags & Circuit Breakers',
      'Configuring dynamic platform capabilities: FF_ENABLE_AI_ASSISTANT & FF_ENABLE_NEW_BRE_SIMULATOR',
    );
    await platformPage.switchToFlagsTab();
    await expect(page.getByText('FF_ENABLE_AI_ASSISTANT')).toBeVisible();
    await platformPage.pause(1500);

    // Switch to Background Jobs Tab
    await platformPage.showBanner(
      'Background Jobs & Worker Telemetry',
      'Monitoring tenant provisioning queue and asynchronous outbox workers',
    );
    await platformPage.switchToJobsTab();
    await expect(page.getByText('tenant_provisioning_queue')).toBeVisible();
    await platformPage.pause(1500);

    // Logout Stage 1
    await platformPage.showBanner('Signing Out Platform Operator', 'Ending Operator session before tenant handover');
    await authPage.logout();
    await platformPage.pause(1200);

    // =======================================================================
    // STAGE 2: TENANT ADMINISTRATOR (admin@adityfinserv.com / Admin@123)
    // Branch setup (MUM01, PUN01), intake queues & staff user provisioning
    // =======================================================================
    await authPage.showBanner(
      'Stage 2: Tenant Administrator',
      'Signing in as Asha Admin (ROLE-TENANT-ADMIN) for Adity Finserv workspace setup',
    );
    await authPage.loginAs(ADITYA_PERSONAS.tenantAdmin, '/admin/branches', STANDARD_PASSWORD);
    await tenantAdminPage.pause(1200);

    // Re-bind dynamic branch and queue routes for Tenant Admin session
    await page.route('**/v1/branches**', async (route) => {
      const method = route.request().method();
      if (method === 'POST') {
        const body = route.request().postDataJSON() || {};
        const newBranch = {
          id: `br_${body.code?.toLowerCase() || 'new'}`,
          code: body.code?.toUpperCase() || 'NAS01',
          name: body.name || 'Nashik Main',
          pincode: body.pincode || '422001',
          timezone: body.timezone || 'Asia/Kolkata',
          status: 'ACTIVE',
          version: 1,
        };
        branchesList.push(newBranch);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(newBranch),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: branchesList }),
      });
    });

    // 1. Branch Office Governance & Creation (MUM01, PUN01 & NAS01)
    await tenantAdminPage.showBanner(
      'Branch Office Setup & Governance',
      'Inspecting Head-Office Branch: MUM01 (Mumbai Central) and PUN01 (Pune Camp)',
    );
    await expect(page.getByText('MUM01').first()).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Mumbai Central' })).toBeVisible();
    await tenantAdminPage.pause(1200);

    // Create New Branch Office (NAS01)
    const newBranchBtn = page.locator('[data-testid="admin.branches.new"]');
    if (await newBranchBtn.isVisible()) {
      await tenantAdminPage.showBanner(
        'Expanding Branch Network: New Branch',
        'Provisioning Nashik regional branch office: NAS01 (Nashik Main, PIN: 422001)',
      );
      await tenantAdminPage.click(newBranchBtn, 800);
      const codeInput = page.locator('[data-testid="admin.branch.code"]');
      const nameInput = page.locator('[data-testid="admin.branch.name"]');
      const pincodeInput = page.getByLabel('PIN code');

      await tenantAdminPage.type(codeInput, 'NAS01');
      await tenantAdminPage.type(nameInput, 'Nashik Main');
      await tenantAdminPage.type(pincodeInput, '422001');
      await tenantAdminPage.pause(800);

      const saveBranchBtn = page.locator('[data-testid="admin.branch.save"]');
      await tenantAdminPage.click(saveBranchBtn, 1200);
      await expect(page.getByText('NAS01').first()).toBeVisible();
      await expect(page.getByRole('cell', { name: 'Nashik Main' })).toBeVisible();
      await tenantAdminPage.pause(1200);
    }

    // 2. Intake Queue Setup & Creation (MUM01-INTAKE & NAS01-INTAKE)
    await tenantAdminPage.showBanner(
      'Automated Work Queues & Routing',
      'Navigating to Work Queues to configure automated inbound lead intake pipelines',
    );
    await tenantAdminPage.gotoQueues();
    await expect(page.getByText('MUM01-INTAKE').first()).toBeVisible();
    await tenantAdminPage.pause(1200);

    // Create New Work Queue (NAS01-INTAKE)
    const newQueueBtn = page.locator('[data-testid="admin.queues.new"]');
    if (await newQueueBtn.isVisible()) {
      await tenantAdminPage.showBanner(
        'Creating Intake Queue: NAS01-INTAKE',
        'Creating automated round-robin intake queue for Nashik regional borrower leads',
      );
      await tenantAdminPage.click(newQueueBtn, 800);

      const queueDialog = page.getByRole('dialog');
      const queueCodeInput = queueDialog.locator('[data-testid="admin.queue.code"]');
      const queueNameInput = queueDialog.getByLabel('Name');
      await tenantAdminPage.type(queueCodeInput, 'NAS01-INTAKE');
      await tenantAdminPage.type(queueNameInput, 'Nashik Inbound Leads Queue');

      const branchDropdown = queueDialog.getByLabel('Branch');
      if (await branchDropdown.isVisible()) {
        await tenantAdminPage.click(branchDropdown, 600);
        await tenantAdminPage.click(page.getByRole('option', { name: /Mumbai Central/i }).first(), 600);
      }
      await tenantAdminPage.pause(800);

      const saveQueueBtn = queueDialog.locator('[data-testid="admin.queue.save"]');
      await tenantAdminPage.click(saveQueueBtn, 1200);
      await tenantAdminPage.gotoQueues();
      await expect(page.getByText('NAS01-INTAKE').first()).toBeVisible();
      await tenantAdminPage.pause(1200);
    }

    // 3. Staff User Directory & Onboarding (+ Add New User)
    await tenantAdminPage.showBanner(
      'Staff Directory & User Management',
      'Verifying provisioned staff accounts: Owner, Team Manager, RM, and Sales Intake',
    );
    await tenantAdminPage.gotoUsers();
    await expect(page.getByRole('cell', { name: 'Aditya Admin' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Aditya Owner' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Aditya Team Mgr' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Aditya RM 1' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Aditya Sales Intake' })).toBeVisible();
    await tenantAdminPage.pause(1200);

    // Demonstrate User Creation / Invite Flow (+ Add New User)
    const addUserBtn = page.locator('[data-testid="users.add-button"]');
    if (await addUserBtn.isVisible()) {
      await tenantAdminPage.showBanner(
        'Onboarding Frontline Staff User',
        'Inviting Aditya Nashik RM (nashikrm@adityfinserv.com) assigned to ROLE-RM',
      );
      await tenantAdminPage.click(addUserBtn, 1000);

      // Fill user creation form
      const nameInput = page.locator('[data-testid="users.create.displayName"] input').or(page.getByLabel('Full Name'));
      const emailInput = page.locator('[data-testid="users.create.email"] input').or(page.getByLabel('Work Email Address'));
      const mobileInput = page.locator('[data-testid="users.create.mobile"] input').or(page.getByLabel(/Mobile Number/i));
      const branchSelect = page.locator('[data-testid="users.create.branch"]');

      await tenantAdminPage.type(nameInput, 'Aditya Nashik RM');
      await tenantAdminPage.type(emailInput, 'nashikrm@adityfinserv.com');
      await tenantAdminPage.type(mobileInput, '+919820011223');

      // Select branch
      await tenantAdminPage.click(branchSelect, 600);
      await tenantAdminPage.click(page.getByRole('option', { name: /Mumbai Central/i }).first(), 600);

      // Check RM Role
      const rmCheckbox = page.locator('[data-testid="users.create.role.ROLE-RM"]');
      if (await rmCheckbox.isVisible()) {
        await rmCheckbox.check();
        await tenantAdminPage.pause(600);
      }

      // Submit user invitation
      const submitUserBtn = page.locator('[data-testid="users.create.submit"]');
      await tenantAdminPage.click(submitUserBtn, 1500);

      // Return to user list and verify invited user
      await tenantAdminPage.gotoUsers();
      await expect(page.getByRole('cell', { name: 'Aditya Nashik RM' }).first()).toBeVisible();
      await tenantAdminPage.pause(1200);
    }

    // Search filter demonstration
    const userSearch = page.getByPlaceholder(/Search name, email/i);
    if (await userSearch.isVisible()) {
      await tenantAdminPage.showBanner('Staff Search Filter', 'Filtering directory for Team Manager (Aditya Team Mgr)');
      await tenantAdminPage.type(userSearch, 'Team Mgr');
      await tenantAdminPage.pause(1200);
    }

    // Logout Stage 2
    await tenantAdminPage.showBanner('Signing Out Tenant Admin', 'Handing over to Organisation Executive Owner');
    await authPage.logout();
    await tenantAdminPage.pause(1200);

    // =======================================================================
    // STAGE 3: ORGANISATION OWNER (owner@adityfinserv.com / Admin@123)
    // Executive portfolio overview, monthly targets & connector agreements
    // =======================================================================
    await authPage.showBanner(
      'Stage 3: Organisation Owner',
      'Signing in as Aditya Owner (ROLE-ORG-OWNER) for executive business oversight',
    );
    await authPage.loginAs(ADITYA_PERSONAS.orgOwner, '/', STANDARD_PASSWORD);
    await orgOwnerPage.pause(1200);

    // Mock Connectors & Summary for Org Owner session
    await page.route('**/v1/connectors**', async (route) => {
      const url = route.request().url();
      if (url.includes('/summary')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            range: { from: null, to: null },
            connectors: {
              total: 1,
              byStatus: { DRAFT: 0, PENDING_VERIFICATION: 0, ACTIVE: 1, SUSPENDED: 0, TERMINATED: 0 },
            },
            referrals: { total: 1, pending: 0, converted: 1 },
            disputes: { attributionOpen: 0, partnerOpen: 0 },
            earnings: null,
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 'con_aditya_direct_01',
              code: 'CON-DIRECT-MUM',
              legalName: 'Direct Financial Connectors Ltd',
              contactPerson: 'Suresh Patel',
              connectorType: 'INSTITUTIONAL',
              status: 'ACTIVE',
              mobileE164: '+91 98112 23344',
              email: 'partner@directloans.in',
              panMasked: 'ABCDE••••F',
              commissionSlab: '1.0% on Disbursed Personal Loan Volume',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          total: 1,
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

    // Verify Executive Command Center / Portfolio Funnel
    await orgOwnerPage.showBanner(
      'Executive Business Command Center',
      'Reviewing high-level DSA portfolio funnel: Inbound Leads, Active Files & Disbursal Volume',
    );
    await expect(
      orgOwnerPage.commandCenterHeading
        .or(orgOwnerPage.pipelineFunnelHeading)
        .or(orgOwnerPage.leadsCrmHeading)
        .or(page.getByText('Organisation Owner Command Center')),
    ).toBeVisible();
    await orgOwnerPage.pause(1500);

    // Channel Partner & Strategic Connector Governance
    await orgOwnerPage.showBanner(
      'Strategic Channel Partners',
      'Reviewing Direct Financial Connectors Ltd (CON-DIRECT-MUM) commission slab (1.0% PL)',
    );
    await orgOwnerPage.gotoConnectors();
    await expect(page.getByText('Direct Financial Connectors Ltd').first()).toBeVisible();
    await expect(page.getByText('Suresh Patel').first()).toBeVisible();
    await orgOwnerPage.pause(1500);

    // Logout Stage 3
    await orgOwnerPage.showBanner('Signing Out Organisation Owner', 'Handing over to Frontline Sales Team Manager');
    await authPage.logout();
    await orgOwnerPage.pause(1200);

    // =======================================================================
    // STAGE 4: TEAM MANAGER (teammgr@adityfinserv.com / Admin@123)
    // Supervising MUM01 team queue, lead balancing & SLA follow-up tasks
    // =======================================================================
    await authPage.showBanner(
      'Stage 4: Team Manager',
      'Signing in as Aditya Team Mgr (ROLE-TEAM-MGR) for MUM01 branch supervision',
    );
    await authPage.loginAs(ADITYA_PERSONAS.teamMgr, '/', STANDARD_PASSWORD);
    await dashboardPage.pause(1200);

    // Re-bind Leads & Tasks for Team Manager session
    await page.route('**/v1/leads**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'led_aditya_inbound_01',
              fullName: 'Deepak Verma',
              mobileMasked: '+91 ••••• ••892',
              productCategory: 'PERSONAL_LOAN',
              state: 'NEW',
              branchId: 'MUM01',
              assignedUserId: null,
              indicativeAmount: { amount: '500000.00', currency: 'INR' },
              createdAt: new Date().toISOString(),
            },
          ],
          meta: { total: 1 },
        }),
      });
    });

    await page.route('**/v1/tasks**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'tsk_aditya_tm_001',
              title: 'Verify Initial Income Eligibility & Collect PAN',
              status: 'OPEN',
              priority: 'HIGH',
              type: 'DOCUMENT_COLLECTION',
              linkedType: 'LEAD',
              linkedId: 'led_aditya_inbound_01',
              branchId: 'MUM01',
              ownerUserId: ADITYA_PERSONAS.rm1.userId,
              dueAt: new Date(Date.now() + 86400000).toISOString(),
              lockVersion: 1,
              createdAt: new Date().toISOString(),
            },
          ],
          pagination: { nextCursor: null, hasMore: false },
        }),
      });
    });

    // Verify Team Management Hub
    await dashboardPage.showBanner(
      'Branch & Team Management Hub',
      'Supervising team task queues, SLA milestones and inbound leads for MUM01',
    );
    await expect(dashboardPage.dashboard).toBeVisible();
    await expect(dashboardPage.hubHeading).toBeVisible();
    await expect(page.getByText('Deepak Verma')).toBeVisible();
    await dashboardPage.pause(1500);

    // Inspect Team Tasks & SLA Milestone Dispatch
    await dashboardPage.showBanner(
      'Team Tasks & SLA Supervision',
      'Dispatching high-priority follow-up task to Aditya RM 1 for borrower Deepak Verma',
    );
    await tasksPage.gotoTasks();
    await expect(page.getByText('Verify Initial Income Eligibility & Collect PAN')).toBeVisible();
    await tasksPage.pause(1500);

    // Final Stage 4 Logout
    await tasksPage.showBanner(
      'Administrative & Team Setup Flow Complete!',
      'All 4 administrative stages successfully executed with unbroken audit logging',
    );
    await authPage.logout();
    await tasksPage.pause(2000);
  });
});
