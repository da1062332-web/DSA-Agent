// MOD-INT tenant dead letters (API-INT-003..005) and generic inbound webhooks (API-INT-006, M-076) against a real database,
// with the production wiring. Synthetic data only.
import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

let env: IsolationEnv;
const SIGNING = 'synthetic-provider-signing-secret';

beforeAll(async () => {
  env = await startIsolationEnv();
  const a = env.A;
  const q = (text: string, values: unknown[]) => env.admin.query(text, values);
  await q(
    `insert into app.outbox_event (id, tenant_id, event_type, event_version, subject_type, subject_id, payload, correlation_id,
                                   chain_depth, publish_attempts, last_publish_error, dead_lettered_at)
     values ('evt_dlq_1', $1, 'lead.created', 1, 'LEAD', 'lead_dlq_1', '{}'::jsonb, 'corr_dlq', 0, 5, 'Error: boom', now())`,
    [a.tenantId],
  );
  await q(
    `insert into app.job_queue (id, tenant_id, job_type, status, attempts, max_attempts, last_error)
     values ('job_dlq_1', $1, 'DOCUMENT_ARCHIVE', 'FAILED', 3, 3, 'Error: disk')`,
    [a.tenantId],
  );
  await q(
    `insert into app.public_entry_index (connection_path_id, tenant_id, provider, connection_id, signing_secret)
     values ('cpi_dlq_1', $1, 'acme', 'conn_acme_1', $2)`,
    [a.tenantId, SIGNING],
  );
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

describe('TEST-INT-DLQ-INT dead letters and inbound webhooks', () => {
  it('TEST-INT-DLQ-INT-01 API-INT-003 lists parked events and exhausted jobs of the tenant only, without payloads', async () => {
    const a = await request(env.appAs(env.A, ['integration.dlq_manage'])).get('/v1/dead-letters');
    expect(a.status).toBe(200);
    expect(a.body.data.map((d: { id: string }) => d.id).sort()).toEqual(['evt_dlq_1', 'job_dlq_1']);
    expect(a.body.data[0]).not.toHaveProperty('payload');
    const b = await request(env.appAs(env.B, ['integration.dlq_manage'])).get('/v1/dead-letters');
    expect(b.body.data).toEqual([]);
    expect((await request(env.appAs(env.A, [])).get('/v1/dead-letters')).status).toBe(403);
  });

  it('TEST-INT-DLQ-INT-02 API-INT-004 replays the event; API-INT-005 discards the job with a reason; another tenant gets 404', async () => {
    const app = env.appAs(env.A, ['integration.dlq_manage']);
    const hostile = await request(env.appAs(env.B, ['integration.dlq_manage']))
      .post('/v1/dead-letters/evt_dlq_1/replay')
      .set('Idempotency-Key', 'dlq_hostile_01');
    expect(hostile.status).toBe(404);
    const replay = await request(app)
      .post('/v1/dead-letters/evt_dlq_1/replay')
      .set('Idempotency-Key', 'dlq_replay_01');
    expect(replay.status, JSON.stringify(replay.body)).toBe(202);
    const evt = await env.admin.query(
      `select dead_lettered_at, publish_attempts from app.outbox_event where id = 'evt_dlq_1'`,
    );
    expect(evt.rows[0]).toEqual({ dead_lettered_at: null, publish_attempts: 0 });
    const discard = await request(app)
      .post('/v1/dead-letters/job_dlq_1/discard')
      .send({ reason: 'Archive no longer needed' });
    expect(discard.status).toBe(200);
    const job = await env.admin.query(`select status from app.job_queue where id = 'job_dlq_1'`);
    expect(job.rows[0].status).toBe('CANCELLED');
    expect((await request(app).get('/v1/dead-letters')).body.data).toEqual([]);
  });

  it('TEST-INT-DLQ-INT-03 API-INT-006 accepts a signed webhook once, and refuses a bad signature or a stale timestamp', async () => {
    const pub = env.anonymousApp();
    const body = JSON.stringify({ kind: 'status', ref: 'abc' });
    const send = (ts: number, sig: string, id = 'prov_evt_1') =>
      request(pub)
        .post('/public/v1/webhooks/acme/cpi_dlq_1')
        .set('Content-Type', 'application/json')
        .set('X-Webhook-Id', id)
        .set('X-Webhook-Timestamp', String(ts))
        .set('X-Webhook-Signature', sig)
        .send(body);
    const now = Math.floor(Date.now() / 1000);
    const sign = (ts: number) =>
      `v1=${crypto.createHmac('sha256', SIGNING).update(`${ts}.${body}`).digest('hex')}`;

    expect((await send(now, 'v1=deadbeef')).status).toBe(401);
    expect((await send(now - 600, sign(now - 600))).status).toBe(401);
    const ok = await send(now, sign(now));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toEqual({ received: true, duplicate: false });
    const again = await send(now, sign(now));
    expect(again.body.duplicate).toBe(true);
    const rows = await env.admin.query(
      `select (select count(*)::int from app.inbound_webhook) as hooks,
              (select count(*)::int from app.outbox_event where event_type = 'integration.webhook_received') as events`,
    );
    expect(rows.rows[0]).toEqual({ hooks: 1, events: 1 });
    expect(
      (
        await request(pub)
          .post('/public/v1/webhooks/other/cpi_dlq_1')
          .set('X-Webhook-Id', 'x')
          .set('X-Webhook-Timestamp', String(now))
          .set('X-Webhook-Signature', sign(now))
          .send(body)
      ).status,
    ).toBe(401);
  });
});
