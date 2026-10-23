import { test, expect } from '@playwright/test';
import { PERSONAS } from './helpers/mock-session';
import { AuthPage, SanctionPage } from './pages';

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
  // TC-LO-02: Maker-Checker Dual-Control Enforcement (SOD-04 Disbursement Verification)
  // (Notion Architecture §4 SOD-04: recorded_by != verified_by)
  // =========================================================================
  test('TC-LO-02: Maker-Checker Dual-Control Enforcement (SOD-04 Disbursement Verification)', async ({ page }) => {
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

    await authPage.loginAs(PERSONAS.loanOps, '/sanctions/lcs_case_002');
    await sanctionPage.showBanner('Maker-Checker Dual Control', 'To prevent the maker who entered a disbursement tranche from self-verifying it');
    await sanctionPage.pause(1500);

    // Verify SOD-04 Enforcement: Loan Operations has `disbursement.record` to log tranches,
    // but CANNOT verify tranches (`disbursement.verify` is strictly restricted to Finance)
    await sanctionPage.showBanner('Tranche Verification Restricted', 'Disbursement verify action hidden for the tranche maker');
    const verifyBtn = sanctionPage.getVerifyTrancheBtn('trn_sod_001');
    await expect(verifyBtn).not.toBeVisible();
    await sanctionPage.showBanner('Dual Control Verified', 'Separation of duties between recorder and verifier enforced');
    await sanctionPage.pause(2500);
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
});
