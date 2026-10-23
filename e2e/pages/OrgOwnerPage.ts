import { BasePage } from './BasePage';

/**
 * OrgOwnerPage encapsulates executive overview metrics, portfolio visibility,
 * and channel partner / connector directory governance.
 */
export class OrgOwnerPage extends BasePage {
  readonly leadsCrmHeading = this.page.getByRole('heading', { name: 'Leads & CRM' });
  readonly loanAppsHeading = this.page.getByRole('heading', { name: 'Loan Applications' });

  async gotoConnectors(): Promise<void> {
    await this.goto('/connectors');
  }
}
