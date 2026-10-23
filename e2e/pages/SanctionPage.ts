import { BasePage } from './BasePage';

export interface SanctionData {
  amount: string;
  tenureMonths: string;
  rateValue: string;
}

export interface TrancheData {
  amount: string;
  utr: string;
  loanAccount: string;
}

/**
 * SanctionPage encapsulates lender case sanction term sheets, rate parameters,
 * disbursement tranche recording, and SOD-04 dual-control verification locks.
 */
export class SanctionPage extends BasePage {
  readonly sanctionsPanel = this.page.locator('[data-testid="sanctions-panel"]');
  readonly openRecordSanctionBtn = this.page.locator('[data-testid="record-sanction-btn"]');
  readonly sanctionAmountInput = this.page.locator('input[data-testid="sanction.amount"]');
  readonly sanctionTenureInput = this.page.locator('input[data-testid="sanction.tenureMonths"]');
  readonly sanctionRateInput = this.page.locator('input[data-testid="sanction.rateValue"]');
  readonly saveSanctionBtn = this.page.locator('button[data-testid="sanction.save-btn"]');

  readonly openRecordTrancheBtn = this.page.locator('[data-testid="record-tranche-btn"]');
  readonly trancheAmountInput = this.page.locator('input[data-testid="tranche.amount"]');
  readonly trancheUtrInput = this.page.locator('input[data-testid="tranche.utr"]');
  readonly trancheLoanAccountInput = this.page.locator('input[data-testid="tranche.loanAccount"]');
  readonly saveTrancheBtn = this.page.locator('button[data-testid="tranche.save-btn"]');

  getVerifyTrancheBtn(trancheId: string) {
    return this.page.locator(`[data-testid="verify-tranche-btn-${trancheId}"]`);
  }

  async recordSanction(data: SanctionData, delayMs = 2000): Promise<void> {
    await this.click(this.openRecordSanctionBtn, 1200);
    await this.sanctionAmountInput.fill('');
    await this.type(this.sanctionAmountInput, data.amount);
    await this.sanctionTenureInput.fill('');
    await this.type(this.sanctionTenureInput, data.tenureMonths);
    await this.sanctionRateInput.fill('');
    await this.type(this.sanctionRateInput, data.rateValue);
    await this.pause(800);
    await this.click(this.saveSanctionBtn, delayMs);
  }

  async recordTranche(data: TrancheData, delayMs = 2000): Promise<void> {
    await this.click(this.openRecordTrancheBtn, 1200);
    await this.trancheAmountInput.fill('');
    await this.type(this.trancheAmountInput, data.amount);
    await this.type(this.trancheUtrInput, data.utr);
    await this.type(this.trancheLoanAccountInput, data.loanAccount);
    await this.pause(800);
    await this.click(this.saveTrancheBtn, delayMs);
  }
}
