// Fake UserDirectoryPort (Contracts §4.5): in-memory maps seeded by the test; pickRoundRobin cycles the seeded list.
import { AppError, type Tx } from '../kernel';
import type { DirectoryQueue, DirectoryUser, UserDirectoryPort } from '../ports/crm-ports';

export class FakeUserDirectoryPort implements UserDirectoryPort {
  /** Keyed by userId. */
  readonly users = new Map<string, DirectoryUser>();
  /** Keyed by queueId. */
  readonly queues = new Map<string, DirectoryQueue>();
  /** Keyed by `${branchId}:${kind}` → queueId. */
  readonly branchQueues = new Map<string, string>();
  /** Keyed by queueId → member userIds, picked in order. */
  readonly roundRobinMembers = new Map<string, string[]>();
  private readonly cursors = new Map<string, number>();

  async getUser(_tx: Tx, userId: string): Promise<DirectoryUser | null> {
    return this.users.get(userId) ?? null;
  }

  async getQueue(_tx: Tx, queueId: string): Promise<DirectoryQueue | null> {
    return this.queues.get(queueId) ?? null;
  }

  async findBranchQueue(
    _tx: Tx,
    branchId: string,
    kind: 'INTAKE' | 'UNASSIGNED',
  ): Promise<{ queueId: string }> {
    const queueId = this.branchQueues.get(`${branchId}:${kind}`);
    if (!queueId) throw AppError.of('NOT_FOUND', `No ${kind} queue seeded for branch ${branchId}`);
    return { queueId };
  }

  async pickRoundRobin(_tx: Tx, queueId: string): Promise<{ userId: string } | null> {
    const members = this.roundRobinMembers.get(queueId) ?? [];
    if (members.length === 0) return null;
    const cursor = this.cursors.get(queueId) ?? 0;
    this.cursors.set(queueId, (cursor + 1) % members.length);
    const userId = members[cursor % members.length];
    return userId ? { userId } : null;
  }
}
