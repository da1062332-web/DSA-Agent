// API-INT-006 POST /public/v1/webhooks/{provider}/{connectionPathId} (MOD-INT, Module 35; M-076). A generic inbound provider
// webhook. Nothing in the request is trusted until it is verified:
//   - the connection comes from public_entry_index (resolve_public_entry), and must be ACTIVE for that provider;
//   - X-Webhook-Signature is v1=HMAC-SHA256(connection signing secret, X-Webhook-Timestamp + '.' + raw body);
//   - X-Webhook-Timestamp must be within 5 minutes of now;
//   - X-Webhook-Id is accepted once per tenant and provider (a repeat answers 200 with duplicate: true).
// The payload is kept in inbound_webhook and announced as integration.webhook_received, in one transaction.
// Messaging delivery callbacks keep their own path (API-MSG-005).
import crypto from 'node:crypto';
import { AppError, type RequestContext } from '@dsa/contracts';
import express, { type Router } from 'express';
import { sql } from 'kysely';
import type { ApiDeps } from '../types';

const MAX_SKEW_SECONDS = 300;

const serviceCtx = (tenantId: string): RequestContext => ({
  principal: {
    kind: 'SERVICE',
    id: 'SYSTEM:inbound-webhook',
    tenantId,
    primaryBranchId: null,
    managedTeamMemberIds: [],
    queueIds: [],
    grants: [],
    authTime: null,
  },
  correlationId: `iwh_${crypto.randomUUID()}`,
  now: new Date(),
});

const unauthorised = () => AppError.of('UNAUTHENTICATED', 'The webhook could not be verified.');

export function verifyInboundSignature(
  secret: string,
  timestamp: string,
  raw: Buffer,
  signature: string,
): boolean {
  const expected = Buffer.from(
    `v1=${crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex')}`,
  );
  const given = Buffer.from(signature);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export function createPublicIntegrationWebhookRouter(deps: ApiDeps): Router {
  const router = express.Router();
  router.post('/webhooks/:provider/:connectionPathId', async (req, res) => {
    const provider = String(req.params.provider);
    const pathId = String(req.params.connectionPathId);
    const raw =
      (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const timestamp = req.get('x-webhook-timestamp') ?? '';
    const signature = req.get('x-webhook-signature') ?? '';
    const eventId = req.get('x-webhook-id') ?? '';
    if (!/^\d{9,11}$/.test(timestamp) || !signature || !eventId || eventId.length > 200) throw unauthorised();
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) throw unauthorised();

    const entry = await deps.txRunner.withTenantTx(
      serviceCtx('SYSTEM'),
      async (tx) =>
        (
          await sql<{
            tenant_id: string;
            provider: string;
            connection_id: string;
            signing_secret: string | null;
          }>`
          select * from app.resolve_public_entry(${pathId})`.execute(tx)
        ).rows[0],
    );
    // Unknown connection, other provider, no secret or a bad signature all look the same to the caller.
    if (!entry || entry.provider !== provider || !entry.signing_secret) throw unauthorised();
    if (!verifyInboundSignature(entry.signing_secret, timestamp, raw, signature)) throw unauthorised();

    const ctx = serviceCtx(entry.tenant_id);
    const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const id = deps.ids.next('iwh');
      const inserted = await sql<{ id: string }>`
        insert into inbound_webhook (id, tenant_id, provider, connection_id, provider_event_id, payload)
        values (${id}, ${entry.tenant_id}, ${provider}, ${entry.connection_id}, ${eventId}, ${JSON.stringify(req.body ?? {})}::jsonb)
        on conflict (tenant_id, provider, provider_event_id) do nothing
        returning id`.execute(tx);
      if (!inserted.rows[0]) return { duplicate: true };
      await sql`
        insert into outbox_event (id, tenant_id, event_type, event_version, subject_type, subject_id, payload,
                                  correlation_id, chain_depth, created_at)
        values (${deps.ids.next('evt')}, ${entry.tenant_id}, 'integration.webhook_received', 1, 'INTEGRATION', ${entry.connection_id},
                ${JSON.stringify({ inboundWebhookId: id, provider, providerEventId: eventId })}::jsonb, ${ctx.correlationId}, 0, ${ctx.now})`.execute(
        tx,
      );
      return { duplicate: false };
    });
    res.status(200).json({ received: true, ...result });
  });
  return router;
}
