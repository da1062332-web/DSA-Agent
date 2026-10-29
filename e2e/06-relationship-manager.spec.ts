import { test, expect } from '@playwright/test';
import { PERSONAS, apiErrorBody } from './helpers/mock-session';
import { AuthPage, LeadPage, CustomerConsentPage, ApplicationPage } from './pages';

test.describe('Persona 06: Relationship Manager (ROLE-RM)', () => {

  // =========================================================================
  // TC-RM-01: Lead Intake with proactive client-side field validation & creation
  // (Notion: Module 06 Steps 1-3, SUB-LEAD.01, CMP-LEAD.01.1, ENT-020)
  // =========================================================================
  test('TC-RM-01: Lead Intake with proactive client-side field validation & creation', async ({ page }) => {
    const authPage = new AuthPage(page);
    const leadPage = new LeadPage(page);

    // Mock lead creation endpoint
    await page.route('**/v1/leads', async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'led_test_alpha_001',
            fullName: body.fullName,
            mobileMasked: '+91 ••••• ••101',
            emailMasked: 'a***@example.com',
            productCategory: body.productCategory,
            state: 'NEW',
            branchId: body.branchId || 'MUM01',
            indicativeAmount: body.indicativeAmount,
            duplicateFlag: 'NONE',
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

    // Mock individual lead fetch for redirect
    await page.route('**/v1/leads/led_test_alpha_001', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { ETag: 'W/"v1"' },
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'led_test_alpha_001',
          fullName: 'Test Customer Alpha',
          mobileMasked: '+91 ••••• ••101',
          emailMasked: 'alpha.qa@example.com',
          pincode: '411001',
          productCategory: 'PERSONAL_LOAN',
          indicativeAmount: { amount: '300000.00', currency: 'INR' },
          priority: 'HIGH',
          state: 'NEW',
          branchId: 'MUM01',
          source: 'RM_MANUAL',
          duplicateFlag: 'NONE',
          contactAttempts: 0,
          lockVersion: 1,
          createdAt: new Date().toISOString(),
        }),
      });
    });

    await authPage.loginAs(PERSONAS.rm, '/leads/new');
    await leadPage.showBanner('Opening Lead Intake Form', 'To capture applicant details with proactive field validation');
    await leadPage.pause(1200);

    // 1. Check page title and subtitle
    await expect(leadPage.heading).toContainText('Create New Lead');

    // 2. Test empty submission validation
    await leadPage.showBanner('Empty Submission Check', 'Triggering required field validation');
    await leadPage.click(leadPage.submitLeadBtn);

    // Verify inline field validation errors
    await expect(page.getByText('Enter the full name (at least 2 characters).')).toBeVisible();
    await expect(page.getByText('Enter a mobile number.')).toBeVisible();
    await leadPage.pause(1500);

    // 3. Test invalid mobile number validation (must be 10 digits starting 6, 7, 8, or 9)
    await leadPage.showBanner('Mobile Number Validation', 'Entering invalid mobile "12345"');
    await leadPage.type(leadPage.mobileInput, '12345');
    await leadPage.click(leadPage.submitLeadBtn);
    await expect(page.getByText('Enter a 10-digit mobile number starting with 6, 7, 8 or 9.')).toBeVisible();
    await leadPage.pause(1500);

    // 4. Test invalid email format validation
    await leadPage.showBanner('Email Format Validation', 'Entering invalid email "invalid-email"');
    await leadPage.type(leadPage.emailInput, 'invalid-email');
    await leadPage.click(leadPage.submitLeadBtn);
    await expect(page.getByText('Enter a valid email address, or leave it blank.')).toBeVisible();
    await leadPage.pause(1500);

    // 5. Test invalid pincode validation (6 digits, non-zero starting)
    await leadPage.showBanner('Pincode Validation', 'Entering invalid pincode "012345" (must not start with 0)');
    await leadPage.type(leadPage.pincodeInput, '012345');
    await leadPage.click(leadPage.submitLeadBtn);
    await expect(page.getByText('Enter a 6-digit pincode that does not start with 0.')).toBeVisible();
    await leadPage.pause(1500);

    // 6. Test invalid amount (zero or negative)
    await leadPage.showBanner('Loan Amount Validation', 'Entering zero amount "0"');
    await leadPage.type(leadPage.amountInput, '0');
    await leadPage.click(leadPage.submitLeadBtn);
    await expect(page.getByText(/Enter an amount greater than zero/i)).toBeVisible();
    await leadPage.pause(1500);

    // 7. Fill valid Notion QA test data
    await leadPage.showBanner('Submitting Valid Lead', 'Filling synthetic data for Test Customer Alpha');
    await leadPage.fillLeadForm({
      fullName: 'Test Customer Alpha',
      mobile: '9000000101',
      email: 'alpha.qa@example.com',
      pincode: '411001',
      amount: '300000',
    });
    await leadPage.pause(1200);

    // Submit valid lead intake form
    await leadPage.click(leadPage.submitLeadBtn);

    // Verify redirection to lead detail page with newly created lead in state NEW
    await expect(page).toHaveURL(/\/leads\/led_test_alpha_001/);
    await leadPage.showBanner('Lead Created Successfully', 'State: NEW with masked mobile +91 ••••• ••101');
    await expect(leadPage.heading).toContainText('Test Customer Alpha');
    await expect(page.getByText('NEW', { exact: true })).toBeVisible();
    await leadPage.pause(1800);
    await authPage.logout();
  });

  // =========================================================================
  // TC-RM-02: Lead Duplicate Detection & Classification Surfacing
  // (Notion: Module 06 Step 4, SUB-LEAD.04, ENT-020 duplicate_flag)
  // =========================================================================
  test('TC-RM-02: Lead Duplicate Detection & Classification Surfacing', async ({ page }) => {
    const authPage = new AuthPage(page);
    const leadPage = new LeadPage(page);

    const mockDuplicateLead = {
      id: 'led_dup_alpha_002',
      fullName: 'Test Customer Alpha (Duplicate)',
      mobileMasked: '+91 ••••• ••101',
      emailMasked: 'alpha.qa@example.com',
      pincode: '411001',
      productCategory: 'PERSONAL_LOAN',
      indicativeAmount: { amount: '300000.00', currency: 'INR' },
      priority: 'MEDIUM',
      state: 'NEW',
      branchId: 'MUM01',
      source: 'RM_MANUAL',
      duplicateFlag: 'POSSIBLE',
      duplicateCandidateIds: ['led_existing_099'],
      contactAttempts: 0,
      lockVersion: 1,
      createdAt: new Date().toISOString(),
    };

    await page.route('**/v1/leads/led_dup_alpha_002', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { ETag: 'W/"v1"' },
        contentType: 'application/json',
        body: JSON.stringify(mockDuplicateLead),
      });
    });

    await page.route('**/v1/leads/led_existing_099', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'led_existing_099',
          fullName: 'Existing Master Customer',
          mobileMasked: '+91 ••••• ••101',
          state: 'QUALIFIED',
          createdAt: new Date().toISOString(),
        }),
      });
    });

    await authPage.loginAs(PERSONAS.rm, '/leads/led_dup_alpha_002');
    await leadPage.showBanner('Checking for Duplicate Leads', 'To prevent redundant entries and protect CRM data integrity');
    await leadPage.pause(1200);

    // 1. Verify lead loaded
    await expect(leadPage.heading).toContainText('Test Customer Alpha (Duplicate)');

    // 2. Verify duplicate flag badge rendered prominently
    await leadPage.showBanner('Duplicate Badge Surfaced', 'Badge displays "Duplicate: POSSIBLE"');
    const dupBadge = page.locator('[data-testid="lead.duplicate-flag"]');
    await expect(dupBadge).toBeVisible();
    await expect(dupBadge).toContainText('Duplicate: POSSIBLE');
    await leadPage.pause(1500);

    // 3. Verify duplicate candidate link is surfaced for merge review
    await leadPage.showBanner('Duplicate Candidate Link', 'Candidate led_existing_099 surfaced for merge review');
    const dupCandidates = page.locator('[data-testid="lead.duplicate-candidates"]');
    await expect(dupCandidates).toBeVisible();
    await expect(dupCandidates).toContainText('led_existing_099');
    await leadPage.pause(1800);
    await authPage.logout();
  });

  // =========================================================================
  // TC-RM-03: Lead Lifecycle Tracking — Contact Attempt (T-LEAD-01) & In Progress (T-LEAD-02)
  // (Notion: Module 06 Step 5, SUB-LEAD.06, T-LEAD-01, T-LEAD-02)
  // =========================================================================
  test('TC-RM-03: Lead Lifecycle Tracking — Contact Attempt (T-LEAD-01) & In Progress (T-LEAD-02)', async ({
    page,
  }) => {
    const authPage = new AuthPage(page);
    const leadPage = new LeadPage(page);

    const mockLead = {
      id: 'led_lifecycle_001',
      fullName: 'Vikram Joshi',
      mobileMasked: '+91 ••••• ••456',
      emailMasked: 'vikram.j@example.com',
      pincode: '400050',
      productCategory: 'HOME_LOAN',
      indicativeAmount: { amount: '4500000.00', currency: 'INR' },
      priority: 'HIGH',
      state: 'NEW',
      branchId: 'MUM01',
      source: 'WALK_IN',
      duplicateFlag: 'NONE',
      contactAttempts: 0,
      lockVersion: 1,
      createdAt: new Date().toISOString(),
    };

    await page.route('**/v1/leads/led_lifecycle_001', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { ETag: `W/"v${mockLead.lockVersion}"` },
        contentType: 'application/json',
        body: JSON.stringify(mockLead),
      });
    });

    // Mock lifecycle transitions
    await page.route('**/v1/leads/led_lifecycle_001/transitions', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.transitionCode === 'T-LEAD-01') {
        mockLead.state = 'CONTACT_ATTEMPTED';
        mockLead.contactAttempts = 1;
        mockLead.lockVersion = 2;
      } else if (body.transitionCode === 'T-LEAD-02') {
        mockLead.state = 'IN_PROGRESS';
        mockLead.lockVersion = 3;
      }
      await route.fulfill({
        status: 200,
        headers: { ETag: `W/"v${mockLead.lockVersion}"` },
        contentType: 'application/json',
        body: JSON.stringify(mockLead),
      });
    });

    await authPage.loginAs(PERSONAS.rm, '/leads/led_lifecycle_001');
    await leadPage.showBanner('Advancing Lead Lifecycle State', 'To record applicant communication outcomes and loan qualification');
    await leadPage.pause(1200);

    // Verify initial lead in state NEW
    await expect(leadPage.heading).toContainText('Vikram Joshi');
    await expect(page.getByText('NEW', { exact: true })).toBeVisible();
    await leadPage.pause(1200);

    // 1. Trigger T-LEAD-01: Contact Attempted
    await leadPage.showBanner('Attempting Customer Contact', 'To register outreach attempts towards the borrower');
    await leadPage.attemptContact();

    // Verify state transitioned to CONTACT_ATTEMPTED
    await leadPage.showBanner('State: CONTACT_ATTEMPTED', 'Contact attempt registered on lead');
    await expect(page.getByText('Lead status updated.')).toBeVisible();
    await expect(page.getByText('CONTACT_ATTEMPTED', { exact: true })).toBeVisible();
    await leadPage.pause(1500);

    // 2. Trigger T-LEAD-02: Mark In Progress
    await leadPage.showBanner('Advancing Lead to In-Progress', 'To indicate borrower interest and begin loan discussions');
    await leadPage.markInProgress();

    // Verify state transitioned to IN_PROGRESS
    await leadPage.showBanner('State: IN_PROGRESS', 'Lead is now in active progress');
    await expect(page.getByText('Lead status updated.')).toBeVisible();
    await expect(page.getByText('IN_PROGRESS', { exact: true })).toBeVisible();
    await leadPage.pause(1800);
    await authPage.logout();
  });

  // =========================================================================
  // TC-RM-04: Lead Qualification (T-LEAD-04) & Atomic Conversion to Loan Application
  // (Notion: Module 06 Steps 5 & 6, SUB-LEAD.06, SUB-LEAD.09, API-LEAD-007)
  // =========================================================================
  test('TC-RM-04: Lead Qualification (T-LEAD-04) & Atomic Conversion to Loan Application', async ({
    page,
  }) => {
    const authPage = new AuthPage(page);
    const leadPage = new LeadPage(page);

    const mockLead = {
      id: 'led_qual_alpha_001',
      fullName: 'Test Customer Alpha',
      mobileMasked: '+91 ••••• ••101',
      emailMasked: 'alpha.qa@example.com',
      pincode: '411001',
      productCategory: 'PERSONAL_LOAN',
      indicativeAmount: { amount: '300000.00', currency: 'INR' },
      priority: 'HIGH',
      state: 'IN_PROGRESS',
      branchId: 'MUM01',
      source: 'RM_MANUAL',
      duplicateFlag: 'NONE',
      contactAttempts: 2,
      lockVersion: 3,
      createdAt: new Date().toISOString(),
    };

    await page.route('**/v1/leads/led_qual_alpha_001', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { ETag: `W/"v${mockLead.lockVersion}"` },
        contentType: 'application/json',
        body: JSON.stringify(mockLead),
      });
    });

    // Mock transition to QUALIFIED
    await page.route('**/v1/leads/led_qual_alpha_001/transitions', async (route) => {
      mockLead.state = 'QUALIFIED';
      mockLead.lockVersion = 4;
      await route.fulfill({
        status: 200,
        headers: { ETag: 'W/"v4"' },
        contentType: 'application/json',
        body: JSON.stringify(mockLead),
      });
    });

    // Mock atomic conversion to Loan Application
    await page.route('**/v1/leads/led_qual_alpha_001/conversion', async (route) => {
      mockLead.state = 'CONVERTED';
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          applicationId: 'app_loan_alpha_001',
          customerId: 'cus_alpha_001',
          leadId: 'led_qual_alpha_001',
        }),
      });
    });

    await authPage.loginAs(PERSONAS.rm, '/leads/led_qual_alpha_001');
    await leadPage.showBanner('Qualifying & Converting Lead', 'To approve loan terms and generate official customer & application records');
    await leadPage.pause(1200);

    // 1. Open Qualify Dialog (T-LEAD-04)
    await expect(leadPage.qualifyBtn).toBeVisible();
    await leadPage.openQualifyDialog();

    // 2. Validate empty amount check
    await leadPage.showBanner('Qualify Form Validation', 'Testing empty loan amount check');
    await expect(leadPage.qualifyAmountField).toBeVisible();
    await leadPage.qualifyAmountField.clear();
    await leadPage.qualifyAmountField.fill('');
    await expect(leadPage.qualifyAmountField).toHaveValue('');

    await leadPage.click(leadPage.submitQualifyBtn);
    await expect(page.getByText('Enter a valid loan amount greater than zero.')).toBeVisible();
    await leadPage.pause(1500);

    // Fill valid qualification data: amount and monthly income, then submit
    await leadPage.showBanner('Submitting Qualification', 'Income ₹75,000, Requested amount ₹3,00,000');
    await leadPage.submitQualification('300000', '75000');

    // 3. Confirm transition to QUALIFIED
    await leadPage.showBanner('State: QUALIFIED', 'Lead successfully qualified');
    await expect(page.getByText('Lead lifecycle state updated successfully.')).toBeVisible();
    await expect(page.getByText('QUALIFIED', { exact: true })).toBeVisible();
    await leadPage.pause(1500);

    // 4. Execute Atomic Conversion to Loan Application (SUB-LEAD.09)
    await leadPage.showBanner('Atomic Conversion', 'Converting lead to Customer & Loan Application');
    await expect(leadPage.convertBtn).toBeVisible();
    await leadPage.convertLead();

    // 5. Verify Atomic Conversion Result: Application & Customer entities created
    await leadPage.showBanner('Conversion Complete', 'Generated Application & Customer records');
    await expect(page.getByRole('heading', { name: 'Lead Converted Successfully' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'app_loan_alpha_001' })).toBeVisible();
    await expect(page.getByText('cus_alpha_001', { exact: true })).toBeVisible();

    // Verify navigation link to DPDP Consents is displayed
    const consentsLink = page.getByRole('link', { name: /Manage Customer DPDP Consents/i });
    await expect(consentsLink).toBeVisible();
    await leadPage.pause(2000);
    await authPage.logout();
  });

  // =========================================================================
  // TC-RM-05: DPDP Act Compliance & Customer Consent Recording and Revocation
  // (Notion: Module 06 Step 7, consent.record, MOD-PRV, ENT-028)
  // =========================================================================
  test('TC-RM-05: DPDP Act Compliance & Customer Consent Recording and Revocation', async ({ page }) => {
    const authPage = new AuthPage(page);
    const consentPage = new CustomerConsentPage(page);

    const customerId = 'cus_alpha_001';
    const mockCustomer = {
      id: customerId,
      tenantId: 'ten_alpha',
      partyType: 'INDIVIDUAL',
      fullName: 'Test Customer Alpha',
      homeBranchId: 'MUM01',
      status: 'ACTIVE',
      lockVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const consentsList: any[] = [];

    await page.route(`**/v1/customers/${customerId}`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { ETag: 'W/"v1"' },
        contentType: 'application/json',
        body: JSON.stringify(mockCustomer),
      });
    });

    await page.route(`**/v1/customers/${customerId}/consents`, async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        const newConsent = {
          id: 'cst_dpdp_001',
          tenantId: 'ten_alpha',
          subjectType: 'CUSTOMER',
          subjectId: customerId,
          purpose: body.purpose || 'LOAN_PROCESSING',
          purposeTarget: body.purposeTarget || null,
          noticeVersion: body.noticeVersion || 'QA-CONSENT-V1',
          channel: body.channel || 'WEB_FORM',
          evidenceRef: body.evidenceRef || 'DOC-SIGNED-001',
          capturedBy: 'usr_rm_01',
          capturedAt: new Date().toISOString(),
          status: 'ACTIVE',
          withdrawnAt: null,
          withdrawnBy: null,
          withdrawalReason: null,
          expiresAt: null,
          createdAt: new Date().toISOString(),
        };
        consentsList.push(newConsent);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(newConsent),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: consentsList }),
        });
      }
    });

    await page.route('**/v1/consents/cst_dpdp_001/withdrawal', async (route) => {
      if (consentsList[0]) {
        consentsList[0].status = 'WITHDRAWN';
        consentsList[0].withdrawnAt = new Date().toISOString();
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'cst_dpdp_001', status: 'WITHDRAWN' }),
      });
    });

    await authPage.loginAs(PERSONAS.rm, `/customers/${customerId}/consents`);
    await consentPage.showBanner('Managing DPDP Customer Consents', 'To ensure regulatory compliance for data processing under the DPDP Act');
    await consentPage.pause(1200);

    // 1. Verify customer header and profile details
    await expect(page.getByRole('heading', { name: 'Customer Consent Management' })).toBeVisible();
    await expect(page.getByText('Test Customer Alpha')).toBeVisible();

    // 2. Open "+ Record New Consent" dialog and fill details
    await consentPage.showBanner('Recording Consent', 'Opening + Record New Consent dialog');
    await consentPage.recordConsent('QA-CONSENT-V1', 'DOC-SIGNED-001');

    // 3. Verify consent record rendered in active table
    await consentPage.showBanner('Consent Recorded: ACTIVE', 'Status confirmed ACTIVE in consent table');
    await expect(page.getByRole('cell', { name: 'CONTACT' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'QA-CONSENT-V1' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'ACTIVE' })).toBeVisible();
    await consentPage.pause(1500);

    // 4. Test Revocation / Withdrawal (Right to Withdraw under DPDP Act)
    await consentPage.showBanner('Exercising Right to Withdraw', 'Clicking Withdraw to revoke consent');
    await expect(consentPage.withdrawBtn).toBeVisible();
    await consentPage.withdrawConsent();

    // Verify status updated to WITHDRAWN / Revoked
    await consentPage.showBanner('Consent Withdrawal', 'Customer exercised Right to Withdraw');
    await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
    await consentPage.pause(1800);
    await authPage.logout();
  });

  // =========================================================================
  // TC-RM-06: Segregation of Duties (SoD) & Access Control Enforcement
  // (Notion: SoD Dual Control, SOD-01 to SOD-05, Restricted Permissions)
  // =========================================================================
  test('TC-RM-06: Segregation of Duties (SoD) & Access Control Enforcement', async ({ page }) => {
    const authPage = new AuthPage(page);
    const appPage = new ApplicationPage(page);
    const applicationId = 'app_loan_alpha_001';

    // Mock application in DOCUMENTS_PENDING state
    await page.route(`**/v1/applications/${applicationId}`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { ETag: 'W/"v1"' },
        contentType: 'application/json',
        body: JSON.stringify({
          id: applicationId,
          customerId: 'cus_alpha_001',
          branchId: 'MUM01',
          productCategory: 'PERSONAL_LOAN',
          productVersionId: null,
          requestedAmount: '300000',
          currency: 'INR',
          tenureMonths: 36,
          purposeCode: 'PERSONAL_NEEDS',
          applicantType: 'SALARIED',
          status: 'DOCUMENTS_PENDING',
          onHold: false,
          holdReason: null,
          holdUntil: null,
          salesOwnerId: 'usr_rm_01',
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      });
    });

    await page.route(`**/v1/applications/${applicationId}/checklist**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [],
          summary: { complete: false, total: 0, accepted: 0, pending: 0, waived: 0 },
        }),
      });
    });

    await page.route(`**/v1/applications/${applicationId}/lender-cases**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    });

    // Eligibility: no check has been run, the figures are empty, and the history is empty.
    await page.route(`**/v1/applications/${applicationId}/eligibility-assessments**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { nextCursor: null, limit: 50 } }),
      });
    });
    await page.route(`**/v1/applications/${applicationId}/eligibility-assessments/latest`, async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'NOT_FOUND',
            message: 'No eligibility assessment has been run for this application.',
            httpStatus: 404,
            correlationId: 'e2e',
            details: [],
            retryable: false,
          },
        }),
      });
    });
    await page.route(`**/v1/applications/${applicationId}/eligibility-inputs**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          applicationId,
          declaredMonthlyIncome: null,
          declaredIncomeSource: null,
          declaredAt: null,
          verifiedMonthlyIncome: null,
          verifiedAt: null,
          credit: null,
          creditEntryEnabled: false,
          version: 0,
        }),
      });
    });

    await page.route('**/v1/products**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    });

    await authPage.loginAs(PERSONAS.rm, `/applications/${applicationId}`);
    await appPage.showBanner('Enforcing Role Boundaries & SoD', 'To verify Relationship Managers cannot self-approve or sanction loans');
    await appPage.pause(1200);

    // 1. Verify RM can view application details header
    await expect(page.getByRole('heading', { name: `Application ${applicationId}` })).toBeVisible();

    // 2. SoD Boundary Verification: RM lacks `application.review` permission
    // "Send to review" button MUST NOT be visible for RM
    await expect(appPage.sendToReviewBtn).not.toBeVisible();

    // 3. SoD Boundary Verification: RM lacks `sanction.record` / `verification.complete`
    await expect(appPage.recordSanctionBtn).not.toBeVisible();
    await appPage.showBanner('SoD Confirmed', 'Review & Sanction actions are hidden for Relationship Managers');
    await appPage.pause(1500);

    // 4. Negative test: Cross-Tenant / Unauthorized Branch Lead Access
    // Out-of-scope and other-tenant IDs answer 404, never 403 (CLAUDE.md tenancy rules; Contracts §6)
    await page.route('**/v1/leads/led_forbidden_999', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: apiErrorBody('NOT_FOUND', 404, 'Lead not found.'),
      });
    });

    await appPage.goto('/leads/led_forbidden_999');
    await appPage.showBanner('Route Guard Check', 'Navigating to a lead outside the assigned branch scope');
    await appPage.pause(1200);

    // Verify fail-closed security: nothing of the lead is shown, only the not-found alert
    await appPage.showBanner('Branch Policy Enforced', 'Out-of-scope lead answers 404 and shows nothing');
    await expect(page.getByRole('alert').first()).toContainText('Lead not found.');
    await expect(page.getByRole('button', { name: /Qualify|Convert/i })).toHaveCount(0);
    await appPage.pause(2000);
    await authPage.logout();
  });
});
