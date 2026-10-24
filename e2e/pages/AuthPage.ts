import { BasePage } from './BasePage';
import {
  performRoleLogin,
  performRoleLogout,
  type PersonaConfig,
} from '../helpers/mock-session';

/**
 * AuthPage encapsulates sign-in, MFA OTP step-up, and clean role sign-out.
 */
export class AuthPage extends BasePage {
  readonly emailInput = this.page.locator('[data-testid="auth.email"]');
  readonly passwordInput = this.page.locator('[data-testid="auth.password"]');
  readonly submitBtn = this.page.locator('[data-testid="auth.submit"]');
  readonly mfaCodeInput = this.page.locator('[data-testid="mfa.code"], [data-testid="auth.mfa.code"]');
  readonly mfaSubmitBtn = this.page.locator('[data-testid="mfa.submit"], [data-testid="auth.mfa.submit"]');
  readonly accountBtn = this.page.locator('[data-testid="shell.account"]');
  readonly signOutBtn = this.page.locator('[data-testid="shell.signout"]');

  // Step-up dialog (apps/web/src/auth/StepUpProvider.tsx), opened when the API answers 401 STEP_UP_REQUIRED
  readonly stepUpDialog = this.page.getByRole('dialog', { name: /Confirm it.s you/ });
  readonly stepUpCodeInput = this.page.locator('[data-testid="auth.stepup.code"]');
  readonly stepUpSubmitBtn = this.page.locator('[data-testid="auth.stepup.submit"]');
  readonly stepUpCancelBtn = this.stepUpDialog.getByRole('button', { name: 'Cancel' });

  /** Completes the step-up dialog with a TOTP code (000000 is the test bypass code). */
  async completeStepUp(code = '000000'): Promise<void> {
    await this.type(this.stepUpCodeInput, code);
    await this.click(this.stepUpSubmitBtn, 1500);
  }

  /** Perform full interactive role login with 2FA step-up */
  async loginAs(persona: PersonaConfig, targetPath = '/', password = 'Qloax@DSA#2026'): Promise<void> {
    await performRoleLogin(this.page, persona, targetPath, password);
  }

  /** Sign out cleanly from current session */
  async logout(): Promise<void> {
    await performRoleLogout(this.page);
  }
}
