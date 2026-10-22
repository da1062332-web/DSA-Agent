import { test, expect } from '@playwright/test';
import { PERSONAS, setupPersonaSession, pauseForDemo, humanType, humanClick } from './helpers/mock-session';

test.describe('Persona 06: Relationship Manager (ROLE-RM)', () => {
  test.beforeEach(async ({ page }) => {
    await setupPersonaSession(page, PERSONAS.rm);
  });

  // =========================================================================
  // TC-RM-01: Lead Intake with proactive client-side field validation & creation
  // (Notion: Module 06 Steps 1-3, SUB-LEAD.01, CMP-LEAD.01.1, ENT-020)
  // =========================================================================
  test('TC-RM-01: Lead Intake with proactive client-side field validation & creation', async ({ page }) => {
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

    await page.goto('/leads/new');
    await pauseForDemo(page, 2000);

    // 1. Check page title and subtitle
    await expect(page.locator('h1')).toContainText('Create New Lead');

    // 2. Test empty submission validation
    const submitBtn = page.getByRole('button', { name: /Create Lead/i });
    await humanClick(submitBtn);

    // Verify inline field validation errors
    await expect(page.getByText('Enter the full name (at least 2 characters).')).toBeVisible();
    await expect(page.getByText('Enter a mobile number.')).toBeVisible();
    await pauseForDemo(page, 2000);

    // 3. Test invalid mobile number validation (must be 10 digits starting 6, 7, 8, or 9)
    const mobileInput = page.locator('input[data-testid="lead-form.mobile"]');
    await humanType(mobileInput, '12345');
    await humanClick(submitBtn);
    await expect(page.getByText('Enter a 10-digit mobile number starting with 6, 7, 8 or 9.')).toBeVisible();
    await pauseForDemo(page, 2000);

    // 4. Test invalid email format validation
    const emailInput = page.locator('input[data-testid="lead-form.email"]');
    await humanType(emailInput, 'invalid-email');
    await humanClick(submitBtn);
    await expect(page.getByText('Enter a valid email address, or leave it blank.')).toBeVisible();
    await pauseForDemo(page, 2000);

    // 5. Test invalid pincode validation (6 digits, non-zero starting)
    const pincodeInput = page.locator('input[data-testid="lead-form.pincode"]');
    await humanType(pincodeInput, '012345');
    await humanClick(submitBtn);
    await expect(page.getByText('Enter a 6-digit pincode that does not start with 0.')).toBeVisible();
    await pauseForDemo(page, 2000);

    // 6. Test invalid amount (zero or negative)
    const amountInput = page.locator('input[data-testid="lead-form.amount"]');
    await humanType(amountInput, '0');
    await humanClick(submitBtn);
    await expect(page.getByText(/Enter an amount greater than zero/i)).toBeVisible();
    await pauseForDemo(page, 2000);

    // 7. Fill valid Notion QA test data
    await humanType(page.locator('input[data-testid="lead-form.fullName"]'), 'Test Customer Alpha');
    await humanType(mobileInput, '9000000101');
    await humanType(emailInput, 'alpha.qa@example.com');
    await humanType(pincodeInput, '411001');
    await humanType(amountInput, '300000');
    await pauseForDemo(page, 2000);

    // Submit valid lead intake form
    await humanClick(submitBtn, 3000);

    // Verify redirection to lead detail page with newly created lead in state NEW
    await expect(page).toHaveURL(/\/leads\/led_test_alpha_001/);
    await expect(page.locator('h1')).toContainText('Test Customer Alpha');
    await expect(page.getByText('NEW', { exact: true })).toBeVisible();
    await pauseForDemo(page, 3000);
  });

  // =========================================================================
  // TC-RM-02: Lead Duplicate Detection & Classification Surfacing
  // (Notion: Module 06 Step 4, SUB-LEAD.04, ENT-020 duplicate_flag)
  // =========================================================================
  test('TC-RM-02: Lead Duplicate Detection & Classification Surfacing', async ({ page }) => {
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

    await page.goto('/leads/led_dup_alpha_002');
    await pauseForDemo(page, 2000);

    // 1. Verify lead loaded
    await expect(page.locator('h1')).toContainText('Test Customer Alpha (Duplicate)');

    // 2. Verify duplicate flag badge rendered prominently
    const dupBadge = page.locator('[data-testid="lead.duplicate-flag"]');
    await expect(dupBadge).toBeVisible();
    await expect(dupBadge).toContainText('Duplicate: POSSIBLE');
    await pauseForDemo(page, 2000);

    // 3. Verify duplicate candidate link is surfaced for merge review
    const dupCandidates = page.locator('[data-testid="lead.duplicate-candidates"]');
    await expect(dupCandidates).toBeVisible();
    await expect(dupCandidates).toContainText('led_existing_099');
    await pauseForDemo(page, 2000);
  });

  // =========================================================================
  // TC-RM-03: Lead Lifecycle Tracking — Contact Attempt (T-LEAD-01) & In Progress (T-LEAD-02)
  // (Notion: Module 06 Step 5, SUB-LEAD.06, T-LEAD-01, T-LEAD-02)
  // =========================================================================
  test('TC-RM-03: Lead Lifecycle Tracking — Contact Attempt (T-LEAD-01) & In Progress (T-LEAD-02)', async ({
    page,
  }) => {
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
      const payload = JSON.parse(route.request().postData() || '{}');
      if (payload.transitionCode === 'T-LEAD-01') {
        mockLead.state = 'CONTACT_ATTEMPTED';
        mockLead.contactAttempts = 1;
        mockLead.lockVersion = 2;
      } else if (payload.transitionCode === 'T-LEAD-02') {
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

    await page.goto('/leads/led_lifecycle_001');
    await pauseForDemo(page, 2000);

    // Initial state: NEW
    await expect(page.getByText('NEW', { exact: true })).toBeVisible();

    // 1. Trigger T-LEAD-01: Attempt Contact
    const attemptContactBtn = page.locator('[data-testid="lead.action.attempt-contact"]');
    await expect(attemptContactBtn).toBeVisible();
    await humanClick(attemptContactBtn, 2000);

    // Verify state transitioned to CONTACT_ATTEMPTED
    await expect(page.getByText('Lead status updated.')).toBeVisible();
    await expect(page.getByText('CONTACT_ATTEMPTED', { exact: true })).toBeVisible();
    await pauseForDemo(page, 2000);

    // 2. Trigger T-LEAD-02: Mark In Progress
    const inProgressBtn = page.locator('[data-testid="lead.action.in-progress"]');
    await expect(inProgressBtn).toBeVisible();
    await humanClick(inProgressBtn, 2000);

    // Verify state transitioned to IN_PROGRESS
    await expect(page.getByText('Lead status updated.')).toBeVisible();
    await expect(page.getByText('IN_PROGRESS', { exact: true })).toBeVisible();
    await pauseForDemo(page, 2000);
  });

  // =========================================================================
  // TC-RM-04: Lead Qualification (T-LEAD-04) & Atomic Conversion to Loan Application
  // (Notion: Module 06 Steps 5 & 6, SUB-LEAD.06, SUB-LEAD.09, API-LEAD-007)
  // =========================================================================
  test('TC-RM-04: Lead Qualification (T-LEAD-04) & Atomic Conversion to Loan Application', async ({
    page,
  }) => {
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

    await page.goto('/leads/led_qual_alpha_001');
    await pauseForDemo(page, 2000);

    // 1. Open Qualify Dialog (T-LEAD-04)
    const qualifyBtn = page.locator('[data-testid="lead.action.qualify"]');
    await expect(qualifyBtn).toBeVisible();
    await humanClick(qualifyBtn, 2000);

    // 2. Validate empty amount check
    const amountField = page.locator('[data-testid="qualify.amount"] input');
    await amountField.fill('');
    const submitQualifyBtn = page.locator('[data-testid="qualify.submit"]');
    await humanClick(submitQualifyBtn);
    await expect(page.getByText('Enter a valid loan amount greater than zero.')).toBeVisible();
    await pauseForDemo(page, 2000);

    // Fill valid qualification data: amount and submit
    await humanType(amountField, '300000');
    await humanClick(submitQualifyBtn, 2500);

    // 3. Confirm transition to QUALIFIED
    await expect(page.getByText('Lead lifecycle state updated successfully.')).toBeVisible();
    await expect(page.getByText('QUALIFIED', { exact: true })).toBeVisible();
    await pauseForDemo(page, 2000);

    // 4. Execute Atomic Conversion to Loan Application (SUB-LEAD.09)
    const convertBtn = page.locator('[data-testid="lead.action.convert"]');
    await expect(convertBtn).toBeVisible();
    await humanClick(convertBtn, 2500);

    // 5. Verify Atomic Conversion Result: Application & Customer entities created
    await expect(page.getByRole('heading', { name: 'Lead Converted Successfully' })).toBeVisible();
    await expect(page.getByText('app_loan_alpha_001')).toBeVisible();
    await expect(page.getByText('cus_alpha_001')).toBeVisible();

    // Verify navigation link to DPDP Consents is displayed
    const consentsLink = page.getByRole('link', { name: /Manage Customer DPDP Consents/i });
    await expect(consentsLink).toBeVisible();
    await pauseForDemo(page, 3000);
  });

  // =========================================================================
  // TC-RM-05: DPDP Act Compliance & Customer Consent Recording and Revocation
  // (Notion: Module 06 Step 7, consent.record, MOD-PRV, ENT-028)
  // =========================================================================
  test('TC-RM-05: DPDP Act Compliance & Customer Consent Recording and Revocation', async ({ page }) => {
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

    await page.goto(`/customers/${customerId}/consents`);
    await pauseForDemo(page, 2000);

    // 1. Verify customer header and profile details
    await expect(page.getByRole('heading', { name: 'Customer Consent Management' })).toBeVisible();
    await expect(page.getByText('Test Customer Alpha')).toBeVisible();

    // 2. Open "+ Record New Consent" dialog
    const recordConsentBtn = page.getByRole('button', { name: /\+ Record New Consent/i });
    await expect(recordConsentBtn).toBeVisible();
    await humanClick(recordConsentBtn, 2000);

    // 3. Fill DPDP consent details
    const noticeVersionInput = page.locator('input[data-testid="consent.noticeVersion"]');
    await noticeVersionInput.fill('');
    await humanType(noticeVersionInput, 'QA-CONSENT-V1');

    const evidenceRefInput = page.locator('input[data-testid="consent.evidenceRef"]');
    await humanType(evidenceRefInput, 'DOC-SIGNED-001');
    await pauseForDemo(page, 2000);

    // Submit consent
    const submitConsentBtn = page.locator('[data-testid="consent.submit"]');
    await humanClick(submitConsentBtn, 2500);

    // 4. Verify consent record rendered in active table
    await expect(page.getByRole('cell', { name: 'CONTACT' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'QA-CONSENT-V1' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'ACTIVE' })).toBeVisible();
    await pauseForDemo(page, 2000);

    // 5. Test Revocation / Withdrawal (Right to Withdraw under DPDP Act)
    const withdrawBtn = page.getByRole('button', { name: 'Withdraw' });
    await expect(withdrawBtn).toBeVisible();
    await humanClick(withdrawBtn, 2500);

    // Verify status updated to WITHDRAWN / Revoked
    await expect(page.getByText('Revoked')).toBeVisible();
    await pauseForDemo(page, 3000);
  });

  // =========================================================================
  // TC-RM-06: Segregation of Duties (SoD) & Access Control Enforcement
  // (Notion: SoD Dual Control, SOD-01 to SOD-05, Restricted Permissions)
  // =========================================================================
  test('TC-RM-06: Segregation of Duties (SoD) & Access Control Enforcement', async ({ page }) => {
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

    await page.route(`**/v1/applications/${applicationId}/eligibility**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    });

    await page.route('**/v1/products**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    });

    await page.goto(`/applications/${applicationId}`);
    await pauseForDemo(page, 2000);

    // 1. Verify RM can view application details header
    await expect(page.getByRole('heading', { name: `Application ${applicationId}` })).toBeVisible();

    // 2. SoD Boundary Verification: RM lacks `application.review` permission
    // "Send to review" button MUST NOT be visible for RM
    const reviewBtn = page.getByRole('button', { name: /Send to review/i });
    await expect(reviewBtn).not.toBeVisible();

    // 3. SoD Boundary Verification: RM lacks `sanction.record` / `verification.complete`
    const approveSanctionBtn = page.getByRole('button', { name: /Record Sanction/i });
    await expect(approveSanctionBtn).not.toBeVisible();

    // 4. Negative test: Cross-Tenant / Unauthorized Branch Lead Access
    await page.route('**/v1/leads/led_forbidden_999', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'FORBIDDEN',
            httpStatus: 403,
            message: 'Access denied outside assigned branch scope.',
          },
        }),
      });
    });

    await page.goto('/leads/led_forbidden_999');
    await pauseForDemo(page, 2000);

    // Verify fail-closed security: error alert displayed
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText(/Cannot reach the lead|Request failed \(403\)|Access denied/i)).toBeVisible();
    await pauseForDemo(page, 3000);
  });
});
