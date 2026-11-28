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

  // ===========================================================================
  // P2-01 / TASK-141: the lender's payout grid (commission plan slabs)
  // ===========================================================================

  /** Opens the Rate Slabs tab of the commission hub. */
  async openSlabTab(delayMs = 1000): Promise<void> {
    await this.click(this.page.getByRole('tab', { name: /Rate Slabs/i }), delayMs);
  }

  /**
   * Picks which plan's grid to show. The option reads "<lender> — <status>".
   * Driven by role, not by test id: on a MUI select the test id sits on the hidden value input, and the
   * element that opens the menu is the combobox beside it.
   */
  async selectSlabPlan(lenderName: string, delayMs = 900): Promise<void> {
    await this.click(this.page.getByRole('combobox', { name: /Commission plan/i }), delayMs);
    await this.pickOption(lenderName, delayMs);
  }

  /**
   * Adds one volume band. The rate is typed the way a rate card is written — "1.25" for 1.25% — and the
   * screen converts it to the basis points the API takes. An empty volumeTo means the open-ended top band.
   */
  async addSlabBand(band: {
    volumeFrom: string;
    volumeTo: string;
    ratePercent: string;
  }): Promise<void> {
    await this.page.getByTestId('commission.slab-volume-from').fill(band.volumeFrom);
    await this.page.getByTestId('commission.slab-volume-to').fill(band.volumeTo);
    await this.page.getByTestId('commission.slab-rate-percent').fill(band.ratePercent);
    await this.click(this.page.getByTestId('commission.slab-add'), 1500);
  }

  /** Asks the grid what a month at this volume would pay. Reads nothing back — the caller asserts on the result. */
  async previewSlab(monthlyVolume: string, delayMs = 1500): Promise<void> {
    await this.page.getByTestId('commission.slab-preview-volume').fill(monthlyVolume);
    await this.click(this.page.getByTestId('commission.slab-preview'), delayMs);
  }

  /** Picks the lender in the Generate lender invoice dialog on the Invoices screen. Role, as above. */
  async selectLenderForInvoice(lenderName: string, delayMs = 900): Promise<void> {
    await this.click(this.page.getByRole('combobox', { name: /Lender/i }), delayMs);
    await this.pickOption(lenderName, delayMs);
  }

  /**
   * Clicks an option in an open MUI menu, waiting a bounded time for it to appear. A plain click would inherit
   * the whole test's timeout, so an empty menu costs ten minutes and reports the click, not the empty list.
   */
  private async pickOption(name: string, delayMs = 900): Promise<void> {
    const option = this.page.getByRole('option', { name: new RegExp(name, 'i') });
    await option.waitFor({ state: 'visible', timeout: 10_000 });
    await this.click(option, delayMs);
  }
}
