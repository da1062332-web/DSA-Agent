import { BasePage } from './BasePage';

/**
 * RuleEditorPage encapsulates business rules engine (BRE) definition tables,
 * AST syntax validation, safe sandbox simulation, maker submission, and SOD-01 checker approvals.
 */
export class RuleEditorPage extends BasePage {
  readonly definitionEditor = this.page.locator('textarea').first();
  readonly saveDraftBtn = this.page.getByRole('button', { name: /Save Draft/i });

  readonly simulateBtn = this.page.getByRole('button', { name: /Simulate \/ Test/i });
  readonly runSimulationBtn = this.page.getByRole('button', { name: /Run Simulation/i });
  readonly closeSimulationBtn = this.page.getByRole('button', { name: /Close/i });

  readonly validateAstBtn = this.page.getByRole('button', { name: /^Validate$/i });
  readonly submitForReviewBtn = this.page.getByRole('button', { name: /Submit for Review/i });

  readonly submitModal = this.page.getByRole('dialog');
  readonly submitReasonInput = this.submitModal.getByLabel(/Submission Notes/i);
  readonly confirmSubmitBtn = this.submitModal.getByRole('button', { name: /Submit Version/i });

  readonly reviewApproveBtn = this.page.getByRole('button', { name: /Review \/ Approve \(SOD-01\)/i });
  readonly reviewerCommentsInput = this.page.getByLabel(/Reviewer Comments/i);
  readonly confirmApproveBtn = this.page.getByRole('button', { name: /Confirm APPROVE/i });
  readonly publishBtn = this.page.getByRole('button', { name: /Publish Version/i });

  async saveDefinition(jsonText: string): Promise<void> {
    await this.definitionEditor.fill(jsonText);
    await this.pause(800);
    await this.click(this.saveDraftBtn, 1500);
  }

  async runSimulation(): Promise<void> {
    await this.click(this.simulateBtn, 1200);
    await this.click(this.runSimulationBtn, 1500);
  }

  async closeSimulation(): Promise<void> {
    await this.click(this.closeSimulationBtn, 800);
  }

  async validateAST(): Promise<void> {
    await this.click(this.validateAstBtn, 1200);
  }

  async submitForReview(notes: string): Promise<void> {
    await this.click(this.submitForReviewBtn, 1200);
    await this.type(this.submitReasonInput, notes);
    await this.pause(800);
    await this.click(this.confirmSubmitBtn, 1800);
  }

  async approveRuleVersion(comments: string): Promise<void> {
    await this.click(this.reviewApproveBtn, 1200);
    await this.type(this.reviewerCommentsInput, comments);
    await this.pause(800);
    await this.click(this.confirmApproveBtn, 1800);
  }
}
