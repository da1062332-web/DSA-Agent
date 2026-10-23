import { test, expect, type Page } from '@playwright/test';
import { PERSONAS, apiErrorBody } from './helpers/mock-session';
import { AuthPage, LenderCasePage, SanctionPage } from './pages';

test.describe('Persona 08: Loan Operations (ROLE-LOAN-OPS)', () => {

  // =========================================================================
  // TC-LO-01: Sanction Terms Recording & Tranche Limit Validation
  // (Notion QA Plan Module 08 Steps 7-8, MOD-SNC, MOD-TRN)
  // =========================================================================
  test('TC-LO-01: Sanction Terms Recording & Tranche Limit Validation', async ({ page }) => {
    const authPage = new AuthPage(page);
    const sanctionPage = new SanctionPage(page);

    const mockSanctions: any[] = [];
    const mockTranches: any[] = [];

    await page.route('**/v1/lender-cases/lcs_case_001/sanctions', async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        const newSanction = {
          id: 'snc_001',
          lenderCaseId: 'lcs_case_001',
          amount: body.amount,
          tenureMonths: body.tenureMonths,
          rateValue: body.rateValue,
          rateType: body.rateType || 'FLOATING',
          status: 'ACTIVE',
          sanctionDate: body.sanctionDate || new Date().toISOString().split('T')[0],
          validUntil: body.validUntil || '2027-10-21',
          createdAt: new Date().toISOString(),
        };
        mockSanctions.push(newSanction);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ data: newSanction }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: mockSanctions }),
        });
      }
    });

    await page.route('**/v1/sanctions/snc_001/tranches', async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        const newTranche = {
          id: 'trn_001',
          sanctionId: 'snc_001',
          trancheNo: 1,
          amount: body.amount,
          disbursedOn: body.disbursedOn || new Date().toISOString().split('T')[0],
          status: 'RECORDED',
          utrMasked: 'UTR***9999',
          loanAccountMasked: 'LA***5544',
          recordedBy: 'usr_loanops_01',
          createdAt: new Date().toISOString(),
        };
        mockTranches.push(newTranche);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ data: newTranche }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: mockTranches }),
        });
      }
    });

    await authPage.loginAs(PERSONAS.loanOps, '/sanctions/lcs_case_001');
    await sanctionPage.showBanner('Recording Loan Sanction Terms', 'To set approved loan amounts, interest rates, and enforce disbursement tranche limits');
    await sanctionPage.pause(1500);

    // 1. Verify Sanctions Panel loaded
    await sanctionPage.showBanner('Sanctions Workspace', 'Loading lender case sanction management');
    await expect(sanctionPage.sanctionsPanel).toBeVisible();

    // 2. Open Record Sanction Dialog
    await sanctionPage.showBanner('Open Record Sanction', 'Opening sanction term sheet modal');
    await expect(sanctionPage.openRecordSanctionBtn).toBeVisible();
    await sanctionPage.click(sanctionPage.openRecordSanctionBtn, 1500);

    // 3. Test Sanction field validations (amount = 0, tenure = 0, rate > 100%)
    await sanctionPage.showBanner('Sanction Validation Check', 'Testing zero amount, zero tenure & excessive rate');
    await sanctionPage.sanctionAmountInput.fill('0');
    await sanctionPage.sanctionTenureInput.fill('0');
    await sanctionPage.sanctionRateInput.fill('150');

    await sanctionPage.click(sanctionPage.saveSanctionBtn);

    await expect(page.getByText('Sanction amount must be greater than zero.')).toBeVisible();
    await expect(page.getByText('Tenure must be at least 1 month.')).toBeVisible();
    await expect(page.getByText('Interest rate must be between 0.01% and 100%.')).toBeVisible();
    await sanctionPage.pause(1500);

    // 4. Fill valid Notion QA Sanction Details
    await sanctionPage.showBanner('Fill Valid Sanction Terms', 'Sanction ₹15,00,000 at 9.25% for 180 months');
    await sanctionPage.type(sanctionPage.sanctionAmountInput, '1500000');
    await sanctionPage.type(sanctionPage.sanctionTenureInput, '180');
    await sanctionPage.type(sanctionPage.sanctionRateInput, '9.25');
    await sanctionPage.pause(1200);

    await sanctionPage.showBanner('Save Sanction Offer', 'Persisting approved sanction terms');
    await sanctionPage.click(sanctionPage.saveSanctionBtn, 2000);

    // Verify Sanction recorded
    await sanctionPage.showBanner('Sanction Recorded', 'Sanction ₹15,00,000 active in case overview');
    await expect(page.getByRole('heading', { name: '₹15,00,000' }).first()).toBeVisible();
    await sanctionPage.pause(1500);

    // 5. Open Record Tranche Dialog
    await sanctionPage.showBanner('Open Record Tranche', 'Opening disbursement tranche dialog');
    await expect(sanctionPage.openRecordTrancheBtn).toBeVisible();
    await sanctionPage.click(sanctionPage.openRecordTrancheBtn, 1500);

    // 6. Test Tranche validation: amount exceeding remaining limit
    await sanctionPage.showBanner('Tranche Limit Validation', 'Attempting tranche ₹20,00,000 (exceeds ₹15L limit)');
    await sanctionPage.trancheAmountInput.fill('2000000');
    if (await sanctionPage.saveTrancheBtn.isEnabled()) {
      await sanctionPage.click(sanctionPage.saveTrancheBtn);
      await expect(page.getByText(/exceed remaining limit/i)).toBeVisible();
    }
    await sanctionPage.pause(1500);

    // Fill valid tranche details
    await sanctionPage.showBanner('Fill Valid Tranche', 'Tranche #1 ₹7,50,000 with UTR & Loan Account');
    await sanctionPage.type(sanctionPage.trancheAmountInput, '750000');
    await sanctionPage.type(sanctionPage.trancheUtrInput, 'UTR202610219999');
    await sanctionPage.type(sanctionPage.trancheLoanAccountInput, 'LN8877665544');
    await sanctionPage.pause(1200);

    await sanctionPage.showBanner('Submit Tranche', 'Recording disbursement evidence');
    await sanctionPage.click(sanctionPage.saveTrancheBtn, 2000);

    // Verify Tranche rendered in table
    await sanctionPage.showBanner('Tranche #1 Recorded', 'Status: RECORDED (Pending dual-control verification)');
    await expect(page.getByRole('cell', { name: '₹7,50,000' })).toBeVisible();
    await expect(page.getByText('#1')).toBeVisible();
    await expect(page.getByText('RECORDED')).toBeVisible();
    await sanctionPage.pause(2500);
    await authPage.logout();
  });

  // =========================================================================
  // TC-LO-02 QA-OPS-002: SOD-04 — the user who recorded a tranche cannot verify it
  // (Notion Roles §4 SOD-04: verified_by <> recorded_by; QA plan Module 08 step 9)
  // ROLE-TENANT-ADMIN holds both disbursement.record and disbursement.verify (Notion Roles §7), so the verify action is
  // offered to it and only the maker-checker rule can stop it. An independent ROLE-FINANCE-EXEC (the SOD-04 checker) is
  // then offered the same action enabled.
  // =========================================================================
  test('TC-LO-02 QA-OPS-002: SOD-04 recorder cannot verify own tranche even holding disbursement.verify', async ({
    page,
  }) => {
    const authPage = new AuthPage(page);
    const sanctionPage = new SanctionPage(page);

    const sanction = {
      id: 'snc_002',
      lenderCaseId: 'lcs_case_002',
      amount: 1000000,
      tenureMonths: 120,
      rateValue: 8.5,
      rateType: 'FLOATING',
      status: 'ACTIVE',
      sanctionDate: new Date().toISOString().split('T')[0],
      validUntil: '2027-10-21',
      createdAt: new Date().toISOString(),
    };

    const mockTranche = {
      id: 'trn_sod_001',
      sanctionId: 'snc_002',
      trancheNo: 1,
      amount: 500000,
      disbursedOn: new Date().toISOString().split('T')[0],
      status: 'RECORDED',
      utrMasked: 'UTR***1111',
      loanAccountMasked: 'LA***9999',
      recordedBy: PERSONAS.tenantAdmin.userId, // the maker is the Tenant Admin
      createdAt: new Date().toISOString(),
    };

    await page.route('**/v1/lender-cases/lcs_case_002/sanctions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [sanction] }),
      });
    });

    await page.route('**/v1/sanctions/snc_002/tranches', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [mockTranche] }),
      });
    });

    // 1. Maker: the Tenant Admin recorded tranche #1 and holds disbursement.verify
    await authPage.loginAs(PERSONAS.tenantAdmin, '/sanctions/lcs_case_002');
    await sanctionPage.showBanner('Maker-Checker Dual Control', 'Tranche recorder holds disbursement.verify but is the maker');
    const verifyBtn = sanctionPage.getVerifyTrancheBtn('trn_sod_001');
    await expect(verifyBtn).toBeVisible();
    await expect(verifyBtn).toBeDisabled();
    await expect(verifyBtn).toHaveText('SOD Lock');
    await expect(verifyBtn).toHaveAttribute('title', 'Segregation of duties: Creator cannot verify');
    await sanctionPage.pause(2000);
    await authPage.logout();

    // 2. Checker: an independent Finance Executive is offered the same action, enabled
    await authPage.loginAs(PERSONAS.financeExec, '/sanctions/lcs_case_002');
    await sanctionPage.showBanner('Independent Checker', 'Finance Executive may verify a tranche someone else recorded');
    await expect(verifyBtn).toBeVisible();
    await expect(verifyBtn).toBeEnabled();
    await expect(verifyBtn).toHaveText('Verify');
    await sanctionPage.pause(2000);
    await authPage.logout();
  });

  // =========================================================================
  // TC-LO-03: Downstream Segregation of Duties (SoD) & Access Boundaries
  // (Notion Architecture SoD Boundaries: Denies Rule Publishing & Payout Approvals)
  // =========================================================================
  test('TC-LO-03: Downstream Segregation of Duties (SoD) & Access Boundaries', async ({ page }) => {
    const authPage = new AuthPage(page);
    const sanctionPage = new SanctionPage(page);

    await authPage.loginAs(PERSONAS.loanOps, '/rules');
    await sanctionPage.showBanner('Restricting Loan Operations Routes', 'To prevent Loan Operations staff from accessing rule engines or finance payouts');
    await sanctionPage.pause(1200);

    // 1. Verify Loan Operations cannot access Rules Authoring / Publishing
    await sanctionPage.showBanner('Route Guard: Rules', 'Navigating to /rules (Expect 403 Forbidden)');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await sanctionPage.pause(1500);

    // 2. Verify Loan Operations cannot access Commission Approvals / Payouts
    await sanctionPage.showBanner('Route Guard: Commission', 'Navigating to /commission (Expect 403 Forbidden)');
    await sanctionPage.goto('/commission');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await sanctionPage.pause(1500);

    await sanctionPage.showBanner('Route Guard: Approvals', 'Navigating to /approvals (Expect 403 Forbidden)');
    await sanctionPage.goto('/approvals');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await sanctionPage.showBanner('Access Boundaries Enforced', 'Loan Operations restricted strictly to origination');
    await sanctionPage.pause(2000);
    await authPage.logout();
  });

  // =========================================================================
  // Lender case journey (QA plan Module 08 steps 1-6; Notion Roles §3 phase 4, §5 step-up for lender_case.submit)
  // Fixtures follow the QA plan test data: APP-QA-001 → app_qa_001, CUST-QA-001, LND-QA-001, INR 300000 over 36 months,
  // starting state READY_FOR_SUBMISSION.
  // =========================================================================
  const APP_ID = 'app_qa_001';
  const CASE_ID = 'lcs_qa_001';
  const QUERY_ID = 'lqry_qa_001';
  const LENDER_NAME = 'QA Synthetic Lender One';

  type CaseState = { status: string; lockVersion: number; submittedAt: string | null; lenderReference: string | null };

  const lenderCase = (s: CaseState) => ({
    id: CASE_ID,
    tenantId: 'ten_01M595WCNH6H3ZMCVS70XH9GAN',
    applicationId: APP_ID,
    lenderId: 'lnd_qa_001',
    productVersionId: 'pv_qa_001',
    empanelmentId: 'emp_qa_001',
    attemptNo: 1,
    status: s.status,
    lenderReference: s.lenderReference,
    submissionChannel: s.submittedAt ? 'PORTAL' : null,
    submittedAt: s.submittedAt,
    packageId: s.status === 'DRAFT' ? null : 'pkg_qa_001',
    statusSource: 'MANUAL',
    lastStatusAt: null,
    declineReasonCode: null,
    stalenessFlag: false,
    tags: [],
    lockVersion: s.lockVersion,
    createdAt: new Date().toISOString(),
    createdBy: 'usr_loanops_01',
    updatedAt: new Date().toISOString(),
    updatedBy: 'usr_loanops_01',
  });

  /** The application workspace for APP-QA-001: application, checklist, lenders and the lender attempts list. */
  async function mockApplicationWorkspace(page: Page, state: CaseState, checklistComplete = true) {
    await page.route(`**/v1/applications/${APP_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { ETag: '"5"' },
        contentType: 'application/json',
        body: JSON.stringify({
          id: APP_ID,
          customerId: 'cus_qa_001',
          branchId: 'MUM01',
          productCategory: 'PERSONAL_LOAN',
          productVersionId: 'pv_qa_001',
          requestedAmount: '300000.00',
          currency: 'INR',
          tenureMonths: 36,
          purposeCode: 'PERSONAL_NEEDS',
          applicantType: 'SALARIED',
          status: 'READY_FOR_SUBMISSION',
          onHold: false,
          holdReason: null,
          holdUntil: null,
          salesOwnerId: 'usr_rm_01',
          opsOwnerId: 'usr_loanops_01',
          opsQueueId: null,
          version: 5,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      });
    });
    const item = (id: string, documentTypeCode: string, status: string) => ({
      id,
      applicationId: APP_ID,
      partyId: 'cus_qa_001',
      documentTypeCode,
      ordinal: 1,
      mandatory: true,
      requiredCount: 1,
      periodMonths: null,
      status,
      rejectReason: null,
      attestationNote: null,
      reviewedBy: status === 'ACCEPTED' ? 'usr_verifier_01' : null,
      reviewedAt: null,
      documentId: status === 'PENDING' ? null : `doc_${id}`,
      sourceDecisionId: 'dec_qa_001',
      version: 1,
    });
    await page.route(`**/v1/applications/${APP_ID}/checklist**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            item('chk_qa_address_001', 'ADDRESS_PROOF', 'ACCEPTED'),
            item('chk_qa_income_001', 'INCOME_PROOF', checklistComplete ? 'ACCEPTED' : 'PENDING'),
          ],
          summary: {
            total: 2,
            mandatory: 2,
            outstandingMandatory: checklistComplete ? 0 : 1,
            accepted: checklistComplete ? 2 : 1,
            rejected: 0,
            expired: 0,
            complete: checklistComplete,
          },
        }),
      });
    });
    await page.route(`**/v1/applications/${APP_ID}/eligibility**`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    });
    await page.route(`**/v1/applications/${APP_ID}/lender-cases**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [lenderCase(state)] }),
      });
    });
    await page.route('**/v1/lenders**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: 'lnd_qa_001', name: LENDER_NAME, status: 'ACTIVE' }] }),
      });
    });
    await page.route('**/v1/products**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    });
  }

  // =========================================================================
  // TC-LO-04 QA-OPS-001: review completeness, build the package and submit the lender case with fresh step-up
  // (QA plan Module 08 steps 1-4; lender_case.submit is elevated, Notion Roles §5)
  // =========================================================================
  test('TC-LO-04 QA-OPS-001: package and submit lender case after completeness review with step-up', async ({
    page,
  }) => {
    const authPage = new AuthPage(page);
    const casePage = new LenderCasePage(page);
    const state: CaseState = { status: 'DRAFT', lockVersion: 1, submittedAt: null, lenderReference: null };
    await mockApplicationWorkspace(page, state);

    const packageIfMatch: (string | undefined)[] = [];
    await page.route(`**/v1/lender-cases/${CASE_ID}/package`, async (route) => {
      packageIfMatch.push(route.request().headers()['if-match']);
      Object.assign(state, { status: 'PACKAGE_READY', lockVersion: 2 });
      await route.fulfill({
        status: 200,
        headers: { ETag: '"2"' },
        contentType: 'application/json',
        body: JSON.stringify({
          package: {
            id: 'pkg_qa_001',
            tenantId: 'ten_01M595WCNH6H3ZMCVS70XH9GAN',
            lenderCaseId: CASE_ID,
            kind: 'SUBMISSION',
            manifest: { documents: ['doc_chk_qa_address_001', 'doc_chk_qa_income_001'] },
            manifestSha256: 'b'.repeat(64),
            builtBy: 'usr_loanops_01',
            builtAt: new Date().toISOString(),
            frozenAt: new Date().toISOString(),
          },
          case: lenderCase(state),
        }),
      });
    });

    // The first submission answers 401 STEP_UP_REQUIRED; after the TOTP step-up the client retries once
    const submissions: { ifMatch?: string; body: Record<string, unknown> }[] = [];
    await page.route(`**/v1/lender-cases/${CASE_ID}/submission`, async (route) => {
      submissions.push({
        ifMatch: route.request().headers()['if-match'],
        body: JSON.parse(route.request().postData() || '{}'),
      });
      if (submissions.length === 1) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: apiErrorBody('STEP_UP_REQUIRED', 401, 'This action needs a fresh step-up authentication.'),
        });
        return;
      }
      Object.assign(state, {
        status: 'SUBMITTED',
        lockVersion: 3,
        submittedAt: new Date().toISOString(),
        lenderReference: 'LND-QA-REF-001',
      });
      await route.fulfill({
        status: 200,
        headers: { ETag: '"3"' },
        contentType: 'application/json',
        body: JSON.stringify(lenderCase(state)),
      });
    });

    // 1-2. Open APP-QA-001 and review completeness
    await authPage.loginAs(PERSONAS.loanOps, `/applications/${APP_ID}`);
    await casePage.showBanner('Application Review', 'Checking APP-QA-001 is ready and its checklist complete');
    await expect(page.getByRole('heading', { name: `Application ${APP_ID}` })).toBeVisible();
    await expect(page.getByText('Ready for submission').first()).toBeVisible();
    await expect(casePage.checklistCard).toContainText(
      'Every required document is accepted, waived or not applicable.',
    );

    // 3. The lender case carries the configured lender
    await expect(casePage.panel).toContainText(LENDER_NAME);
    await expect(casePage.statusChip('DRAFT')).toBeVisible();

    // 4a. Build and freeze the submission package (If-Match carries the case lock version)
    await casePage.showBanner('Package Lender Case', 'Building the frozen submission package');
    await casePage.click(casePage.buildPackageBtn, 1500);
    await expect(casePage.panel).toContainText('Submission package built and frozen.');
    await expect(casePage.statusChip('PACKAGE_READY')).toBeVisible();
    expect(packageIfMatch).toEqual(['"1"']);

    // 4b. Submit: the API demands step-up, the dialog collects the TOTP code, and the request is retried once
    await casePage.showBanner('Submit to Lender', 'lender_case.submit needs a fresh AAL2 step-up');
    await casePage.openSubmission('LND-QA-REF-001');
    await expect(authPage.stepUpDialog).toBeVisible();
    await authPage.completeStepUp();
    await expect(authPage.stepUpDialog).toBeHidden();
    await expect(casePage.panel).toContainText('Lender case successfully submitted.');
    await expect(casePage.statusChip('SUBMITTED')).toBeVisible();
    await expect(casePage.panel).toContainText('LND-QA-REF-001');
    expect(submissions).toHaveLength(2);
    expect(submissions.map((s) => s.ifMatch)).toEqual(['"2"', '"2"']);
    expect(submissions[1].body).toMatchObject({ channel: 'PORTAL', lenderReference: 'LND-QA-REF-001' });
    await casePage.pause(2000);
    await authPage.logout();
  });

  // =========================================================================
  // TC-LO-05: incomplete case cannot be packaged (QA plan Module 08 negative test "Incomplete case submission")
  // =========================================================================
  test('TC-LO-05: package build refused while a mandatory document is outstanding', async ({ page }) => {
    const authPage = new AuthPage(page);
    const casePage = new LenderCasePage(page);
    const state: CaseState = { status: 'DRAFT', lockVersion: 1, submittedAt: null, lenderReference: null };
    await mockApplicationWorkspace(page, state, false);

    await page.route(`**/v1/lender-cases/${CASE_ID}/package`, async (route) => {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: apiErrorBody('COMPLETENESS_FAILED', 422, 'Mandatory document INCOME_PROOF is not accepted.'),
      });
    });

    await authPage.loginAs(PERSONAS.loanOps, `/applications/${APP_ID}`);
    await casePage.showBanner('Incomplete Case', 'One mandatory document is still outstanding');
    await expect(casePage.checklistCard).toContainText('1 of 2 required documents still outstanding.');

    await casePage.click(casePage.buildPackageBtn, 1500);
    await expect(casePage.panel.getByRole('alert')).toContainText('Mandatory document INCOME_PROOF is not accepted.');
    await expect(casePage.statusChip('DRAFT')).toBeVisible();
    await expect(casePage.submitBtn).toHaveCount(0);
    await casePage.pause(2000);
    await authPage.logout();
  });

  // =========================================================================
  // TC-LO-06: lender submission without step-up is not sent (Notion Roles §5: 401 STEP_UP_REQUIRED for aal1)
  // =========================================================================
  test('TC-LO-06: lender case submission is blocked when step-up is not completed', async ({ page }) => {
    const authPage = new AuthPage(page);
    const casePage = new LenderCasePage(page);
    const state: CaseState = { status: 'PACKAGE_READY', lockVersion: 2, submittedAt: null, lenderReference: null };
    await mockApplicationWorkspace(page, state);

    let submissions = 0;
    await page.route(`**/v1/lender-cases/${CASE_ID}/submission`, async (route) => {
      submissions += 1;
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: apiErrorBody('STEP_UP_REQUIRED', 401, 'This action needs a fresh step-up authentication.'),
      });
    });

    await authPage.loginAs(PERSONAS.loanOps, `/applications/${APP_ID}`);
    await casePage.showBanner('Step-Up Gate', 'Submitting without a fresh TOTP code');
    await casePage.openSubmission('LND-QA-REF-002');
    await expect(authPage.stepUpDialog).toBeVisible();

    // A malformed code is refused by the dialog itself
    await authPage.type(authPage.stepUpCodeInput, '12');
    await authPage.click(authPage.stepUpSubmitBtn, 800);
    await expect(authPage.stepUpDialog).toContainText('Enter the 6-digit code from your authenticator app.');

    // Cancelling leaves the case unsubmitted and the request is not retried
    await authPage.click(authPage.stepUpCancelBtn, 1200);
    await expect(authPage.stepUpDialog).toBeHidden();
    await casePage.click(casePage.submitDialog.getByRole('button', { name: 'Cancel' }), 800);
    await expect(casePage.submitDialog).toBeHidden();
    await expect(casePage.panel.getByRole('alert')).toContainText('This action needs a fresh step-up authentication.');
    await expect(casePage.statusChip('PACKAGE_READY')).toBeVisible();
    expect(submissions).toBe(1);
    await casePage.pause(2000);
    await authPage.logout();
  });

  // =========================================================================
  // TC-LO-07: record a lender query asking for an additional income document (QA plan Module 08 step 5)
  // =========================================================================
  test('TC-LO-07: lender query is recorded against the submitted case', async ({ page }) => {
    const authPage = new AuthPage(page);
    const casePage = new LenderCasePage(page);
    const state: CaseState = {
      status: 'SUBMITTED',
      lockVersion: 3,
      submittedAt: new Date().toISOString(),
      lenderReference: 'LND-QA-REF-001',
    };
    await mockApplicationWorkspace(page, state);

    const queryRequests: { ifMatch?: string; body: Record<string, unknown> }[] = [];
    await page.route(`**/v1/lender-cases/${CASE_ID}/queries`, async (route) => {
      queryRequests.push({
        ifMatch: route.request().headers()['if-match'],
        body: JSON.parse(route.request().postData() || '{}'),
      });
      Object.assign(state, { status: 'QUERY_RAISED', lockVersion: 4 });
      await route.fulfill({
        status: 201,
        headers: { ETag: '"4"' },
        contentType: 'application/json',
        body: JSON.stringify({
          query: {
            id: QUERY_ID,
            tenantId: 'ten_01M595WCNH6H3ZMCVS70XH9GAN',
            lenderCaseId: CASE_ID,
            text: queryRequests[0].body.text,
            requestedItems: [],
            lenderDueDate: null,
            taskId: null,
            responseManifestId: null,
            respondedAt: null,
            createdAt: new Date().toISOString(),
            createdBy: 'usr_loanops_01',
          },
          case: lenderCase(state),
        }),
      });
    });

    await authPage.loginAs(PERSONAS.loanOps, `/applications/${APP_ID}`);
    await casePage.showBanner('Lender Query', 'Lender asks for an additional income document');
    await expect(casePage.statusChip('SUBMITTED')).toBeVisible();
    await casePage.raiseQuery('Please share an additional synthetic income proof (QA).');
    await expect(casePage.panel).toContainText('Query recorded successfully.');
    await expect(casePage.statusChip('QUERY_RAISED')).toBeVisible();
    expect(queryRequests).toHaveLength(1);
    expect(queryRequests[0].ifMatch).toBe('"3"');
    expect(queryRequests[0].body).toMatchObject({ text: 'Please share an additional synthetic income proof (QA).' });
    await casePage.pause(2000);
    await authPage.logout();
  });

  // =========================================================================
  // TC-LO-08: respond to the lender query (QA plan Module 08 step 6; API-LCS-007 POST /v1/lender-queries/{queryId}/responses)
  // KNOWN BUG, expected to fail: LenderCasePanel posts the response to /v1/lender-queries/{lenderCaseId}/responses, so the
  // real API answers 404. The panel never learns the query ID (no endpoint lists a case's queries). Remove test.fail once
  // the panel sends the query ID.
  // =========================================================================
  test('TC-LO-08: lender query response is recorded against the query', async ({ page }) => {
    test.fail(true, 'LenderCasePanel sends the lender case ID where API-LCS-007 expects the query ID');
    const authPage = new AuthPage(page);
    const casePage = new LenderCasePage(page);
    const state: CaseState = {
      status: 'SUBMITTED',
      lockVersion: 3,
      submittedAt: new Date().toISOString(),
      lenderReference: 'LND-QA-REF-001',
    };
    await mockApplicationWorkspace(page, state);

    await page.route(`**/v1/lender-cases/${CASE_ID}/queries`, async (route) => {
      Object.assign(state, { status: 'QUERY_RAISED', lockVersion: 4 });
      await route.fulfill({
        status: 201,
        headers: { ETag: '"4"' },
        contentType: 'application/json',
        body: JSON.stringify({
          query: {
            id: QUERY_ID,
            tenantId: 'ten_01M595WCNH6H3ZMCVS70XH9GAN',
            lenderCaseId: CASE_ID,
            text: 'Please share an additional synthetic income proof (QA).',
            requestedItems: [],
            createdAt: new Date().toISOString(),
            createdBy: 'usr_loanops_01',
          },
          case: lenderCase(state),
        }),
      });
    });

    const responseUrls: string[] = [];
    await page.route('**/v1/lender-queries/*/responses', async (route) => {
      responseUrls.push(new URL(route.request().url()).pathname);
      Object.assign(state, { status: 'QUERY_RESPONDED', lockVersion: 5 });
      await route.fulfill({
        status: 200,
        headers: { ETag: '"5"' },
        contentType: 'application/json',
        body: JSON.stringify({
          query: { id: QUERY_ID, lenderCaseId: CASE_ID, respondedAt: new Date().toISOString() },
          case: lenderCase(state),
        }),
      });
    });

    await authPage.loginAs(PERSONAS.loanOps, `/applications/${APP_ID}`);
    await casePage.raiseQuery('Please share an additional synthetic income proof (QA).');
    await expect(casePage.statusChip('QUERY_RAISED')).toBeVisible();

    await casePage.showBanner('Query Response', 'Answering the lender query');
    await casePage.respondToQuery('Additional synthetic income proof uploaded to the checklist (QA).');
    await expect(casePage.panel).toContainText('Query response recorded.');
    expect(responseUrls).toEqual([`/v1/lender-queries/${QUERY_ID}/responses`]);
    await authPage.logout();
  });
});
