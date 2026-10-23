import { BasePage } from './BasePage';

/**
 * CustomerConsentPage encapsulates DPDP Act compliance consent recording,
 * notice version management, evidence reference storage, and customer revocation.
 */
export class CustomerConsentPage extends BasePage {
  readonly recordNewConsentBtn = this.page.getByRole('button', { name: /\+ Record New Consent/i });
  readonly noticeVersionInput = this.page.locator('input[data-testid="consent.noticeVersion"]');
  readonly evidenceRefInput = this.page.locator('input[data-testid="consent.evidenceRef"]');
  readonly submitConsentBtn = this.page.locator('[data-testid="consent.submit"]');
  readonly withdrawBtn = this.page.getByRole('button', { name: 'Withdraw' });

  async recordConsent(noticeVersion: string, evidenceRef: string): Promise<void> {
    await this.click(this.recordNewConsentBtn, 1200);
    await this.noticeVersionInput.fill('');
    await this.type(this.noticeVersionInput, noticeVersion);
    await this.type(this.evidenceRefInput, evidenceRef);
    await this.pause(800);
    await this.click(this.submitConsentBtn, 1500);
  }

  async withdrawConsent(): Promise<void> {
    await this.click(this.withdrawBtn, 1500);
  }
}
