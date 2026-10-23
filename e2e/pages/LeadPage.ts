import { BasePage } from './BasePage';

export interface LeadFormData {
  fullName?: string;
  mobile?: string;
  email?: string;
  pincode?: string;
  amount?: string;
}

/**
 * LeadPage encapsulates lead intake form, validation states, duplicate surfacing,
 * lifecycle state transitions, activity logging, follow-up tasks, and atomic conversion.
 */
export class LeadPage extends BasePage {
  readonly heading = this.page.locator('h1');

  // Intake Form Locators
  readonly fullNameInput = this.page.locator('input[data-testid="lead-form.fullName"]');
  readonly mobileInput = this.page.locator('input[data-testid="lead-form.mobile"]');
  readonly emailInput = this.page.locator('input[data-testid="lead-form.email"]');
  readonly pincodeInput = this.page.locator('input[data-testid="lead-form.pincode"]');
  readonly amountInput = this.page.locator('input[data-testid="lead-form.amount"]');
  readonly submitLeadBtn = this.page.getByRole('button', { name: /Create Lead/i });

  // Lifecycle Action Locators
  readonly attemptContactBtn = this.page.locator('[data-testid="lead.action.attempt-contact"]');
  readonly inProgressBtn = this.page.locator('[data-testid="lead.action.in-progress"]');
  readonly qualifyBtn = this.page.locator('[data-testid="lead.action.qualify"]');
  readonly qualifyAmountField = this.page.locator('[data-testid="qualify.amount"] input');
  readonly qualifyIncomeField = this.page.locator('[data-testid="qualify.monthlyIncome"] input');
  readonly submitQualifyBtn = this.page.locator('[data-testid="qualify.submit"]');
  readonly convertBtn = this.page.locator('[data-testid="lead.action.convert"]');
  readonly assignBtn = this.page.locator('[data-testid="lead.action.assign"]');

  // Follow-ups, Activities & Tasks Locators
  readonly followUpsCard = this.page.locator('[data-testid="lead.follow-ups"]');
  readonly logActivityBtn = this.page.locator('[data-testid="lead.log-activity"]');
  readonly submitActivityBtn = this.page.locator('[data-testid="activity.log-form.submit"]');
  readonly addTaskBtn = this.page.locator('[data-testid="lead.add-task"]');
  readonly taskTitleInput = this.page.locator('input[data-testid="tasks.create.title"]');
  readonly submitTaskBtn = this.page.locator('[data-testid="tasks.create.submit"]');

  async fillLeadForm(data: LeadFormData): Promise<void> {
    if (data.fullName !== undefined) await this.type(this.fullNameInput, data.fullName);
    if (data.mobile !== undefined) await this.type(this.mobileInput, data.mobile);
    if (data.email !== undefined) await this.type(this.emailInput, data.email);
    if (data.pincode !== undefined) await this.type(this.pincodeInput, data.pincode);
    if (data.amount !== undefined) await this.type(this.amountInput, data.amount);
  }

  async submitLead(delayMs = 2000): Promise<void> {
    await this.click(this.submitLeadBtn, delayMs);
  }

  async attemptContact(delayMs = 1500): Promise<void> {
    await this.click(this.attemptContactBtn, delayMs);
  }

  async markInProgress(delayMs = 1500): Promise<void> {
    await this.click(this.inProgressBtn, delayMs);
  }

  async openQualifyDialog(): Promise<void> {
    await this.click(this.qualifyBtn, 1200);
  }

  async submitQualification(amount: string, monthlyIncome?: string): Promise<void> {
    if (monthlyIncome && (await this.qualifyIncomeField.isVisible())) {
      await this.type(this.qualifyIncomeField, monthlyIncome);
    }
    await this.type(this.qualifyAmountField, amount);
    await this.click(this.submitQualifyBtn, 1500);
  }

  async convertLead(delayMs = 2000): Promise<void> {
    await this.click(this.convertBtn, delayMs);
  }

  async logActivity(delayMs = 2000): Promise<void> {
    await this.click(this.logActivityBtn, 1500);
    await this.click(this.submitActivityBtn, delayMs);
  }

  async addTask(title: string, delayMs = 2000): Promise<void> {
    await this.click(this.addTaskBtn, 1500);
    await this.type(this.taskTitleInput, title);
    await this.pause(1000);
    await this.click(this.submitTaskBtn, delayMs);
  }
}
