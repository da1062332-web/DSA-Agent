import { BasePage } from './BasePage';

/**
 * LenderCasePage encapsulates the application workspace's lender attempts panel (MOD-LCS): package build, lender
 * submission, lender query and query response (QA plan Module 08 steps 1-6).
 */
export class LenderCasePage extends BasePage {
  readonly checklistCard = this.page.getByTestId('checklist-card');
  readonly panel = this.page.locator('[data-slot="application.lender-cases"]');

  readonly buildPackageBtn = this.panel.getByRole('button', { name: 'Build Package' });
  readonly submitBtn = this.panel.getByRole('button', { name: 'Submit', exact: true });
  readonly queryBtn = this.panel.getByRole('button', { name: 'Query', exact: true });
  readonly respondBtn = this.panel.getByRole('button', { name: 'Respond to Query' });

  readonly submitDialog = this.page.getByRole('dialog', { name: 'Submit Package to Lender' });
  readonly lenderReferenceInput = this.submitDialog.getByLabel('Lender Reference / Application Number');
  readonly confirmSubmissionBtn = this.submitDialog.getByRole('button', { name: 'Confirm Submission' });

  readonly queryDialog = this.page.getByRole('dialog', { name: 'Raise Lender Query' });
  readonly queryTextInput = this.queryDialog.getByLabel(/Query Description/);
  readonly raiseQueryBtn = this.queryDialog.getByRole('button', { name: 'Raise Query' });

  readonly responseDialog = this.page.getByRole('dialog', { name: 'Respond to Lender Query' });
  readonly responseTextInput = this.responseDialog.getByLabel(/Response Details/);
  readonly submitResponseBtn = this.responseDialog.getByRole('button', { name: 'Submit Response' });

  /** The status chip in the panel's attempts table. */
  statusChip(status: string) {
    return this.panel.getByText(status, { exact: true });
  }

  async openSubmission(lenderReference: string): Promise<void> {
    await this.click(this.submitBtn, 1200);
    await this.type(this.lenderReferenceInput, lenderReference);
    await this.click(this.confirmSubmissionBtn, 1500);
  }

  async raiseQuery(text: string): Promise<void> {
    await this.click(this.queryBtn, 1200);
    await this.type(this.queryTextInput, text);
    await this.click(this.raiseQueryBtn, 1500);
  }

  async respondToQuery(text: string): Promise<void> {
    await this.click(this.respondBtn, 1200);
    await this.type(this.responseTextInput, text);
    await this.click(this.submitResponseBtn, 1500);
  }
}
