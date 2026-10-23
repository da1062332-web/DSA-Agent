import { BasePage } from './BasePage';

/**
 * CommissionPage encapsulates lender commission plans, tranche qualification criteria,
 * and SOD-02 maker-checker governance before scheme activation.
 */
export class CommissionPage extends BasePage {
  readonly approvePlanBtn = this.page.getByRole('button', { name: /Approve \(SOD-02\)/i });

  async approvePlan(delayMs = 1800): Promise<void> {
    await this.click(this.approvePlanBtn, delayMs);
  }
}
