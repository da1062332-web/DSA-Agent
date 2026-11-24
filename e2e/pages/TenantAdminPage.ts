import { BasePage } from './BasePage';

/**
 * TenantAdminPage encapsulates tenant-level staff user management,
 * role catalogues, permission matrices, and administrative scoping.
 */
export class TenantAdminPage extends BasePage {
  readonly searchInput = this.page.getByPlaceholder(/Search/i);
  readonly userManagementHeading = this.page.getByRole('heading', { name: 'User Management' });
  readonly accessControlHeading = this.page.getByRole('heading', { name: 'Access Control' });
  readonly branchesHeading = this.page.getByRole('heading', { name: 'Branches' });
  readonly queuesHeading = this.page.getByRole('heading', { name: 'Work queues' });

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

  async gotoBranches(): Promise<void> {
    await this.goto('/admin/branches');
  }

  async gotoQueues(): Promise<void> {
    await this.goto('/admin/queues');
  }
}
