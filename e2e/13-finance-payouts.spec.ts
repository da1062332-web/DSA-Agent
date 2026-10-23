import { test, expect } from '@playwright/test';
import {
  PERSONAS,
  setupPersonaSession,
  performRoleLogin,
  performRoleLogout,
  pauseForDemo,
  humanClick,
  humanType,
  showDemoBanner,
} from './helpers/mock-session';

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
    await showDemoBanner(page, 'Proposing Partner Payout Batch', 'To submit connector payout batches and enforce maker lockout from approving them');

    // Mock payout requests
    await page.route('**/v1/payout-requests**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [mockPayoutRequest], meta: { total: 1 } }),
      });
    });

    await performRoleLogin(page, PERSONAS.financeExec, '/payouts');
    await pauseForDemo(page, 1500);

    // 1. Verify Payout Dashboard loaded
    await showDemoBanner(page, 'Payouts Hub Loaded', 'Reviewing connector payout requests register');
    await expect(page.getByText('Payouts & Settlement Hub')).toBeVisible();
    await expect(page.getByText('pay_req_001')).toBeVisible();
    await pauseForDemo(page, 1500);

    // 2. Check tab "Approval Queue"
    await showDemoBanner(page, 'Approval Queue Tab', 'Inspecting pending approvals for maker-checker lock');
    const approvalTab = page.getByRole('tab', { name: /Approval Queue/i });
    await humanClick(approvalTab, 1500);

    // 3. SOD-03: Maker (usr_finance_01) CANNOT approve own payout request!
    await showDemoBanner(page, 'Maker Approval Disabled', 'Submitter cannot approve own payout to enforce separation of duties');
    const approveBtn = page.getByRole('button', { name: /Review & Decide \(SOD-03\)/i });
    await expect(approveBtn).toBeVisible();
    await expect(approveBtn).toBeDisabled();
    await pauseForDemo(page, 2500);
    await performRoleLogout(page);
  });

  test('TC-FIN-02: Commission Approver authorizes payout request (Independent Dual Control)', async ({
    page,
  }) => {
    await showDemoBanner(page, 'Authorizing Payout as Independent Checker', 'To review payout calculations and approve bank disbursement independently');

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

    await performRoleLogin(page, PERSONAS.commissionApprover, '/payouts');
    await pauseForDemo(page, 1500);

    // 1. Go to "Approval Queue" tab
    await showDemoBanner(page, 'Approval Queue Tab', 'Independent checker reviewing pending payout requests');
    const approvalTab = page.getByRole('tab', { name: /Approval Queue/i });
    await humanClick(approvalTab, 1500);

    // 2. Approver is NOT the maker (usr_cfo_01 !== usr_finance_01), so button is enabled
    await showDemoBanner(page, 'Open Approval Review', 'Checker opening independent maker-checker payout review');
    const reviewBtn = page.getByRole('button', { name: /Review & Decide \(SOD-03\)/i });
    await expect(reviewBtn).toBeVisible();
    await expect(reviewBtn).toBeEnabled();
    await humanClick(reviewBtn, 1500);

    // 3. Dialog opens
    await expect(page.getByText(/Maker-Checker Payout Review/i)).toBeVisible();
    await showDemoBanner(page, 'Justification Entry', 'Entering decision comment: Verified against lender remittance');
    const commentInput = page.getByLabel(/Decision Justification|Comment/i);
    if (await commentInput.isVisible()) {
      await humanType(commentInput, 'Verified against lender remittance statement; approved for payment.');
      await pauseForDemo(page, 1200);
    }

    // 4. Confirm approval
    await showDemoBanner(page, 'Confirm Payout Approval', 'Authorizing payout request for bank disbursement');
    const confirmBtn = page.getByRole('button', { name: /Confirm APPROVED/i });
    await humanClick(confirmBtn, 2000);

    // 5. Verify confirmation message
    await showDemoBanner(page, 'Payout Approved', 'Request marked as APPROVED for payment settlement');
    await expect(page.getByText(/marked as APPROVED/i)).toBeVisible();
    await pauseForDemo(page, 2500);
    await performRoleLogout(page);
  });

  test('TC-FIN-03: Payment Operations records bank UTR with validation & batch generation', async ({
    page,
  }) => {
    await showDemoBanner(page, 'Recording Bank Settlement & UTR', 'To record official bank reference numbers and mark partner payouts settled');

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

    await performRoleLogin(page, PERSONAS.commissionApprover, '/payouts');
    await pauseForDemo(page, 1500);

    // 1. Go to "Payment Recording & Batches" tab
    await showDemoBanner(page, 'Payment Operations Tab', 'Reviewing approved payouts ready for bank dispatch');
    const paymentTab = page.getByRole('tab', { name: /Payment Recording & Batches/i });
    await humanClick(paymentTab, 1500);
    await expect(page.getByText('pay_req_001')).toBeVisible();
    await pauseForDemo(page, 1200);

    // 2. Click "Record UTR"
    await showDemoBanner(page, 'Open Record UTR', 'Opening bank transaction reference modal');
    const recordUtrBtn = page.getByRole('button', { name: /Record UTR/i });
    await expect(recordUtrBtn).toBeVisible();
    await humanClick(recordUtrBtn, 1500);

    // 3. Test validation: empty UTR submission
    await showDemoBanner(page, 'Empty UTR Validation', 'Testing required bank reference field validation');
    const utrInput = page.locator('input[data-testid="payment.utr"]');
    await utrInput.fill('');
    const submitPaymentBtn = page.locator('button[data-testid="payment.submit"]');
    await humanClick(submitPaymentBtn, 1500);
    await expect(page.getByText('Bank reference (UTR) is required.').first()).toBeVisible();
    await pauseForDemo(page, 1500);

    // 4. Fill valid UTR and submit
    await showDemoBanner(page, 'Fill Valid UTR', 'Recording transaction UTR9876543210');
    await humanType(utrInput, 'UTR9876543210');
    await pauseForDemo(page, 1200);
    await humanClick(submitPaymentBtn, 2000);

    // 5. Verify success toast / feedback
    await showDemoBanner(page, 'Payment Recorded', 'Settlement confirmed & encrypted NEFT/RTGS batch generated');
    await expect(page.getByText(/Payment recorded for payout/i)).toBeVisible();
    await pauseForDemo(page, 2500);
    await performRoleLogout(page);
  });

  test('TC-FIN-04: Commission Plan Maker-Checker Dual Control (SOD-02)', async ({ page }) => {
    // Session as Commission Approver (Independent Checker)
    await showDemoBanner(page, 'Governing Commission Plans Dual Control', 'To ensure lender commission schemes require independent checker sign-off before activation');

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

    await performRoleLogin(page, PERSONAS.commissionApprover, '/commission');
    await pauseForDemo(page, 1500);

    // 1. Verify Commission Dashboard loaded
    await showDemoBanner(page, 'Commission Hub Loaded', 'Reviewing lender plans with maker-checker governance');
    await expect(page.getByText('Commission Management Hub')).toBeVisible();
    await expect(page.getByText('HDFC Bank').first()).toBeVisible();
    await expect(page.getByText('rset_hl_01').first()).toBeVisible();
    await pauseForDemo(page, 1200);

    // 2. Checker (usr_cfo_01) sees enabled "Approve (SOD-02)" button
    await showDemoBanner(page, 'Independent Plan Review', 'Checker authorizing draft commission plan under SOD-02');
    const approveBtn = page.getByRole('button', { name: /Approve \(SOD-02\)/i });
    await expect(approveBtn).toBeVisible();
    await expect(approveBtn).toBeEnabled();
    await humanClick(approveBtn, 2000);

    // 3. Verify success message and ACTIVE state transition
    await showDemoBanner(page, 'Commission Plan ACTIVE', 'Plan approved and active for tranche calculations');
    await expect(page.getByText(/approved and marked ACTIVE/i)).toBeVisible();
    await pauseForDemo(page, 2500);
    await performRoleLogout(page);
  });
});
