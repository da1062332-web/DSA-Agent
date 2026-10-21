// Outbound webhooks (MOD-API, Module 36; M-076). Subscriptions and deliveries live in Postgres:
//   API-API-005 POST /v1/webhook-subscriptions   config.manage; Idempotency-Key; finance events also need finance.view.
//               The signing secret is shown once; it is stored encrypted (AES-256-GCM, key derived from the deployment secret).
//               GET /v1/webhook-subscriptions lists them, without secrets.
//   API-API-006 GET  /v1/webhook-deliveries      config.manage; cursor; the delivery log.
// Delivery: the outbox relay hands every event to createWebhookOutboxSubscriber, which records one delivery per matching
// ACTIVE subscription (once per subscription and event) and queues a job. The job POSTs outside the event's transaction with
//   X-Webhook-Id, X-Webhook-Timestamp and X-Webhook-Signature: v1=HMAC-SHA256(secret, timestamp + '.' + body)
// and retries with exponential backoff (1 minute doubling, at most 1 hour) for 24 hours; then the delivery is FAILED and the
// subscription FAILING. Receivers reject timestamps older than 5 minutes and de-duplicate by X-Webhook-Id.
import crypto from 'node:crypto';
import {
  AppError,
  CreateWebhookSubscriptionSchema,
  type DomainEventEnvelope,
  type RequestContext,
  type Tx,
} from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import type { Router } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { decodeCursor, encodeCursor, idempotencyKey, requireCtx } from '../../http/request';
import type { ApiDeps } from '../types';

export const WEBHOOK_DELIVERY_JOB = 'WEBHOOK_DELIVERY';
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 5000;

type Row = Record<string, unknown>;

