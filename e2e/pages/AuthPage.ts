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
  readonly mfaCodeInput = this.page.locator('[data-testid="auth.mfa.code"]');
  readonly mfaSubmitBtn = this.page.locator('[data-testid="auth.mfa.submit"]');
  readonly accountBtn = this.page.locator('[data-testid="shell.account"]');
  readonly signOutBtn = this.page.locator('[data-testid="shell.signout"]');

  /** Perform full interactive role login with 2FA step-up */
  async loginAs(persona: PersonaConfig, targetPath = '/', password = 'Qloax@DSA#2026'): Promise<void> {
    await performRoleLogin(this.page, persona, targetPath, password);
  }

  /** Sign out cleanly from current session */
  async logout(): Promise<void> {
    await performRoleLogout(this.page);
  }
}
