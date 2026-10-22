import { test, expect } from '@playwright/test';
import { PERSONAS, setupPersonaSession } from './helpers/mock-session';

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
  };

  test('TC-FIN-01: Finance Executive proposes payout request and verifies Maker SOD-03 lock', async ({ page }) => {
    await setupPersonaSession(page, PERSONAS.financeExec);

    // Mock payout requests
    await page.route('**/v1/payout-requests**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [mockPayoutRequest], meta: { total: 1 } }),
      });
    });

    await page.goto('/payouts');

    // 1. Verify Payout Dashboard loaded
    await expect(page.getByText('Payouts & Settlement Hub')).toBeVisible();
    await expect(page.getByText('pay_req_001')).toBeVisible();

    // 2. Check tab "Approval Queue"
    await page.getByRole('tab', { name: /Approval Queue/i }).click();

    // 3. SOD-03: Maker (usr_finance_01) CANNOT approve own payout request!
    const approveBtn = page.getByRole('button', { name: /Review & Decide \(SOD-03\)/i });
    await expect(approveBtn).toBeVisible();
    await expect(approveBtn).toBeDisabled();
  });

  test('TC-FIN-02: Commission Approver authorizes payout and records bank UTR with validation', async ({ page }) => {
    await setupPersonaSession(page, PERSONAS.commissionApprover);

    const approvedRequest = {
      ...mockPayoutRequest,
      status: 'APPROVED',
      approvedBy: 'usr_cfo_01',
    };

    // Mock approval and payment recording
    await page.route('**/v1/payout-requests**', async (route) => {
      const url = route.request().url();
      if (url.includes('/pay_req_001/payment')) {
        approvedRequest.status = 'PAYMENT_RECORDED';
        approvedRequest.paymentRefMasked = 'UTR***5678';
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

    await page.goto('/payouts');

    // 1. Go to "Payment Recording & Batches" tab
    await page.getByRole('tab', { name: /Payment Recording & Batches/i }).click();
    await expect(page.getByText('pay_req_001')).toBeVisible();

    // 2. Click "Record UTR"
    const recordUtrBtn = page.getByRole('button', { name: /Record UTR/i });
    await expect(recordUtrBtn).toBeVisible();
    await recordUtrBtn.click();

    // 3. Test validation: empty UTR submission
    const utrInput = page.locator('input[data-testid="payment.utr"]');
    await utrInput.fill('');
    const submitPaymentBtn = page.locator('button[data-testid="payment.submit"]');
    await submitPaymentBtn.click();
    await expect(page.getByText('Bank reference (UTR) is required.').first()).toBeVisible();

    // 4. Fill valid UTR and submit
    await utrInput.fill('UTR9876543210');
    await submitPaymentBtn.click();

    // 5. Verify success toast / feedback
    await expect(page.getByText(/Payment recorded for payout/i)).toBeVisible();
  });
});