export const WebhookDeliveryQuery = z.object({
  subscriptionId: z.string().optional(),
  status: z.enum(['DELIVERED', 'FAILED', 'PENDING_RETRY']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

const key = (secret: string) => crypto.createHmac('sha256', secret).update('dsa:webhook-secrets:v1').digest();

export function sealSecret(plain: string, deploymentSecret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(deploymentSecret), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function openSecret(sealed: string, deploymentSecret: string): string {
  const raw = Buffer.from(sealed, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(deploymentSecret), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

export const signWebhook = (secret: string, timestamp: number, body: string) =>
  `v1=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

/** No deliveries to the API's own network: loopback, private, link-local and metadata addresses are refused. */
export function isPrivateTarget(url: string): boolean {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80');
}

const toSubscription = (r: Row) => ({
  id: String(r.id),
  name: String(r.name),
  targetUrl: String(r.target_url),
  subscribedEvents: r.subscribed_events as string[],
  status: String(r.status),
  failureCount: Number(r.failure_count),
  version: Number(r.lock_version),
  createdAt: new Date(String(r.created_at)).toISOString(),
});

const toDelivery = (r: Row) => ({
  id: String(r.id),
  subscriptionId: String(r.subscription_id),
  eventId: String(r.event_id),
  eventType: String(r.event_type),
  status: String(r.status),
  attempt: Number(r.attempt),
  httpStatus: r.http_status === null ? null : Number(r.http_status),
  lastError: (r.last_error as string | null) ?? null,
  deliveredAt: r.delivered_at ? new Date(String(r.delivered_at)).toISOString() : null,
  nextRetryAt: r.next_retry_at ? new Date(String(r.next_retry_at)).toISOString() : null,
  createdAt: new Date(String(r.created_at)).toISOString(),
});

function requireConfig(ctx: RequestContext): void {
  if (!ctx.principal.grants.some((g) => g.code === 'config.manage')) {
    throw AppError.of('FORBIDDEN', 'Permission denied: config.manage required.');
  }
}

export function registerWebhookRoutes(router: Router, deps: ApiDeps): void {
  // API-API-005
  router.post('/webhook-subscriptions', async (req, res) => {
    const ctx = requireCtx(req);
    requireConfig(ctx);
    const k = idempotencyKey(req);
    const input = CreateWebhookSubscriptionSchema.parse(req.body);
    if (input.subscribedEvents.some((e) => /^(commission|payout|invoice|ledger|disbursement)\./.test(e))) {
      if (!ctx.principal.grants.some((g) => g.code === 'finance.view')) {
        throw AppError.of('FORBIDDEN', 'Finance events also need finance.view.');
      }
    }
    if (isPrivateTarget(input.targetUrl) && process.env.NODE_ENV === 'production') {
      throw AppError.of('VALIDATION_ERROR', 'The target must be a public HTTPS address.', [
        { field: 'targetUrl', issue: 'PRIVATE_ADDRESS' },
      ]);
    }
    const deploymentSecret = deps.documentLinkSecret;
    if (!deploymentSecret)
      throw AppError.of('DEPENDENCY_UNAVAILABLE', 'Webhook secrets cannot be stored in this deployment.');
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key: k, method: 'POST', path: '/v1/webhook-subscriptions', body: { ...input, secret: undefined } },
        async () => {
          const id = deps.ids.next('whs');
          const secret = input.secret ?? `whsec_${crypto.randomBytes(24).toString('hex')}`;
          const r = await sql<Row>`
          insert into webhook_subscription (id, tenant_id, partner_id, name, target_url, subscribed_events, secret_hash,
                                            secret_ciphertext, created_by, updated_by)
          values (${id}, ${ctx.principal.tenantId}, 'TENANT', ${input.name}, ${input.targetUrl}, ${input.subscribedEvents},
                  ${crypto.createHash('sha256').update(secret).digest('hex')}, ${sealSecret(secret, deploymentSecret)},
                  ${ctx.principal.id}, ${ctx.principal.id})
          returning *`.execute(tx);
          await deps.audit.record(tx, ctx, {
            action: 'webhook_subscription.created',
            entityType: 'WEBHOOK_SUBSCRIPTION',
            entityId: id,
            after: { targetUrl: input.targetUrl, subscribedEvents: input.subscribedEvents },
            permissionUsed: 'config.manage',
          });
          // The secret is in this one response only; a replay of the request returns it to the same caller.
          return {
            status: 201,
            body: { ...toSubscription(r.rows[0]!), signingSecret: secret },
            resourceRef: id,
          };
        },
      ),
    );
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });

  router.get('/webhook-subscriptions', async (req, res) => {
    const ctx = requireCtx(req);
    requireConfig(ctx);
    const data = await deps.txRunner.withTenantTx(ctx, async (tx) =>
      (
        await sql<Row>`select * from webhook_subscription where status <> 'REVOKED' order by created_at desc, id desc limit 200`.execute(
          tx,
        )
      ).rows.map(toSubscription),
    );
    res.json({ data, meta: { nextCursor: null, limit: 200 } });
  });

  // API-API-006
  router.get('/webhook-deliveries', async (req, res) => {
    const ctx = requireCtx(req);
    requireConfig(ctx);
    const q = WebhookDeliveryQuery.parse(req.query);
    const after = decodeCursor(q.cursor);
    const page = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<Row>`
        select * from webhook_delivery_log
         where true
           ${q.subscriptionId ? sql`and subscription_id = ${q.subscriptionId}` : sql``}
           ${q.status ? sql`and status = ${q.status}` : sql``}
           ${after ? sql`and (created_at, id) < (${after.k}::timestamptz, ${after.id})` : sql``}
         order by created_at desc, id desc
         limit ${q.limit + 1}`.execute(tx);
      const rows = r.rows.slice(0, q.limit);
      const last = rows[rows.length - 1];
      return {
        data: rows.map(toDelivery),
        meta: {
          nextCursor:
            r.rows.length > q.limit && last
              ? encodeCursor(new Date(String(last.created_at)).toISOString(), String(last.id))
              : null,
          limit: q.limit,
        },
      };
    });
    res.json(page);
  });
}

/** Outbox subscriber: one delivery per matching ACTIVE subscription, recorded once per event, then queued. */
export function createWebhookOutboxSubscriber(deps: ApiDeps) {
  return async (ctx: RequestContext, event: DomainEventEnvelope): Promise<void> => {
    if (!deps.enqueueJob) return;
    await deps.txRunner
      .withTenantTx(ctx, async (tx) => {
        const created = await sql<{ id: string }>`
        insert into webhook_delivery_log (id, tenant_id, subscription_id, event_id, event_type, payload, attempt, status, next_retry_at)
        select 'whd_' || new_ulid(), s.tenant_id, s.id, ${event.id}, ${event.type},
               ${JSON.stringify({ id: event.id, type: event.type, occurredAt: event.occurredAt, subject: event.subject, data: event.data })}::jsonb,
               1, 'PENDING_RETRY', now()
          from webhook_subscription s
         where s.status = 'ACTIVE' and ${event.type} = any(s.subscribed_events)
        on conflict (subscription_id, event_id) do nothing
        returning id`.execute(tx);
        for (const d of created.rows) {
          await deps.enqueueJob!(tx, ctx.principal.tenantId, WEBHOOK_DELIVERY_JOB, { deliveryId: d.id });
        }
      })
      // A database without M-074/M-076 (new_ulid, the delivery columns) cannot record deliveries yet. That must not fail the
      // event for every other subscriber, so the subscription is skipped; any other error still fails the delivery.
      .catch((err: { code?: string }) => {
        if (err?.code === '42883' || err?.code === '42P01' || err?.code === '42703') return;
        throw err;
      });
  };
}

/** The delivery job: one attempt, then DELIVERED, a retry later, or FAILED once the 24-hour window has passed. */
export function createWebhookDeliveryHandler(deps: ApiDeps, fetchImpl: typeof fetch = fetch) {
  return async (tx: Tx, tenantId: string, payload: Record<string, unknown>): Promise<void> => {
    const r = await sql<Row>`
      select d.*, s.target_url, s.secret_ciphertext, s.status as subscription_status
        from webhook_delivery_log d join webhook_subscription s on s.id = d.subscription_id
       where d.id = ${String(payload.deliveryId)} for update of d`.execute(tx);
    const d = r.rows[0];
    if (!d || d.status !== 'PENDING_RETRY') return;
    const finish = async (
      status: string,
      fields: { http?: number | null; error?: string | null; retryAt?: Date | null },
    ) => {
      await sql`
        update webhook_delivery_log
           set status = ${status}, http_status = ${fields.http ?? null}, last_error = ${fields.error ?? null},
               next_retry_at = ${fields.retryAt ?? null}, delivered_at = ${status === 'DELIVERED' ? new Date() : null},
               attempt = attempt + ${status === 'PENDING_RETRY' ? 1 : 0}, updated_at = now()
         where id = ${String(d.id)}`.execute(tx);
    };
    if (d.subscription_status !== 'ACTIVE' || !d.secret_ciphertext || !deps.documentLinkSecret) {
      await finish('FAILED', { error: 'SUBSCRIPTION_INACTIVE' });
      return;
    }
    const body = JSON.stringify(d.payload);
    const ts = Math.floor(Date.now() / 1000);
    const secret = openSecret(String(d.secret_ciphertext), deps.documentLinkSecret);
    let http: number | null = null;
    let error: string | null = null;
    const started = Date.now();
    try {
      const resp = await fetchImpl(String(d.target_url), {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Id': String(d.event_id),
          'X-Webhook-Timestamp': String(ts),
          'X-Webhook-Signature': signWebhook(secret, ts, body),
        },
        body,
      });
      http = resp.status;
      if (resp.status < 200 || resp.status >= 300) error = `HTTP ${resp.status}`;
    } catch (err) {
      error = (err instanceof Error ? `${err.name}: ${err.message}` : 'delivery failed').slice(0, 500);
    }
    await sql`update webhook_delivery_log set duration_ms = ${Date.now() - started} where id = ${String(d.id)}`.execute(
      tx,
    );
    if (!error) {
      await finish('DELIVERED', { http });
      await sql`update webhook_subscription set failure_count = 0 where id = ${String(d.subscription_id)}`.execute(
        tx,
      );
      return;
    }
    const age = Date.now() - new Date(String(d.created_at)).getTime();
    if (age >= RETRY_WINDOW_MS) {
      await finish('FAILED', { http, error });
      await sql`
        update webhook_subscription set status = 'FAILING', failure_count = failure_count + 1, last_failure_at = now()
         where id = ${String(d.subscription_id)} and status = 'ACTIVE'`.execute(tx);
      return;
    }
    const delayMs = Math.min(60_000 * 2 ** (Number(d.attempt) - 1), 60 * 60_000);
    const retryAt = new Date(Date.now() + delayMs);
    await finish('PENDING_RETRY', { http, error, retryAt });
    await sql`
      update webhook_subscription set failure_count = failure_count + 1, last_failure_at = now()
       where id = ${String(d.subscription_id)}`.execute(tx);
    if (deps.enqueueJob)
      await deps.enqueueJob(tx, tenantId, WEBHOOK_DELIVERY_JOB, { deliveryId: d.id }, retryAt);
  };
}
