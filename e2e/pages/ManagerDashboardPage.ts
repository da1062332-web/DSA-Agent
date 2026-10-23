import { BasePage } from './BasePage';

/**
 * ManagerDashboardPage encapsulates branch and team management hubs,
 * pipeline monitoring, unassigned lead queues, and workload allocation.
 */
export class ManagerDashboardPage extends BasePage {
  readonly dashboard = this.page.getByTestId('manager-dashboard');
  readonly hubHeading = this.page.getByText('Branch & Team Management Hub');
}
