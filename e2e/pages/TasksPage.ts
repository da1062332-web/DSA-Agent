import { BasePage } from './BasePage';

/**
 * TasksPage encapsulates branch/team task list views, SLA indicators,
 * and follow-up assignment queues.
 */
export class TasksPage extends BasePage {
  async gotoTasks(): Promise<void> {
    await this.goto('/tasks');
  }
}
