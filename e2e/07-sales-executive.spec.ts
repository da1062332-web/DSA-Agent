import { test, expect } from '@playwright/test';
import { PERSONAS } from './helpers/mock-session';
import { AuthPage, LeadPage } from './pages';

test.describe('Persona 07: Sales Executive (ROLE-SALES-EXEC)', () => {

  // =========================================================================
  // TC-SE-01: Field Outreach Lead Intake with proactive client-side field validation
  // (Notion QA Plan Module 07 Steps 1-2, SUB-LEAD.01, CMP-LEAD.01.1)
  // =========================================================================
  test('TC-SE-01: Field Outreach Lead Intake with proactive client-side field validation', async ({ page }) => {
    const authPage = new AuthPage(page);
    const leadPage = new LeadPage(page);

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

    await authPage.loginAs(PERSONAS.salesExec, '/leads/new');
    await leadPage.showBanner('Capturing Field Lead Intake', 'To capture prospective borrower details during field outreach');
    await leadPage.pause(1500);

    // 1. Verify header
    await expect(leadPage.heading).toContainText('Create New Lead');

    // 2. Validate empty submission error handling
    await leadPage.showBanner('Empty Submission Check', 'Triggering required field validation');
    await leadPage.click(leadPage.submitLeadBtn);
    await expect(page.getByText('Enter the full name (at least 2 characters).')).toBeVisible();
    await expect(page.getByText('Enter a mobile number.')).toBeVisible();
    await leadPage.pause(1500);

    // 3. Validate invalid mobile number
    await leadPage.showBanner('Mobile Number Validation', 'Entering invalid mobile "55555"');
    await leadPage.type(leadPage.mobileInput, '55555');
    await leadPage.click(leadPage.submitLeadBtn);
    await expect(
      page.getByText('Enter a 10-digit mobile number starting with 6, 7, 8 or 9.'),
    ).toBeVisible();
    await leadPage.pause(1500);

    // 4. Validate invalid pincode
    await leadPage.showBanner('Pincode Validation', 'Entering invalid pincode "012345"');
    await leadPage.type(leadPage.pincodeInput, '012345');
    await leadPage.click(leadPage.submitLeadBtn);
    await expect(page.getByText('Enter a 6-digit pincode that does not start with 0.')).toBeVisible();
    await leadPage.pause(1500);

    // 5. Fill Notion QA Test Data
    await leadPage.showBanner('Fill Lead Details', 'Entering synthetic data for Test Customer Beta');
    await leadPage.fillLeadForm({
      fullName: 'Test Customer Beta',
      mobile: '9000000102',
      email: 'beta.qa@example.com',
      pincode: '411002',
      amount: '200000',
    });
    await leadPage.pause(1500);

    // Submit lead
    await leadPage.showBanner('Submit Lead Intake', 'Saving lead with source FIELD_OUTREACH');
    await leadPage.submitLead(2500);

    // Verify redirection to lead detail page in state NEW
    await expect(page).toHaveURL(/\/leads\/led_se_beta_001/);
    await leadPage.showBanner('Lead Created Successfully', 'State: NEW with masked mobile +91 ••••• ••102');
    await expect(leadPage.heading).toContainText('Test Customer Beta');
    await expect(page.getByText('NEW', { exact: true })).toBeVisible();
    await leadPage.pause(2500);
    await authPage.logout();
  });

  // =========================================================================
  // TC-SE-02: Lead Activity Logging & Follow-up Task Assignment
  // (Notion QA Plan Module 07 Steps 3-5, MOD-ACT, MOD-TASK)
  // =========================================================================
  test('TC-SE-02: Lead Activity Logging & Follow-up Task Assignment', async ({ page }) => {
    const authPage = new AuthPage(page);
    const leadPage = new LeadPage(page);
    const leadId = 'led_se_beta_001';
    const activities: any[] = [];
    const tasks: any[] = [];

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

    await authPage.loginAs(PERSONAS.salesExec, `/leads/${leadId}`);
    await leadPage.showBanner('Logging Field Follow-up & Tasks', 'To record call outcomes and schedule document collection tasks');
    await leadPage.pause(1500);

    // 1. Verify Follow-ups card loaded
    await leadPage.showBanner('Follow-up Panel', 'Inspecting communication history and tasks');
    await expect(leadPage.followUpsCard).toBeVisible();

    // 2. Log Call Activity
    await leadPage.showBanner('Log Call Activity', 'Recording contact attempt outcome');
    await leadPage.showBanner('Submit Activity', 'Outcome: CONNECTED — Discussed loan terms');
    await leadPage.logActivity();

    // Verify activity entry rendered
    await leadPage.showBanner('Timeline Updated', 'Logged call event rendered in timeline');
    await expect(page.getByText('connected', { exact: false })).toBeVisible();
    await leadPage.pause(1500);

    // 3. Create Follow-up Task
    await leadPage.showBanner('Create Follow-up Task', 'Opening follow-up task modal');
    await leadPage.showBanner('Task Title Entry', 'Scheduling: Collect 6-month bank statement');
    await leadPage.showBanner('Submit Task', 'Assigning task to sales executive queue');
    await leadPage.addTask('Collect 6-month bank statement');

    // Verify task entry rendered
    await leadPage.showBanner('Task Assigned', 'Collect 6-month bank statement added to tasks list');
    await expect(page.getByText('Collect 6-month bank statement')).toBeVisible();
    await leadPage.pause(2500);
    await authPage.logout();
  });

  // =========================================================================
  // TC-SE-03: Segregation of Duties (SoD) & Access Control Enforcement
  // (Notion QA Plan Module 07 Steps 6-7: Denies Reassignment, Conversion & Admin Modules)
  // =========================================================================
  test('TC-SE-03: Segregation of Duties (SoD) & Access Control Enforcement', async ({ page }) => {
    const authPage = new AuthPage(page);
    const leadPage = new LeadPage(page);
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

    await authPage.loginAs(PERSONAS.salesExec, `/leads/${leadId}`);
    await leadPage.showBanner('Enforcing Role Boundaries & SoD', 'To confirm Sales Executives cannot reassign leads, convert applications, or view audits');
    await leadPage.pause(1500);

    // 1. SoD Boundary Verification: Sales Executive lacks `lead.assign`
    await leadPage.showBanner('Lead Reassignment Restricted', 'Verifying lead reassign action is restricted to managers');
    await expect(leadPage.assignBtn).not.toBeVisible();

    // 2. SoD Boundary Verification: Sales Executive lacks `application.create`
    await leadPage.showBanner('Application Conversion Restricted', 'Verifying loan application conversion requires RM role');
    await expect(leadPage.convertBtn).not.toBeVisible();
    await leadPage.pause(1500);

    // 3. Route Guard Verification: Access to restricted financial/audit modules blocked
    await leadPage.showBanner('Route Guard: Commission', 'Navigating to /commission (Expect 403 Forbidden)');
    await leadPage.goto('/commission');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await leadPage.pause(1500);

    await leadPage.showBanner('Route Guard: Audit Trail', 'Navigating to /audit (Expect 403 Forbidden)');
    await leadPage.goto('/audit');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await leadPage.showBanner('Role Boundaries Enforced', 'All operational and route boundaries strictly verified');
    await leadPage.pause(2000);
    await authPage.logout();
  });
});
