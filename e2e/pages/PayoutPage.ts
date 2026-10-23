import { BasePage } from './BasePage';

/**
 * PayoutPage encapsulates partner payout requests, SOD-03 maker lockout,
 * independent dual-control approval, and encrypted banking UTR settlements.
 */
export class PayoutPage extends BasePage {
  readonly approvalQueueTab = this.page.getByRole('tab', { name: /Approval Queue/i });
  readonly paymentRecordingTab = this.page.getByRole('tab', { name: /Payment Recording & Batches/i });

  readonly reviewAndDecideBtn = this.page.getByRole('button', { name: /Review & Decide \(SOD-03\)/i });
  readonly decisionCommentInput = this.page.getByLabel(/Decision Justification|Comment/i);
  readonly confirmApprovedBtn = this.page.getByRole('button', { name: /Confirm APPROVED/i });

  readonly openRecordUtrBtn = this.page.getByRole('button', { name: /Record UTR/i });
  readonly utrInput = this.page.locator('input[data-testid="payment.utr"]');
  readonly submitPaymentBtn = this.page.locator('button[data-testid="payment.submit"]');

  async switchToApprovalQueue(): Promise<void> {
    await this.click(this.approvalQueueTab, 1200);
  }

  async switchToPaymentTab(): Promise<void> {
    await this.click(this.paymentRecordingTab, 1200);
  }

  async approvePayout(comment: string): Promise<void> {
    await this.click(this.reviewAndDecideBtn, 1200);
    if (await this.decisionCommentInput.isVisible()) {
      await this.type(this.decisionCommentInput, comment);
      await this.pause(800);
    }
    await this.click(this.confirmApprovedBtn, 1800);
  }

  async recordUtr(utr: string): Promise<void> {
    await this.click(this.openRecordUtrBtn, 1200);
    await this.utrInput.fill('');
    await this.type(this.utrInput, utr);
    await this.pause(800);
    await this.click(this.submitPaymentBtn, 1800);
  }
}
