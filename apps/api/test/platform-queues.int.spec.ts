// SUB-ADM.04 background queues against a real database (M-067, M-068): the console shows the real outbox relay and job queue,
// and pause, replay and discard act on them. Synthetic data only.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv, type TenantFixture } from '../../../tests/isolation/harness';

const PLATFORM = 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG';
let env: IsolationEnv;
let platform: TenantFixture;

beforeAll(async () => {
  env = await startIsolationEnv();
  platform = { ...env.A, tenantId: PLATFORM, userIds: ['usr_platform_ops_1', 'usr_platform_ops_2'] };
  await env.admin.query(
    `insert into app.outbox_event (id, tenant_id, event_type, subject_type, subject_id, payload, correlation_id,
                                   publish_attempts, last_publish_error, dead_lettered_at)
     values ('evt_plq_parked_1', $1, 'lead.created', 'LEAD', 'lead_x', '{"secret":"never shown"}'::jsonb, 'corr_plq', 5,
             'Error: subscriber down', now()),
            ('evt_plq_parked_2', $1, 'lead.created', 'LEAD', 'lead_y', '{}'::jsonb, 'corr_plq', 5, 'Error: down', now())`,
    [env.A.tenantId],
  );
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

describe('TEST-ADM-QUEUE real background queues', () => {
  it('TEST-ADM-QUEUE-01 the console reads the real queues and parked events, without their payload', async () => {
    const res = await request(env.appAs(platform, ['platform.jobs'])).get('/platform/v1/jobs');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.sampleData).toBe(false);
    expect(res.body.queues.map((q: { queue: string }) => q.queue).sort()).toEqual([
      'job-queue',
      'outbox-relay',
    ]);
    const relay = res.body.queues.find((q: { queue: string }) => q.queue === 'outbox-relay');
    expect(relay.failedJobs).toBe(2);
    const parked = res.body.deadLetters.find((d: { id: string }) => d.id === 'evt_plq_parked_1');
    expect(parked).toMatchObject({ queue: 'outbox-relay', status: 'UNRESOLVED', retryCount: 5 });
    expect(JSON.stringify(res.body)).not.toContain('never shown');
  });

  it('TEST-ADM-QUEUE-02 replay puts an event back in the relay; discard keeps it but never delivers it', async () => {
    const app = env.appAs(platform, ['platform.jobs']);
    expect(
      (await request(app).post('/platform/v1/dead-letters/evt_plq_parked_1/replay').send({})).status,
    ).toBe(200);
    expect(
      (await request(app).post('/platform/v1/dead-letters/evt_plq_parked_2/discard').send({})).status,
    ).toBe(200);
    const rows = await env.admin.query(
      `select id, dead_lettered_at, publish_attempts, discarded_at from app.outbox_event where id like 'evt_plq_parked_%' order by id`,
    );
    expect(rows.rows[0]).toMatchObject({ dead_lettered_at: null, publish_attempts: 0, discarded_at: null });
    expect(rows.rows[1].discarded_at).not.toBeNull();
    expect(
      (await request(app).post('/platform/v1/dead-letters/evt_plq_parked_2/replay').send({})).status,
    ).toBe(404);
  });

  it('TEST-ADM-QUEUE-03 pausing a queue is stored for the worker, with the reason', async () => {
    const app = env.appAs(platform, ['platform.jobs']);
    const paused = await request(app)
      .post('/platform/v1/queues/outbox-relay/pause')
      .send({ reason: 'Subscriber maintenance window' });
    expect(paused.status, JSON.stringify(paused.body)).toBe(200);
    expect(paused.body).toMatchObject({
      queue: 'outbox-relay',
      paused: true,
      pausedReason: 'Subscriber maintenance window',
    });
    const flag = await env.admin.query(
      `select paused from app.worker_queue_state where queue = 'outbox-relay'`,
    );
    expect(flag.rows[0].paused).toBe(true);
    const resumed = await request(app)
      .post('/platform/v1/queues/outbox-relay/resume')
      .send({ reason: 'Maintenance done' });
    expect(resumed.body.paused).toBe(false);
  });

  it('TEST-ADM-QUEUE-04 a customer tenant, even with the permission, cannot use the console', async () => {
    const res = await request(env.appAs(env.A, ['platform.jobs'])).get('/platform/v1/jobs');
    expect(res.status).toBe(403);
  });
});
