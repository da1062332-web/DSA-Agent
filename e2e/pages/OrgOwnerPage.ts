import { BasePage } from './BasePage';

/**
 * OrgOwnerPage encapsulates executive overview metrics, portfolio visibility,
 * and channel partner / connector directory governance.
 */
export class OrgOwnerPage extends BasePage {
  readonly leadsCrmHeading = this.page.getByRole('heading', { name: 'Leads & CRM' });
  readonly loanAppsHeading = this.page.getByRole('heading', { name: 'Loan Applications' });
  readonly commandCenterHeading = this.page.getByText('Organisation Owner Command Center');
  readonly pipelineFunnelHeading = this.page.getByText('Organisation Origination Pipeline');
  readonly originationsHeading = this.page.getByText('Total Originations');

  async gotoConnectors(): Promise<void> {
    await this.goto('/connectors');
  }
}
