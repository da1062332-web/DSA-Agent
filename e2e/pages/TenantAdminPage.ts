import { BasePage } from './BasePage';

/**
 * TenantAdminPage encapsulates tenant-level staff user management,
 * role catalogues, permission matrices, and administrative scoping.
 */
export class TenantAdminPage extends BasePage {
  readonly searchInput = this.page.getByPlaceholder(/Search/i);
  readonly userManagementHeading = this.page.getByRole('heading', { name: 'User Management' });
  readonly accessControlHeading = this.page.getByRole('heading', { name: 'Access Control' });

  async searchUser(query: string): Promise<void> {
    if (await this.searchInput.isVisible()) {
      await this.type(this.searchInput, query);
    }
  }

  async gotoUsers(): Promise<void> {
    await this.goto('/users');
  }

  async gotoRoles(): Promise<void> {
    await this.goto('/roles');
  }
}
