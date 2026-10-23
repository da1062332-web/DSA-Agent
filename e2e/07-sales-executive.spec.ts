import { test, expect } from '@playwright/test';
import {
  PERSONAS,
  setupPersonaSession,
  performRoleLogin,
  performRoleLogout,
  pauseForDemo,
  humanType,
  humanClick,
  showDemoBanner,
} from './helpers/mock-session';

test.describe('Persona 07: Sales Executive (ROLE-SALES-EXEC)', () => {


  // =========================================================================
  // TC-SE-01: Field Outreach Lead Intake with proactive client-side field validation
  // (Notion QA Plan Module 07 Steps 1-2, SUB-LEAD.01, CMP-LEAD.01.1)
  // =========================================================================
  test('TC-SE-01: Field Outreach Lead Intake with proactive client-side field validation', async ({ page }) => {
    await page.route('**/v1/leads', async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'led_se_beta_001',
            fullName: body.fullName,
            mobileMasked: '+91 ••••• ••102',
            emailMasked: 'b***@example.com',
            productCategory: body.productCategory,
            state: 'NEW',
            branchId: body.branchId || 'MUM01',
            indicativeAmount: body.indicativeAmount,
            source: 'FIELD_OUTREACH',
            priority: 'MEDIUM',
            lockVersion: 1,
            createdAt: new Date().toISOString(),
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [], meta: { total: 0 } }),
        });
      }
    });

    await page.route('**/v1/leads/led_se_beta_001', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { ETag: 'W/"v1"' },
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'led_se_beta_001',
          fullName: 'Test Customer Beta',
          mobileMasked: '+91 ••••• ••102',
          emailMasked: 'beta.qa@example.com',
          pincode: '411002',
          productCategory: 'PERSONAL_LOAN',
          indicativeAmount: { amount: '200000.00', currency: 'INR' },
          priority: 'MEDIUM',
          state: 'NEW',
          branchId: 'MUM01',
          source: 'FIELD_OUTREACH',
          duplicateFlag: 'NONE',
          contactAttempts: 0,
          lockVersion: 1,
          createdAt: new Date().toISOString(),
        }),
      });
    });

    await performRoleLogin(page, PERSONAS.salesExec, '/leads/new');
    await showDemoBanner(page, 'Capturing Field Lead Intake', 'To capture prospective borrower details during field outreach');
    await pauseForDemo(page, 1500);

    // 1. Verify header
    await expect(page.locator('h1')).toContainText('Create New Lead');

    // 2. Validate empty submission error handling
    await showDemoBanner(page, 'Empty Submission Check', 'Triggering required field validation');
    const submitBtn = page.getByRole('button', { name: /Create Lead/i });
    await humanClick(submitBtn);
    await expect(page.getByText('Enter the full name (at least 2 characters).')).toBeVisible();
    await expect(page.getByText('Enter a mobile number.')).toBeVisible();
    await pauseForDemo(page, 1500);

    // 3. Validate invalid mobile number
    await showDemoBanner(page, 'Mobile Number Validation', 'Entering invalid mobile "55555"');
    const mobileInput = page.locator('input[data-testid="lead-form.mobile"]');
    await humanType(mobileInput, '55555');
    await humanClick(submitBtn);
    await expect(
      page.getByText('Enter a 10-digit mobile number starting with 6, 7, 8 or 9.'),
    ).toBeVisible();
    await pauseForDemo(page, 1500);

    // 4. Validate invalid pincode
    await showDemoBanner(page, 'Pincode Validation', 'Entering invalid pincode "012345"');
    const pincodeInput = page.locator('input[data-testid="lead-form.pincode"]');
    await humanType(pincodeInput, '012345');
    await humanClick(submitBtn);
    await expect(page.getByText('Enter a 6-digit pincode that does not start with 0.')).toBeVisible();
    await pauseForDemo(page, 1500);

    // 5. Fill Notion QA Test Data
    await showDemoBanner(page, 'Fill Lead Details', 'Entering synthetic data for Test Customer Beta');
    await humanType(page.locator('input[data-testid="lead-form.fullName"]'), 'Test Customer Beta');
    await humanType(mobileInput, '9000000102');
    await humanType(page.locator('input[data-testid="lead-form.email"]'), 'beta.qa@example.com');
    await humanType(pincodeInput, '411002');
    await humanType(page.locator('input[data-testid="lead-form.amount"]'), '200000');
    await pauseForDemo(page, 1500);

    // Submit lead
    await showDemoBanner(page, 'Submit Lead Intake', 'Saving lead with source FIELD_OUTREACH');
    await humanClick(submitBtn, 2500);

    // Verify redirection to lead detail page in state NEW
    await expect(page).toHaveURL(/\/leads\/led_se_beta_001/);
    await showDemoBanner(page, 'Lead Created Successfully', 'State: NEW with masked mobile +91 ••••• ••102');
    await expect(page.locator('h1')).toContainText('Test Customer Beta');
    await expect(page.getByText('NEW', { exact: true })).toBeVisible();
    await pauseForDemo(page, 2500);
    await performRoleLogout(page);
  });

  // =========================================================================
  // TC-SE-02: Lead Activity Logging & Follow-up Task Assignment
  // (Notion QA Plan Module 07 Steps 3-5, MOD-ACT, MOD-TASK)
  // =========================================================================
  test('TC-SE-02: Lead Activity Logging & Follow-up Task Assignment', async ({ page }) => {
    const leadId = 'led_se_beta_001';
    let activities: any[] = [];
    let tasks: any[] = [];

    await page.route(`**/v1/leads/${leadId}`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { ETag: 'W/"v1"' },
        contentType: 'application/json',
        body: JSON.stringify({
          id: leadId,
          fullName: 'Test Customer Beta',
          mobileMasked: '+91 ••••• ••102',
          emailMasked: 'beta.qa@example.com',
          pincode: '411002',
          productCategory: 'PERSONAL_LOAN',
          indicativeAmount: { amount: '200000.00', currency: 'INR' },
          priority: 'MEDIUM',
          state: 'NEW',
          branchId: 'MUM01',
          source: 'FIELD_OUTREACH',
          duplicateFlag: 'NONE',
          contactAttempts: 0,
          lockVersion: 1,
          createdAt: new Date().toISOString(),
        }),
      });
    });

    await page.route('**/v1/timeline**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: activities }),
      });
    });

    await page.route('**/v1/activities**', async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        const newAct = {
          id: 'act_001',
          tenantId: 'ten_alpha',
          kind: body.kind || 'CALL',
          subjectType: 'LEAD',
          subjectId: leadId,
          outcomeCode: body.outcomeCode || 'CONNECTED',
          occurredAt: new Date().toISOString(),
          note: body.note || 'Discussed loan terms',
          createdBy: 'usr_sales_01',
          createdAt: new Date().toISOString(),
        };
        activities.push(newAct);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(newAct),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: activities }),
        });
      }
    });

    await page.route('**/v1/tasks**', async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        const newTask = {
          id: 'tsk_001',
          tenantId: 'ten_alpha',
          title: body.title || 'Collect bank statement',
          type: body.type || 'FOLLOW_UP',
          priority: body.priority || 'HIGH',
          status: 'OPEN',
          linkedType: 'LEAD',
          linkedId: leadId,
          branchId: 'MUM01',
          ownerUserId: 'usr_sales_01',
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          lockVersion: 1,
          createdAt: new Date().toISOString(),
        };
        tasks.push(newTask);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(newTask),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: tasks, pagination: { nextCursor: null, hasMore: false } }),
        });
      }
    });

    await performRoleLogin(page, PERSONAS.salesExec, `/leads/${leadId}`);
    await showDemoBanner(page, 'Logging Field Follow-up & Tasks', 'To record call outcomes and schedule document collection tasks');
    await pauseForDemo(page, 1500);

    // 1. Verify Follow-ups card loaded
    await showDemoBanner(page, 'Follow-up Panel', 'Inspecting communication history and tasks');
    await expect(page.locator('[data-testid="lead.follow-ups"]')).toBeVisible();

    // 2. Open Log Activity Dialog
    await showDemoBanner(page, 'Log Call Activity', 'Recording contact attempt outcome');
    const logActivityBtn = page.locator('[data-testid="lead.log-activity"]');
    await expect(logActivityBtn).toBeVisible();
    await humanClick(logActivityBtn, 1500);

    // Submit activity
    await showDemoBanner(page, 'Submit Activity', 'Outcome: CONNECTED — Discussed loan terms');
    const submitActBtn = page.locator('[data-testid="activity.log-form.submit"]');
    await humanClick(submitActBtn, 2000);

    // Verify activity entry rendered
    await showDemoBanner(page, 'Timeline Updated', 'Logged call event rendered in timeline');
    await expect(page.getByText('connected', { exact: false })).toBeVisible();
    await pauseForDemo(page, 1500);

    // 3. Open Add Task Dialog
    await showDemoBanner(page, 'Create Follow-up Task', 'Opening follow-up task modal');
    const addTaskBtn = page.locator('[data-testid="lead.add-task"]');
    await expect(addTaskBtn).toBeVisible();
    await humanClick(addTaskBtn, 1500);

    // Fill task title
    await showDemoBanner(page, 'Task Title Entry', 'Scheduling: Collect 6-month bank statement');
    const titleInput = page.locator('input[data-testid="tasks.create.title"]');
    await humanType(titleInput, 'Collect 6-month bank statement');
    await pauseForDemo(page, 1500);

    // Submit task
    await showDemoBanner(page, 'Submit Task', 'Assigning task to sales executive queue');
    const submitTaskBtn = page.locator('[data-testid="tasks.create.submit"]');
    await humanClick(submitTaskBtn, 2000);

    // Verify task entry rendered
    await showDemoBanner(page, 'Task Assigned', 'Collect 6-month bank statement added to tasks list');
    await expect(page.getByText('Collect 6-month bank statement')).toBeVisible();
    await pauseForDemo(page, 2500);
    await performRoleLogout(page);
  });

  // =========================================================================
  // TC-SE-03: Segregation of Duties (SoD) & Access Control Enforcement
  // (Notion QA Plan Module 07 Steps 6-7: Denies Reassignment, Conversion & Admin Modules)
  // =========================================================================
  test('TC-SE-03: Segregation of Duties (SoD) & Access Control Enforcement', async ({ page }) => {
    const leadId = 'led_se_beta_001';

    await page.route(`**/v1/leads/${leadId}`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { ETag: 'W/"v1"' },
        contentType: 'application/json',
        body: JSON.stringify({
          id: leadId,
          fullName: 'Test Customer Beta',
          mobileMasked: '+91 ••••• ••102',
          emailMasked: 'beta.qa@example.com',
          pincode: '411002',
          productCategory: 'PERSONAL_LOAN',
          indicativeAmount: { amount: '200000.00', currency: 'INR' },
          priority: 'MEDIUM',
          state: 'NEW',
          branchId: 'MUM01',
          source: 'FIELD_OUTREACH',
          duplicateFlag: 'NONE',
          contactAttempts: 0,
          lockVersion: 1,
          createdAt: new Date().toISOString(),
        }),
      });
    });

    await performRoleLogin(page, PERSONAS.salesExec, `/leads/${leadId}`);
    await showDemoBanner(page, 'Enforcing Role Boundaries & SoD', 'To confirm Sales Executives cannot reassign leads, convert applications, or view audits');
    await pauseForDemo(page, 1500);

    // 1. SoD Boundary Verification: Sales Executive lacks `lead.assign`
    await showDemoBanner(page, 'Lead Reassignment Restricted', 'Verifying lead reassign action is restricted to managers');
    const assignBtn = page.locator('[data-testid="lead.action.assign"]');
    await expect(assignBtn).not.toBeVisible();

    // 2. SoD Boundary Verification: Sales Executive lacks `application.create`
    await showDemoBanner(page, 'Application Conversion Restricted', 'Verifying loan application conversion requires RM role');
    const convertBtn = page.locator('[data-testid="lead.action.convert"]');
    await expect(convertBtn).not.toBeVisible();
    await pauseForDemo(page, 1500);

    // 3. Route Guard Verification: Access to restricted financial/audit modules blocked
    await showDemoBanner(page, 'Route Guard: Commission', 'Navigating to /commission (Expect 403 Forbidden)');
    await page.goto('/commission');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await pauseForDemo(page, 1500);

    await showDemoBanner(page, 'Route Guard: Audit Trail', 'Navigating to /audit (Expect 403 Forbidden)');
    await page.goto('/audit');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await showDemoBanner(page, 'Role Boundaries Enforced', 'All operational and route boundaries strictly verified');
    await pauseForDemo(page, 2000);
    await performRoleLogout(page);
  });
});
