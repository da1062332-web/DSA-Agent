import { test, expect } from '@playwright/test';
import { PERSONAS, setupPersonaSession, pauseForDemo, humanType, humanClick, showDemoBanner } from './helpers/mock-session';

test.describe('Persona 08: Loan Operations (ROLE-LOAN-OPS)', () => {
  test.beforeEach(async ({ page }) => {
    await setupPersonaSession(page, PERSONAS.loanOps);
  });

  // =========================================================================
  // TC-LO-01: Sanction Terms Recording & Tranche Limit Validation
  // (Notion QA Plan Module 08 Steps 7-8, MOD-SNC, MOD-TRN)
  // =========================================================================
  test('TC-LO-01: Sanction Terms Recording & Tranche Limit Validation', async ({ page }) => {
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

    await page.goto('/sanctions/lcs_case_001');
    await showDemoBanner(page, 'Recording Loan Sanction Terms', 'To set approved loan amounts, interest rates, and enforce disbursement tranche limits');
    await pauseForDemo(page, 1500);

    // 1. Verify Sanctions Panel loaded
    await showDemoBanner(page, 'Sanctions Workspace', 'Loading lender case sanction management');
    await expect(page.locator('[data-testid="sanctions-panel"]')).toBeVisible();

    // 2. Open Record Sanction Dialog
    await showDemoBanner(page, 'Open Record Sanction', 'Opening sanction term sheet modal');
    const recordSanctionBtn = page.locator('[data-testid="record-sanction-btn"]');
    await expect(recordSanctionBtn).toBeVisible();
    await humanClick(recordSanctionBtn, 1500);

    // 3. Test Sanction field validations (amount = 0, tenure = 0, rate > 100%)
    await showDemoBanner(page, 'Sanction Validation Check', 'Testing zero amount, zero tenure & excessive rate');
    const amountField = page.locator('input[data-testid="sanction.amount"]');
    await amountField.fill('0');
    const tenureField = page.locator('input[data-testid="sanction.tenureMonths"]');
    await tenureField.fill('0');
    const rateField = page.locator('input[data-testid="sanction.rateValue"]');
    await rateField.fill('150');

    const saveSanctionBtn = page.locator('button[data-testid="sanction.save-btn"]');
    await humanClick(saveSanctionBtn);

    await expect(page.getByText('Sanction amount must be greater than zero.')).toBeVisible();
    await expect(page.getByText('Tenure must be at least 1 month.')).toBeVisible();
    await expect(page.getByText('Interest rate must be between 0.01% and 100%.')).toBeVisible();
    await pauseForDemo(page, 1500);

    // 4. Fill valid Notion QA Sanction Details
    await showDemoBanner(page, 'Fill Valid Sanction Terms', 'Sanction ₹15,00,000 at 9.25% for 180 months');
    await humanType(amountField, '1500000');
    await humanType(tenureField, '180');
    await humanType(rateField, '9.25');
    await pauseForDemo(page, 1200);

    await showDemoBanner(page, 'Save Sanction Offer', 'Persisting approved sanction terms');
    await humanClick(saveSanctionBtn, 2000);

    // Verify Sanction recorded
    await showDemoBanner(page, 'Sanction Recorded', 'Sanction ₹15,00,000 active in case overview');
    await expect(page.getByRole('heading', { name: '₹15,00,000' }).first()).toBeVisible();
    await pauseForDemo(page, 1500);

    // 5. Open Record Tranche Dialog
    await showDemoBanner(page, 'Open Record Tranche', 'Opening disbursement tranche dialog');
    const recordTrancheBtn = page.locator('[data-testid="record-tranche-btn"]');
    await expect(recordTrancheBtn).toBeVisible();
    await humanClick(recordTrancheBtn, 1500);

    // 6. Test Tranche validation: amount exceeding remaining limit
    await showDemoBanner(page, 'Tranche Limit Validation', 'Attempting tranche ₹20,00,000 (exceeds ₹15L limit)');
    const trancheAmountField = page.locator('input[data-testid="tranche.amount"]');
    await trancheAmountField.fill('2000000');
    const trancheSaveBtn = page.locator('button[data-testid="tranche.save-btn"]');
    if (await trancheSaveBtn.isEnabled()) {
      await humanClick(trancheSaveBtn);
      await expect(page.getByText(/exceed remaining limit/i)).toBeVisible();
    }
    await pauseForDemo(page, 1500);

    // Fill valid tranche details
    await showDemoBanner(page, 'Fill Valid Tranche', 'Tranche #1 ₹7,50,000 with UTR & Loan Account');
    await humanType(trancheAmountField, '750000');
    await humanType(page.locator('input[data-testid="tranche.utr"]'), 'UTR202610219999');
    await humanType(page.locator('input[data-testid="tranche.loanAccount"]'), 'LN8877665544');
    await pauseForDemo(page, 1200);

    await showDemoBanner(page, 'Submit Tranche', 'Recording disbursement evidence');
    await humanClick(trancheSaveBtn, 2000);

    // Verify Tranche rendered in table
    await showDemoBanner(page, 'Tranche #1 Recorded', 'Status: RECORDED (Pending dual-control verification)');
    await expect(page.getByRole('cell', { name: '₹7,50,000' })).toBeVisible();
    await expect(page.getByText('#1')).toBeVisible();
    await expect(page.getByText('RECORDED')).toBeVisible();
    await pauseForDemo(page, 2500);
  });

  // =========================================================================
  // TC-LO-02: Maker-Checker Dual-Control Enforcement (SOD-04 Disbursement Verification)
  // (Notion Architecture §4 SOD-04: recorded_by != verified_by)
  // =========================================================================
  test('TC-LO-02: Maker-Checker Dual-Control Enforcement (SOD-04 Disbursement Verification)', async ({ page }) => {
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
      recordedBy: 'usr_loanops_01', // Created by this same user!
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

    await page.goto('/sanctions/lcs_case_002');
    await showDemoBanner(page, 'Maker-Checker Dual Control', 'To prevent the maker who entered a disbursement tranche from self-verifying it');
    await pauseForDemo(page, 1500);

    // Verify SOD-04 Enforcement: Loan Operations has `disbursement.record` to log tranches,
    // but CANNOT verify tranches (`disbursement.verify` is strictly restricted to Finance)
    await showDemoBanner(page, 'Tranche Verification Restricted', 'Disbursement verify action hidden for the tranche maker');
    const verifyBtn = page.locator('[data-testid="verify-tranche-btn-trn_sod_001"]');
    await expect(verifyBtn).not.toBeVisible();
    await showDemoBanner(page, 'Dual Control Verified', 'Separation of duties between recorder and verifier enforced');
    await pauseForDemo(page, 2500);
  });

  // =========================================================================
  // TC-LO-03: Downstream Segregation of Duties (SoD) & Access Boundaries
  // (Notion Architecture SoD Boundaries: Denies Rule Publishing & Payout Approvals)
  // =========================================================================
  test('TC-LO-03: Downstream Segregation of Duties (SoD) & Access Boundaries', async ({ page }) => {
    await showDemoBanner(page, 'Restricting Loan Operations Routes', 'To prevent Loan Operations staff from accessing rule engines or finance payouts');
    await pauseForDemo(page, 1200);

    // 1. Verify Loan Operations cannot access Rules Authoring / Publishing
    await showDemoBanner(page, 'Route Guard: Rules', 'Navigating to /rules (Expect 403 Forbidden)');
    await page.goto('/rules');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await pauseForDemo(page, 1500);

    // 2. Verify Loan Operations cannot access Commission Approvals / Payouts
    await showDemoBanner(page, 'Route Guard: Commission', 'Navigating to /commission (Expect 403 Forbidden)');
    await page.goto('/commission');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await pauseForDemo(page, 1500);

    await showDemoBanner(page, 'Route Guard: Approvals', 'Navigating to /approvals (Expect 403 Forbidden)');
    await page.goto('/approvals');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await showDemoBanner(page, 'Access Boundaries Enforced', 'Loan Operations restricted strictly to origination');
    await pauseForDemo(page, 2000);
  });
});
