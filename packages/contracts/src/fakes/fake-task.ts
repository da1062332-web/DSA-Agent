// packages/contracts/src/fakes/fake-task.ts — owner: Dev 6 (Gate 1 deliverable)
import type { RequestContext, Tx } from '../kernel';
import type { CreateTaskCommand, CreatedTask, TaskPort } from '../ports/task-port';

export class FakeTaskPort implements TaskPort {
  readonly commands: CreateTaskCommand[] = [];

  async createTask(
    _tx: Tx,
    _ctx: RequestContext,
    cmd: CreateTaskCommand,
  ): Promise<CreatedTask> {
    this.commands.push(cmd);
    return {
      taskId: `task_fake_${this.commands.length}`,
      dueAt: cmd.dueAt ?? new Date().toISOString(),
      slaDecisionRecordId: null,
      replayed: false,
    };
  }
}
