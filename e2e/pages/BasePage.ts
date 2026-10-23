import { expect, type Page, type Locator } from '@playwright/test';
import {
  humanClick,
  humanType,
  showDemoBanner,
  pauseForDemo,
} from '../helpers/mock-session';

/**
 * BasePage provides shared page capabilities, human-paced interactions,
 * action spotlight highlights, and top demonstration banners.
 */
export class BasePage {
  constructor(public readonly page: Page) {}

  /** The shell's access-denied panel (apps/web/src/shell/Forbidden.tsx), rendered instead of a screen the role may not open. */
  get forbidden(): Locator {
    return this.page.getByTestId('shell.forbidden');
  }

  /** Opens a screen the role may not use and checks the shell refuses it. */
  async expectForbidden(path: string): Promise<void> {
    await this.goto(path);
    await expect(this.forbidden).toBeVisible();
    await expect(this.forbidden).toContainText('You do not have permission to access this page.');
  }

  /** Display a high-visibility demo step banner */
  async showBanner(title: string, subtitle?: string): Promise<void> {
    await showDemoBanner(this.page, title, subtitle);
  }

  /** Pause execution for demo visualization */
  async pause(ms = 1500): Promise<void> {
    await pauseForDemo(this.page, ms);
  }

  /** Human click with visual action spotlight */
  async click(locator: Locator, delayMs = 1200): Promise<void> {
    await humanClick(locator, delayMs);
  }

  /** Human type with visual action spotlight */
  async type(locator: Locator, text: string): Promise<void> {
    await humanType(locator, text);
  }

  /** Navigate to a given route */
  async goto(path: string): Promise<void> {
    await this.page.goto(path);
    await this.page.waitForLoadState('domcontentloaded');
  }
}
