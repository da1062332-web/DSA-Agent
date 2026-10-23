import { BasePage } from './BasePage';

/**
 * PlatformAdminPage encapsulates the multi-tenant platform operator console,
 * feature flags registry, background jobs queue monitor, and system health checks.
 */
export class PlatformAdminPage extends BasePage {
  readonly heading = this.page.getByText('Platform Operations');
  readonly tenantsTab = this.page.getByRole('tab', { name: /Tenants|Tenant Directory/i });
  readonly flagsTab = this.page.getByRole('tab', { name: /Feature Flags/i });
  readonly jobsTab = this.page.getByRole('tab', { name: /Background Jobs/i });
  readonly zeroBusinessDataBanner = this.page.getByText(/Zero Business Data Projection/i);

  async switchToFlagsTab(): Promise<void> {
    await this.click(this.flagsTab, 1200);
  }

  async switchToJobsTab(): Promise<void> {
    await this.click(this.jobsTab, 1200);
  }

  async switchToTenantsTab(): Promise<void> {
    await this.click(this.tenantsTab, 1200);
  }
}
