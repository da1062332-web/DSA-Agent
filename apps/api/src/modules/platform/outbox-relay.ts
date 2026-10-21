// Outbox relay (owner: Dev 1; ENT-108, TASK-105). Modules write events with OutboxPort in the same transaction as their change;
// this publishes them. For each waiting event, in that event's own tenant:
//   1. lock the row (FOR UPDATE SKIP LOCKED, so two API instances never publish one event twice at the same time);
//   2. hand it to every subscriber (automation triggers today). Subscribers are idempotent per event id, so a crash between
//      delivery and step 3 only causes a harmless redelivery;
//   3. mark it published. If a subscriber throws, the attempt and the error are recorded instead, and after MAX_ATTEMPTS the
//      event is parked (dead_lettered_at) so one bad event cannot hold up the rest.
// Discovery across tenants goes through app.pending_outbox_events (M-067), which answers only this SYSTEM context.
import type { DomainEventEnvelope, RequestContext, Tx, TxRunner } from '@dsa/contracts';
import { sql } from 'kysely';

export const RELAY_IDENTITY = 'SYSTEM:outbox-relay';
export const RELAY_DISCOVERY_TENANT = 'SYSTEM';
export const MAX_ATTEMPTS = 5;

export type OutboxSubscriber = (ctx: RequestContext, event: DomainEventEnvelope) => Promise<unknown>;

export type RelayOutcome =
  | { id: string; tenantId: string; outcome: 'PUBLISHED' }
  | { id: string; tenantId: string; outcome: 'FAILED' | 'DEAD_LETTERED'; reason: string }
  | { id: string; tenantId: string; outcome: 'SKIPPED' };

interface OutboxRow {
  id: string;
  tenant_id: string;
  event_type: string;
  event_version: number;
  subject_type: string;
  subject_id: string;
  payload: Record<string, unknown>;
  correlation_id: string;
  causation_id: string | null;
  chain_depth: number;
  created_at: Date;
  publish_attempts: number;
}

export const relayContext = (tenantId: string, correlationId: string, now: Date): RequestContext => ({
  principal: {
    kind: 'SERVICE',
    id: RELAY_IDENTITY,
    tenantId,
    primaryBranchId: null,
    managedTeamMemberIds: [],
    queueIds: [],
    grants: [],
    authTime: null,
  },
  correlationId,
  now,
});

const reasonOf = (err: unknown): string =>
  (err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error').slice(0, 500);

export class OutboxRelay {
  constructor(
    private readonly deps: { txRunner: TxRunner; subscribers: OutboxSubscriber[]; clock?: () => Date },
  ) {}

  private now(): Date {
    return this.deps.clock ? this.deps.clock() : new Date();
  }

  /** Publishes up to `limit` waiting events, oldest first. */
  async drain(limit = 50): Promise<RelayOutcome[]> {
    const waiting = await this.deps.txRunner.withTenantTx(
      relayContext(RELAY_DISCOVERY_TENANT, 'outbox_relay_discovery', this.now()),
      async (tx) =>
        (
          await sql<{ tenant_id: string; id: string }>`
            SELECT tenant_id, id FROM app.pending_outbox_events(${limit})`.execute(tx)
        ).rows,
    );
    const outcomes: RelayOutcome[] = [];
    for (const item of waiting) outcomes.push(await this.publishOne(item.tenant_id, item.id));
    return outcomes;
  }

  async publishOne(tenantId: string, id: string): Promise<RelayOutcome> {
    const ctx = relayContext(tenantId, `outbox_relay_${id}`, this.now());
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const row = await lock(tx, id);
      if (!row) return { id, tenantId, outcome: 'SKIPPED' } as const;
      const event = toEnvelope(row);
      try {
        // Subscribers open their own transactions; this one only holds the lock on the outbox row.
        for (const subscriber of this.deps.subscribers) {
          await subscriber(relayContext(tenantId, row.correlation_id, ctx.now), event);
        }
      } catch (err) {
        const reason = reasonOf(err);
        const attempts = row.publish_attempts + 1;
        const parked = attempts >= MAX_ATTEMPTS;
        await sql`
          UPDATE app.outbox_event
             SET publish_attempts = ${attempts}, last_publish_error = ${reason},
                 dead_lettered_at = ${parked ? ctx.now : null}
           WHERE id = ${id}`.execute(tx);
        return { id, tenantId, outcome: parked ? 'DEAD_LETTERED' : 'FAILED', reason } as const;
      }
      await sql`
        UPDATE app.outbox_event SET published_at = ${ctx.now}, publish_attempts = ${row.publish_attempts + 1},
               last_publish_error = null
         WHERE id = ${id}`.execute(tx);
      return { id, tenantId, outcome: 'PUBLISHED' } as const;
    });
  }
}

async function lock(tx: Tx, id: string): Promise<OutboxRow | null> {
  const r = await sql<OutboxRow>`
    SELECT * FROM app.outbox_event
     WHERE id = ${id} AND published_at IS NULL AND dead_lettered_at IS NULL AND discarded_at IS NULL
     FOR UPDATE SKIP LOCKED`.execute(tx);
  return r.rows[0] ?? null;
}

function toEnvelope(row: OutboxRow): DomainEventEnvelope {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.event_type,
    version: row.event_version,
    subject: { type: row.subject_type, id: row.subject_id },
    data: row.payload,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    chainDepth: row.chain_depth,
    occurredAt: new Date(row.created_at).toISOString(),
  } as DomainEventEnvelope;
}
