import { BasePage } from './BasePage';

/**
 * CustomerPortalPage encapsulates the customer secure document upload portal,
 * phone identity verification, OTP challenge gating, and file upload validation.
 */
export class CustomerPortalPage extends BasePage {
  readonly portalHeader = this.page.getByText('DSA Loan Portal');
  readonly identityVerificationHeader = this.page.getByText('Two-Step Identity Verification');
  readonly otpInput = this.page.getByPlaceholder('123456');
  readonly verifyOtpBtn = this.page.getByRole('button', { name: /Verify Code & Access/i });

  readonly uploadPortalHeading = this.page.getByText('Document Upload Portal');
  readonly checklistHeading = this.page.getByText('Requested Documents Checklist');
  readonly fileInput = this.page.locator('#public-file-input');
  readonly uploadBtn = this.page.getByRole('button', { name: /Upload Document/i });

  async verifyOtp(code: string, delayMs = 1800): Promise<void> {
    await this.otpInput.fill('');
    await this.type(this.otpInput, code);
    await this.pause(600);
    await this.click(this.verifyOtpBtn, delayMs);
  }

  async attachFile(name: string, mimeType: string, content: string | Buffer): Promise<void> {
    await this.fileInput.setInputFiles({
      name,
      mimeType,
      buffer: typeof content === 'string' ? Buffer.from(content) : content,
    });
    await this.pause(800);
  }

  async submitUpload(delayMs = 2000): Promise<void> {
    await this.click(this.uploadBtn, delayMs);
  }
}
