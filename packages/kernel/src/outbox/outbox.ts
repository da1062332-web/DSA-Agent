// OutboxPort (owner: Dev 1; Contracts §4.1, ENT-108, TASK-105). The event row is written in the caller's transaction, so it
// exists exactly when the state change commits. The relay in the API's background worker publishes it afterwards.
// chain_depth counts how many events led to this one (an automation reacting to an event, and so on); the table caps it at 3,
// which stops automation loops.
import { AppError, type IdGenerator, type OutboxPort } from '@dsa/contracts';
import { sql } from 'kysely';

export const MAX_CHAIN_DEPTH = 3;

export function createOutboxPort(ids: IdGenerator): OutboxPort {
  return {
    async emit(tx, ctx, e) {
      if (!/^[a-z_]+\.[a-z_]+$/.test(e.type)) {
        throw AppError.of('VALIDATION_ERROR', `Event type '${e.type}' is not of the form module.event.`);
      }
      let depth = 0;
      if (e.causationId) {
        const parent = await sql<{ chain_depth: number }>`
          select chain_depth from outbox_event where id = ${e.causationId}`.execute(tx);
        depth = (parent.rows[0]?.chain_depth ?? 0) + 1;
        if (depth > MAX_CHAIN_DEPTH) {
          throw AppError.of('INVALID_STATE', 'This event would exceed the allowed chain depth.', [
            { issue: 'CHAIN_DEPTH_EXCEEDED', meta: { causationId: e.causationId } },
          ]);
        }
      }
      const id = ids.next('evt');
      await sql`
        insert into outbox_event (id, tenant_id, event_type, event_version, subject_type, subject_id, payload,
                                  correlation_id, causation_id, chain_depth, created_at)
        values (${id}, ${ctx.principal.tenantId}, ${e.type}, 1, ${e.subject.type}, ${e.subject.id},
                ${JSON.stringify(e.data)}::jsonb, ${ctx.correlationId}, ${e.causationId ?? null}, ${depth},
                ${ctx.now})`.execute(tx);
      return id;
    },
  };
}
