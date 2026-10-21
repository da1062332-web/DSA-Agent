// MOD-PRV retention schedule (API-PRV-005, 006) and data-principal requests (API-PRV-001..003) against a real database (M-077),
// with the production wiring. Synthetic data only.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

let env: IsolationEnv;
const CUST = 'cust_prv_1';

beforeAll(async () => {
  env = await startIsolationEnv();
  await env.admin.query(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Privacy Customer', $3, $4, $4)`,
    [CUST, env.A.tenantId, env.A.branchId, env.A.userIds[0]],
  );
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

const app = () => env.appAs(env.A, ['privacy.manage']);

describe('TEST-PRV-INT retention and data-principal requests', () => {
  it('TEST-PRV-INT-01 API-PRV-005/006 the schedule starts on defaults; a change above the minimum is kept, below it is refused', async () => {
    const list = await request(app()).get('/v1/retention-policies');
    expect(list.status).toBe(200);
    const loan = list.body.data.find((p: { dataClass: string }) => p.dataClass === 'R-LOAN');
    expect(loan).toMatchObject({ isDefault: true, version: 0, retentionMonths: 60 });

    const below = await request(app())
      .put('/v1/retention-policies/R-LOAN')
      .set('If-Match', '"0"')
      .send({
        retentionMonths: 12,
        triggerEvent: 'RELATIONSHIP_ENDED',
        action: 'ANONYMISE',
        reason: 'Shorter please',
      });
    expect(below.status).toBe(422);
    const ok = await request(app())
      .put('/v1/retention-policies/R-LOAN')
      .set('If-Match', '"0"')
      .send({
        retentionMonths: 96,
        triggerEvent: 'RELATIONSHIP_ENDED',
        action: 'ANONYMISE',
        reason: 'Lender agreements need eight years',
      });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ retentionMonths: 96, isDefault: false, approvedBy: env.A.userIds[0] });
    const stale = await request(app())
      .put('/v1/retention-policies/R-LOAN')
      .set('If-Match', '"0"')
      .send({
        retentionMonths: 100,
        triggerEvent: 'RELATIONSHIP_ENDED',
        action: 'ANONYMISE',
        reason: 'Again',
      });
    expect(stale.status).toBe(409);
    expect(
      (await request(app()).put('/v1/retention-policies/R-NOPE').set('If-Match', '"0"').send({})).status,
    ).toBe(404);
  });

  it('TEST-PRV-INT-02 API-PRV-001..003 a request is logged with a due date and closed only with a decision', async () => {
    const created = await request(app())
      .post('/v1/data-subject-requests')
      .set('Idempotency-Key', 'prv_dsr_create_01')
      .send({ subjectType: 'CUSTOMER', subjectId: CUST, requestType: 'ACCESS', channel: 'EMAIL' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(new Date(created.body.dueAt).getTime() - new Date(created.body.receivedAt).getTime()).toBe(
      30 * 86_400_000,
    );
    const id = created.body.id;

    const queue = await request(app()).get('/v1/data-subject-requests?status=RECEIVED');
    expect(queue.body.data.map((r: { id: string }) => r.id)).toContain(id);

    const skip = await request(app())
      .patch(`/v1/data-subject-requests/${id}`)
      .set('If-Match', '"0"')
      .send({ status: 'COMPLETED', decision: 'FULFILLED' });
    expect(skip.status).toBe(409);
    const start = await request(app())
      .patch(`/v1/data-subject-requests/${id}`)
      .set('If-Match', '"0"')
      .send({ status: 'IN_PROGRESS' });
    expect(start.status).toBe(200);
    expect(start.body.handledBy).toBe(env.A.userIds[0]);
    const noDecision = await request(app())
      .patch(`/v1/data-subject-requests/${id}`)
      .set('If-Match', `"${start.body.version}"`)
      .send({ status: 'COMPLETED' });
    expect(noDecision.status).toBe(422);
    const done = await request(app())
      .patch(`/v1/data-subject-requests/${id}`)
      .set('If-Match', `"${start.body.version}"`)
      .send({ status: 'COMPLETED', decision: 'FULFILLED', responsePackageKey: 'dsr/package-01.zip' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.completedAt).toBeTruthy();
  });

  it('TEST-PRV-INT-03 another tenant sees no requests and cannot change them (404)', async () => {
    const b = env.appAs(env.B, ['privacy.manage']);
    expect((await request(b).get('/v1/data-subject-requests')).body.data).toEqual([]);
    const id = (await env.admin.query(`select id from app.data_subject_request limit 1`)).rows[0].id;
    expect(
      (await request(b).patch(`/v1/data-subject-requests/${id}`).set('If-Match', '"0"').send({ notes: 'x' }))
        .status,
    ).toBe(404);
  });
});
