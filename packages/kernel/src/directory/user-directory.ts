// UserDirectoryPort (Contracts §4.5) — owner: Dev 1 — TASK-104 / TASK-435.
// Read-only view of users and queues for other modules, plus round-robin assignment. Only pickRoundRobin
// writes work_queue.routing_state, under SELECT … FOR UPDATE so concurrent picks never hand out the same turn.
import { AppError, type DirectoryQueue, type DirectoryUser, type UserDirectoryPort } from '@dsa/contracts';
import { sql } from 'kysely';

export function createUserDirectory(): UserDirectoryPort {
  return {
    async getUser(tx, userId) {
      const r = await sql<{
        id: string;
        status: DirectoryUser['status'];
        availability: DirectoryUser['availability'];
        primary_branch_id: string;
        branch_ids: string[];
      }>`
        select u.id, u.status, u.availability, u.primary_branch_id,
               array(select distinct b from unnest(array[u.primary_branch_id] || array(
                 select t.branch_id from team_membership m join team t on t.id = m.team_id
                  where m.user_id = u.id and m.effective_range @> now() and t.branch_id is not null)) b) as branch_ids
          from app_user u where u.id = ${userId}`.execute(tx);
      const u = r.rows[0];
      return u
        ? {
            userId: u.id,
            status: u.status,
            availability: u.availability,
            primaryBranchId: u.primary_branch_id,
            branchIds: u.branch_ids,
          }
        : null;
    },

    async getQueue(tx, queueId) {
      const r = await sql<{
        id: string;
        kind: string;
        branch_id: string | null;
        active: boolean;
        record_types: string[];
      }>`
        select id, kind, branch_id, active, record_types from work_queue where id = ${queueId}`.execute(tx);
      const q = r.rows[0];
      return q
        ? ({
            queueId: q.id,
            kind: q.kind,
            branchId: q.branch_id,
            active: q.active,
            recordTypes: q.record_types,
          } satisfies DirectoryQueue)
        : null;
    },

    async findBranchQueue(tx, branchId, kind) {
      const r = await sql<{ id: string }>`
        select id from work_queue where branch_id = ${branchId} and kind = ${kind} and active`.execute(tx);
      const q = r.rows[0];
      if (!q) throw AppError.of('INVALID_STATE', `The branch has no active ${kind} queue.`);
      return { queueId: q.id };
    },

    async pickRoundRobin(tx, queueId) {
      const locked = await sql<{ routing_state: { rrLastUserId?: string } }>`
        select routing_state from work_queue where id = ${queueId} and active for update`.execute(tx);
      const queue = locked.rows[0];
      if (!queue) return null;

      const members = await sql<{ user_id: string }>`
        select m.user_id from work_queue_member m join app_user u on u.id = m.user_id
         where m.queue_id = ${queueId} and m.can_pick and m.effective_range @> now()
           and u.status = 'ACTIVE' and u.availability = 'AVAILABLE'
         order by m.user_id`.execute(tx);
      if (!members.rows.length) return null;

      const ids = members.rows.map((m) => m.user_id);
      const last = queue.routing_state.rrLastUserId;
      const next = ids.find((id) => last === undefined || id > last) ?? ids[0]!;

      await sql`
        update work_queue set routing_state = routing_state || ${JSON.stringify({ rrLastUserId: next })}::jsonb
         where id = ${queueId}`.execute(tx);
      return { userId: next };
    },
  };
}
