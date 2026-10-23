import { test, expect } from '@playwright/test';
import { PERSONAS } from './helpers/mock-session';
import { AuthPage, PayoutPage, CommissionPage } from './pages';

test.describe('Persona 13: Finance & Payout Management (ROLE-FINANCE-EXEC & ROLE-COMMISSION-APPROVER)', () => {
  const mockPayoutRequest = {
    id: 'pay_req_001',
    connectorId: 'con_001',
    origin: 'MANUAL',
    total: '25000',
    status: 'SUBMITTED',
    submittedBy: 'usr_finance_01', // Created by Finance Exec
    submittedAt: new Date().toISOString(),
    paymentRefMasked: null,
    lines: [
      {
        id: 'pline_001',
        payableId: 'pay_001',
        amount: '25000',
        currency: 'INR',
      },
    ],
  };

  test('TC-FIN-01: Finance Executive proposes payout request and verifies Maker SOD-03 lock', async ({
    page,
  }) => {
    const authPage = new AuthPage(page);
    const payoutPage = new PayoutPage(page);

    await payoutPage.showBanner('Proposing Partner Payout Batch', 'To submit connector payout batches and enforce maker lockout from approving them');

    // Mock payout requests
    await page.route('**/v1/payout-requests**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [mockPayoutRequest], meta: { total: 1 } }),
      });
    });

    await authPage.loginAs(PERSONAS.financeExec, '/payouts');
    await payoutPage.pause(1500);

    // 1. Verify Payout Dashboard loaded
    await payoutPage.showBanner('Payouts Hub Loaded', 'Reviewing connector payout requests register');
    await expect(page.getByText('Payouts & Settlement Hub')).toBeVisible();
    await expect(page.getByText('pay_req_001')).toBeVisible();
    await payoutPage.pause(1500);

    // 2. Check tab "Approval Queue"
    await payoutPage.showBanner('Approval Queue Tab', 'Inspecting pending approvals for maker-checker lock');
    await payoutPage.switchToApprovalQueue();

    // 3. SOD-03: Maker (usr_finance_01) CANNOT approve own payout request!
    await payoutPage.showBanner('Maker Approval Disabled', 'Submitter cannot approve own payout to enforce separation of duties');
    await expect(payoutPage.reviewAndDecideBtn).toBeVisible();
    await expect(payoutPage.reviewAndDecideBtn).toBeDisabled();
    await payoutPage.pause(2500);
    await authPage.logout();
  });

  test('TC-FIN-02: Commission Approver authorizes payout request (Independent Dual Control)', async ({
    page,
  }) => {
    const authPage = new AuthPage(page);
    const payoutPage = new PayoutPage(page);

    await payoutPage.showBanner('Authorizing Payout as Independent Checker', 'To review payout calculations and approve bank disbursement independently');

    let currentRequest = { ...mockPayoutRequest };

    // Mock payout requests & approval
    await page.route('**/v1/payout-requests**', async (route) => {
      const url = route.request().url();
      if (url.includes('/approval')) {
        currentRequest = {
          ...currentRequest,
          status: 'APPROVED',
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: currentRequest }),
        });
      } else if (url.includes('/pay_req_001')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: currentRequest }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [currentRequest], meta: { total: 1 } }),
        });
      }
    });

    await authPage.loginAs(PERSONAS.commissionApprover, '/payouts');
    await payoutPage.pause(1500);

    // 1. Go to "Approval Queue" tab
    await payoutPage.showBanner('Approval Queue Tab', 'Independent checker reviewing pending payout requests');
    await payoutPage.switchToApprovalQueue();

    // 2. Approver is NOT the maker (usr_cfo_01 !== usr_finance_01), so button is enabled
    await payoutPage.showBanner('Open Approval Review', 'Checker opening independent maker-checker payout review');
    await expect(payoutPage.reviewAndDecideBtn).toBeVisible();
    await expect(payoutPage.reviewAndDecideBtn).toBeEnabled();

    // 3. Dialog opens and approve
    await payoutPage.showBanner('Justification Entry', 'Entering decision comment: Verified against lender remittance');
    await payoutPage.approvePayout('Verified against lender remittance statement; approved for payment.');

    // 4. Verify confirmation message
    await payoutPage.showBanner('Payout Approved', 'Request marked as APPROVED for payment settlement');
    await expect(page.getByText(/marked as APPROVED/i)).toBeVisible();
    await payoutPage.pause(2500);
    await authPage.logout();
  });

  test('TC-FIN-03: Payment Operations records bank UTR with validation & batch generation', async ({
    page,
  }) => {
    const authPage = new AuthPage(page);
    const payoutPage = new PayoutPage(page);

    await payoutPage.showBanner('Recording Bank Settlement & UTR', 'To record official bank reference numbers and mark partner payouts settled');

    const approvedRequest = {
      ...mockPayoutRequest,
      status: 'APPROVED',
      approvedBy: 'usr_cfo_01',
    };

    // Mock approval and payment recording
    await page.route('**/v1/payout-requests**', async (route) => {
      const url = route.request().url();
      if (url.includes('/payment')) {
        approvedRequest.status = 'PAYMENT_RECORDED';
        approvedRequest.paymentRefMasked = 'UTR***5678';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: approvedRequest }),
        });
      } else if (url.includes('/pay_req_001')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: approvedRequest }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [approvedRequest], meta: { total: 1 } }),
        });
      }
    });

    await authPage.loginAs(PERSONAS.commissionApprover, '/payouts');
    await payoutPage.pause(1500);

    // 1. Go to "Payment Recording & Batches" tab
    await payoutPage.showBanner('Payment Operations Tab', 'Reviewing approved payouts ready for bank dispatch');
    await payoutPage.switchToPaymentTab();
    await expect(page.getByText('pay_req_001')).toBeVisible();
    await payoutPage.pause(1200);

    // 2. Click "Record UTR"
    await payoutPage.showBanner('Open Record UTR', 'Opening bank transaction reference modal');
    await expect(payoutPage.openRecordUtrBtn).toBeVisible();
    await payoutPage.click(payoutPage.openRecordUtrBtn, 1500);

    // 3. Test validation: empty UTR submission
    await payoutPage.showBanner('Empty UTR Validation', 'Testing required bank reference field validation');
    await payoutPage.utrInput.fill('');
    await payoutPage.click(payoutPage.submitPaymentBtn, 1500);
    await expect(page.getByText('Bank reference (UTR) is required.').first()).toBeVisible();
    await payoutPage.pause(1500);

    // 4. Fill valid UTR and submit
    await payoutPage.showBanner('Fill Valid UTR', 'Recording transaction UTR9876543210');
    await payoutPage.type(payoutPage.utrInput, 'UTR9876543210');
    await payoutPage.pause(1200);
    await payoutPage.click(payoutPage.submitPaymentBtn, 2000);

    // 5. Verify success toast / feedback
    await payoutPage.showBanner('Payment Recorded', 'Settlement confirmed & encrypted NEFT/RTGS batch generated');
    await expect(page.getByText(/Payment recorded for payout/i)).toBeVisible();
    await payoutPage.pause(2500);
    await authPage.logout();
  });

  test('TC-FIN-04: Commission Plan Maker-Checker Dual Control (SOD-02)', async ({ page }) => {
    const authPage = new AuthPage(page);
    const commissionPage = new CommissionPage(page);

    await commissionPage.showBanner('Governing Commission Plans Dual Control', 'To ensure lender commission schemes require independent checker sign-off before activation');

    const mockPlan = {
      id: 'cplan_qa_001',
      tenantId: 'tenant_test_001',
      lenderId: 'lnd_hdfc',
      ruleSetId: 'rset_hl_01',
      qualifyingEvent: 'DISBURSEMENT',
      basis: 'DISBURSED_AMOUNT',
      roundingMode: 'HALF_UP',
      clawbackWindowDays: 90,
      status: 'DRAFT',
      lockVersion: 1,
      createdBy: 'usr_finance_01', // Maker was financeExec
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    let currentPlan = { ...mockPlan };

    await page.route('**/v1/commission-plans**', async (route) => {
      const url = route.request().url();
      if (url.includes('/approval')) {
        currentPlan = {
          ...currentPlan,
          status: 'ACTIVE',
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(currentPlan),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [currentPlan], meta: { total: 1 } }),
        });
      }
    });

    await page.route('**/v1/commission-calculations**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { total: 0 } }),
      });
    });

    await page.route('**/v1/commission-payables**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { total: 0 } }),
      });
    });

    await page.route('**/v1/lenders**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: 'lnd_hdfc', name: 'HDFC Bank', active: true }] }),
      });
    });

    await page.route('**/v1/recalculation-proposals**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    });

    await authPage.loginAs(PERSONAS.commissionApprover, '/commission');
    await commissionPage.pause(1500);

    // 1. Verify Commission Dashboard loaded
    await commissionPage.showBanner('Commission Hub Loaded', 'Reviewing lender plans with maker-checker governance');
    await expect(page.getByText('Commission Management Hub')).toBeVisible();
    await expect(page.getByText('HDFC Bank').first()).toBeVisible();
    await expect(page.getByText('rset_hl_01').first()).toBeVisible();
    await commissionPage.pause(1200);

    // 2. Checker (usr_cfo_01) sees enabled "Approve (SOD-02)" button
    await commissionPage.showBanner('Independent Plan Review', 'Checker authorizing draft commission plan under SOD-02');
    await expect(commissionPage.approvePlanBtn).toBeVisible();
    await expect(commissionPage.approvePlanBtn).toBeEnabled();
    await commissionPage.approvePlan(2000);

    // 3. Verify success message and ACTIVE state transition
    await commissionPage.showBanner('Commission Plan ACTIVE', 'Plan approved and active for tranche calculations');
    await expect(page.getByText(/approved and marked ACTIVE/i)).toBeVisible();
    await commissionPage.pause(2500);
    await authPage.logout();
  });
});
