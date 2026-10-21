// MOD-API outbound webhooks against a real database (M-076), with the production wiring: subscription with an encrypted
// secret (API-API-005), delivery log (API-API-006), signed delivery, retry and FAILING after 24 hours. Synthetic data only.
import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import {
  createWebhookDeliveryHandler,
  createWebhookOutboxSubscriber,
} from '../src/modules/partner-api/webhooks';
import { createProductionDeps } from '../src/wiring';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import { fakeAuth, testPrincipal } from './support/fake-auth';
import type { ApiDeps } from '../src/modules/types';
import type { DomainEventEnvelope, RequestContext } from '@dsa/contracts';

let env: IsolationEnv;
let deps: ApiDeps;
const SECRET = 'synthetic-deployment-secret-for-webhook-tests';

const ctxA = (): RequestContext => ({
  principal: {
    kind: 'SERVICE',
    id: 'SYSTEM:test',
    tenantId: env.A.tenantId,
    primaryBranchId: null,
    managedTeamMemberIds: [],
    queueIds: [],
    grants: [],
    authTime: null,
  },
  correlationId: 'corr_whk',
  now: new Date(),
});
const event = (id: string): DomainEventEnvelope => ({
  id,
  type: 'lead.created',
  version: 1,
  tenantId: env.A.tenantId,
  occurredAt: new Date().toISOString(),
  correlationId: 'corr_whk',
  causationId: null,
  chainDepth: 0,
  subject: { type: 'LEAD', id: 'lead_whk_1' },
  data: { leadId: 'lead_whk_1' },
});

beforeAll(async () => {
  env = await startIsolationEnv();
  deps = createProductionDeps(createTxRunner(env.db), { documentLinkSecret: SECRET });
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

const app = () =>
  createApp({
    deps,
    corsAllowedOrigins: [],
    auth: fakeAuth(
      testPrincipal({
        id: env.A.userIds[0],
        tenantId: env.A.tenantId,
        grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }],
      }),
    ),
  });

async function runJob(deliveryId: string, fetchImpl: typeof fetch) {
  const handler = createWebhookDeliveryHandler(deps, fetchImpl);
  await createTxRunner(env.db).withTenantTx(ctxA(), (tx) => handler(tx, env.A.tenantId, { deliveryId }));
}

describe('TEST-API-WHK-INT outbound webhooks', () => {
  let subscriptionId = '';
  let signingSecret = '';

  it('TEST-API-WHK-INT-01 API-API-005 stores the secret encrypted and shows it once', async () => {
    const res = await request(app())
      .post('/v1/webhook-subscriptions')
      .set('Idempotency-Key', 'whk_create_0001')
      .send({
        name: 'Partner hook',
        targetUrl: 'https://hooks.example.com/dsa',
        subscribedEvents: ['lead.created'],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    subscriptionId = res.body.id;
    signingSecret = res.body.signingSecret;
    const row = await env.admin.query(
      `select secret_ciphertext from app.webhook_subscription where id = $1`,
      [subscriptionId],
    );
    expect(row.rows[0].secret_ciphertext).toBeTruthy();
    expect(row.rows[0].secret_ciphertext).not.toContain(signingSecret);
    const list = await request(app()).get('/v1/webhook-subscriptions');
    expect(JSON.stringify(list.body)).not.toContain(signingSecret);
  });

  it('TEST-API-WHK-INT-02 an event is delivered once per subscription, signed v1=HMAC(secret, ts.body)', async () => {
    const sub = createWebhookOutboxSubscriber(deps);
    await sub(ctxA(), event('evt_whk_1'));
    await sub(ctxA(), event('evt_whk_1')); // a redelivered event does not deliver twice
    const d = await env.admin.query(`select id from app.webhook_delivery_log where event_id = 'evt_whk_1'`);
    expect(d.rows).toHaveLength(1);
    const jobs = await env.admin.query(
      `select count(*)::int as n from app.job_queue where job_type = 'WEBHOOK_DELIVERY'`,
    );
    expect(jobs.rows[0].n).toBe(1);

    let seen: { headers: Record<string, string>; body: string } | null = null;
    await runJob(d.rows[0].id, (async (_url: string, init: RequestInit) => {
      seen = { headers: init.headers as Record<string, string>, body: String(init.body) };
      return new Response(null, { status: 204 });
    }) as never);
    const h = seen!.headers;
    const expected = `v1=${crypto.createHmac('sha256', signingSecret).update(`${h['X-Webhook-Timestamp']}.${seen!.body}`).digest('hex')}`;
    expect(h['X-Webhook-Signature']).toBe(expected);
    expect(h['X-Webhook-Id']).toBe('evt_whk_1');

    const log = await request(app()).get('/v1/webhook-deliveries');
    expect(log.body.data[0]).toMatchObject({ eventId: 'evt_whk_1', status: 'DELIVERED', httpStatus: 204 });
  });

  it('TEST-API-WHK-INT-03 a failure is retried later; after 24 hours the delivery fails and the subscription is FAILING', async () => {
    await createWebhookOutboxSubscriber(deps)(ctxA(), event('evt_whk_2'));
    const d = await env.admin.query(`select id from app.webhook_delivery_log where event_id = 'evt_whk_2'`);
    const failing = (async () => new Response('down', { status: 503 })) as never;
    await runJob(d.rows[0].id, failing);
    const retry = await env.admin.query(
      `select status, attempt, next_retry_at from app.webhook_delivery_log where id = $1`,
      [d.rows[0].id],
    );
    expect(retry.rows[0]).toMatchObject({ status: 'PENDING_RETRY', attempt: 2 });
    expect(new Date(retry.rows[0].next_retry_at).getTime()).toBeGreaterThan(Date.now());

    await env.admin.query(
      `update app.webhook_delivery_log set created_at = now() - interval '25 hours' where id = $1`,
      [d.rows[0].id],
    );
    await runJob(d.rows[0].id, failing);
    const done = await env.admin.query(
      `select d.status, s.status as sub from app.webhook_delivery_log d join app.webhook_subscription s on s.id = d.subscription_id where d.id = $1`,
      [d.rows[0].id],
    );
    expect(done.rows[0]).toEqual({ status: 'FAILED', sub: 'FAILING' });
  });

  it('TEST-API-WHK-INT-04 another tenant sees no subscriptions or deliveries', async () => {
    const b = env.appAs(env.B, ['config.manage']);
    expect((await request(b).get('/v1/webhook-deliveries')).body.data).toEqual([]);
    expect((await request(b).get('/v1/webhook-subscriptions')).body.data).toEqual([]);
  });
});
