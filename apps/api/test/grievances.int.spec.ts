// MOD-GRV Grievances against a real database (owner: Dev 3). Covers intake, the queue, assignment and referral, resolution,
// reopening, idempotency, optimistic concurrency under parallel writers, permissions and the audit trail.
import type { PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ALL_ADMIN,
  startIsolationEnv,
  type IsolationEnv,
  type TenantFixture,
} from '../../../tests/isolation/harness';

/** Handlers hold both grievance permissions, plus the admin ones the shared harness fixtures already use. */
const GRV: PermissionCode[] = [...ALL_ADMIN, 'complaint.create', 'complaint.manage'];

let env: IsolationEnv;
beforeAll(async () => {
  env = await startIsolationEnv();
}, 180_000);
afterAll(async () => {
  await env?.stop();
});

const key = (n: string) => `grv-int-${n}-000001`;
const etag = (res: request.Response) => res.headers.etag as string;
const COMPLAINT_TEXT = 'The callback promised on Monday never came, so the file is still open.';

/** Inserts a customer and a loan application for a tenant, as the origination module would have. */
async function seedApplication(t: TenantFixture, appId: string, customerId: string) {
  await env.admin.query(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Demo Customer', $3, $4, $4)`,
    [customerId, t.tenantId, t.branchId, t.userIds[0]],
  );
  await env.admin.query(
    `insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, requested_amount,
                                       applicant_type, sales_owner_id, created_by, updated_by)
     values ($1, $2, $3, $4, 'PL', 100000.00, 'SALARIED', $5, $5, $5)`,
    [appId, t.tenantId, t.branchId, customerId, t.userIds[0]],
  );
}

const A_APP = 'app_grv_int_a1';
const A_CUST = 'cust_grv_int_a1';
let seeded = false;
async function ensureSeeded() {
  if (seeded) return;
  await seedApplication(env.A, A_APP, A_CUST);
  seeded = true;
}

async function openComplaint(n: string) {
  await ensureSeeded();
  const a = env.appAs(env.A, GRV);
  const res = await request(a)
    .post('/v1/complaints')
    .set('Idempotency-Key', key(`open-${n}`))
    .send({
      complainantType: 'APPLICATION',
      complainantId: A_APP,
      channel: 'PHONE',
      category: 'SERVICE',
      description: COMPLAINT_TEXT,
    });
  expect(res.status).toBe(201);
  return res;
}

describe('TEST-GRV-INT grievances against the database', () => {
  it('TEST-GRV-INT-01 records a complaint against an application with an acknowledgement reference', async () => {
    const res = await openComplaint('intake');
    expect(res.body.status).toBe('OPEN');
    expect(res.body.dueAt).not.toBeNull();
    const dueTime = new Date(res.body.dueAt).getTime();
    const now = Date.now();
    expect(dueTime).toBeGreaterThanOrEqual(now + 29 * 24 * 3600 * 1000);
    expect(dueTime).toBeLessThanOrEqual(now + 31 * 24 * 3600 * 1000);
    expect(res.body.version).toBe(0);
    expect(etag(res)).toBe('"0"');

    const audit = await env.admin.query(`select action from app.audit_event where entity_id = $1`, [
      res.body.id,
    ]);
    expect(audit.rows.map((r) => r.action)).toEqual(['complaint.created']);
  });

  it('TEST-GRV-INT-02 the same Idempotency-Key replays the original complaint', async () => {
    await ensureSeeded();
    const a = env.appAs(env.A, GRV);
    const body = {
      complainantType: 'APPLICATION',
      complainantId: A_APP,
      channel: 'EMAIL',
      category: 'CHARGES',
      description: 'Processing fee was charged twice on one application',
    };
    const first = await request(a).post('/v1/complaints').set('Idempotency-Key', key('replay')).send(body);
    const again = await request(a).post('/v1/complaints').set('Idempotency-Key', key('replay')).send(body);
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.ackRef).toBe(first.body.ackRef);
  });

  it('TEST-GRV-INT-03 an unknown application or lead is 404 (production wires both subject providers)', async () => {
    await ensureSeeded();
    const a = env.appAs(env.A, GRV);
    const unknown = await request(a).post('/v1/complaints').set('Idempotency-Key', key('unknown')).send({
      complainantType: 'APPLICATION',
      complainantId: 'app_grv_int_missing',
      channel: 'WEB',
      category: 'OTHER',
      description: COMPLAINT_TEXT,
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('NOT_FOUND');

    const lead = await request(a).post('/v1/complaints').set('Idempotency-Key', key('lead')).send({
      complainantType: 'LEAD',
      complainantId: 'lead_grv_int_1',
      channel: 'WEB',
      category: 'OTHER',
      description: COMPLAINT_TEXT,
    });
    // The lead provider is wired (crm/leads/subject-port.ts), so an unknown lead is refused as not found, not as unsupported.
    expect(lead.status).toBe(404);
    expect(lead.body.error.code).toBe('NOT_FOUND');
  });

  it('TEST-GRV-INT-04 the queue filters by status and pages with a cursor', async () => {
    await openComplaint('queue-1');
    await openComplaint('queue-2');
    const a = env.appAs(env.A, GRV);
    const first = await request(a).get('/v1/complaints?status=OPEN&limit=1');
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(1);
    expect(first.body.meta.nextCursor).not.toBeNull();
    const second = await request(a).get(
      `/v1/complaints?status=OPEN&limit=1&cursor=${first.body.meta.nextCursor}`,
    );
    expect(second.body.data[0].id).not.toBe(first.body.data[0].id);
    const resolvedOnly = await request(a).get('/v1/complaints?status=RESOLVED');
    expect(resolvedOnly.body.data.every((c: { status: string }) => c.status === 'RESOLVED')).toBe(true);
  });

  it('TEST-GRV-INT-05 assigning an owner moves the version on and is audited; an inactive owner is refused', async () => {
    const c = await openComplaint('assign');
    const a = env.appAs(env.A, GRV);
    const bad = await request(a)
      .patch(`/v1/complaints/${c.body.id}`)
      .set('If-Match', etag(c))
      .send({ ownerUserId: 'usr_grv_missing_1' });
    expect(bad.status).toBe(422);

    const ok = await request(a)
      .patch(`/v1/complaints/${c.body.id}`)
      .set('If-Match', etag(c))
      .send({ ownerUserId: env.A.userIds[1], dueAt: '2026-11-30T00:00:00Z' });
    expect(ok.status).toBe(200);
    expect(ok.body.ownerUserId).toBe(env.A.userIds[1]);
    expect(ok.body.dueAt).toBe('2026-11-30T00:00:00.000Z');
    expect(ok.body.version).toBe(1);

    const audit = await env.admin.query(
      `select action, before, after from app.audit_event where entity_id = $1 and action = 'complaint.assigned'`,
      [c.body.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].before).toMatchObject({ ownerUserId: null, status: 'OPEN' });
    expect(audit.rows[0].after).toMatchObject({ ownerUserId: env.A.userIds[1] });
  });

  it('TEST-GRV-INT-06 starting work moves OPEN to IN_PROGRESS once; the description is never copied into the audit trail', async () => {
    const c = await openComplaint('start');
    const a = env.appAs(env.A, GRV);
    const started = await request(a)
      .patch(`/v1/complaints/${c.body.id}`)
      .set('If-Match', etag(c))
      .send({ status: 'IN_PROGRESS' });
    expect(started.status).toBe(200);
    expect(started.body.status).toBe('IN_PROGRESS');

    const again = await request(a)
      .patch(`/v1/complaints/${c.body.id}`)
      .set('If-Match', etag(started))
      .send({ status: 'IN_PROGRESS' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_TRANSITION');

    const audit = await env.admin.query(`select after, before from app.audit_event where entity_id = $1`, [
      c.body.id,
    ]);
    expect(JSON.stringify(audit.rows)).not.toContain('callback promised');
  });

  it('TEST-GRV-INT-07 referral to a lender is recorded with a time, and clearing it leaves none', async () => {
    await env.admin.query(
      `insert into app.lender (id, tenant_id, name, lender_type, created_by, updated_by)
       values ('lnd_grv_demo_1', $1, 'Referral Lender', 'NBFC', $2, $2)`,
      [env.A.tenantId, env.A.userIds[0]],
    );
    const c = await openComplaint('refer');
    const a = env.appAs(env.A, GRV);
    const referred = await request(a)
      .patch(`/v1/complaints/${c.body.id}`)
      .set('If-Match', etag(c))
      .send({ lenderReferral: { lenderId: 'lnd_grv_demo_1', reference: 'LND-REF-4471' } });
    expect(referred.status).toBe(200);
    expect(referred.body.lenderReferral).toMatchObject({
      lenderId: 'lnd_grv_demo_1',
      reference: 'LND-REF-4471',
    });
    expect(referred.body.lenderReferral.referredAt).toEqual(expect.any(String));

    const cleared = await request(a)
      .patch(`/v1/complaints/${c.body.id}`)
      .set('If-Match', etag(referred))
      .send({ lenderReferral: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.lenderReferral).toEqual({});

    const audit = await env.admin.query(
      `select action from app.audit_event where entity_id = $1 order by occurred_at`,
      [c.body.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'complaint.created',
      'complaint.referred',
      'complaint.referred',
    ]);
  });

  it('TEST-GRV-INT-15 a referral must name a lender in this tenant; an unknown or other-tenant lender is 422', async () => {
    const c = await openComplaint('lender-check');
    const a = env.appAs(env.A, GRV);
    const unknown = await request(a)
      .patch(`/v1/complaints/${c.body.id}`)
      .set('If-Match', etag(c))
      .send({ lenderReferral: { lenderId: 'lnd_grv_missing_9', reference: 'LND-REF-0001' } });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.details[0]).toMatchObject({
      field: 'lenderReferral.lenderId',
      issue: 'NOT_FOUND',
    });

    await env.admin.query(
      `insert into app.lender (id, tenant_id, name, lender_type, created_by, updated_by)
       values ('lnd_grv_b_only', $1, 'Tenant B Lender', 'NBFC', $2, $2)`,
      [env.B.tenantId, env.B.userIds[0]],
    );
    const other = await request(a)
      .patch(`/v1/complaints/${c.body.id}`)
      .set('If-Match', etag(c))
      .send({ lenderReferral: { lenderId: 'lnd_grv_b_only', reference: 'LND-REF-0002' } });
    expect(other.status).toBe(422);
    expect(other.body.error.details[0].issue).toBe('NOT_FOUND');
    const still = await request(a).get(`/v1/complaints/${c.body.id}`);
    expect(still.body.lenderReferral).toEqual({});
  });

  it('TEST-GRV-INT-08 a stale If-Match is 409 and changes nothing', async () => {
    const c = await openComplaint('stale');
    const a = env.appAs(env.A, GRV);
    const first = await request(a)
      .patch(`/v1/complaints/${c.body.id}`)
      .set('If-Match', etag(c))
      .send({ category: 'PROCESS' });
    expect(first.status).toBe(200);
    const stale = await request(a)
      .patch(`/v1/complaints/${c.body.id}`)
      .set('If-Match', etag(c))
      .send({ category: 'CHARGES' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect((await request(a).get(`/v1/complaints/${c.body.id}`)).body.category).toBe('PROCESS');
  });

  it('TEST-GRV-INT-09 resolving records the resolution; a resolved complaint is read-only and cannot be resolved twice', async () => {
    const c = await openComplaint('resolve');
    const a = env.appAs(env.A, GRV);
    const resolved = await request(a)
      .post(`/v1/complaints/${c.body.id}/resolution`)
      .set('Idempotency-Key', key('resolve-1'))
      .set('If-Match', etag(c))
      .send({
        action: 'RESOLVE',
        resolution: 'Callback made on 14 Oct; the file was closed with the customer.',
      });
    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe('RESOLVED');
    expect(resolved.body.resolution).toContain('Callback made');
    expect(resolved.body.resolvedAt).toEqual(expect.any(String));
    expect(etag(resolved)).toBe('"1"');

    const edit = await request(a)
      .patch(`/v1/complaints/${c.body.id}`)
      .set('If-Match', etag(resolved))
      .send({ category: 'PROCESS' });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('INVALID_STATE');

    const twice = await request(a)
      .post(`/v1/complaints/${c.body.id}/resolution`)
      .set('Idempotency-Key', key('resolve-2'))
      .set('If-Match', etag(resolved))
      .send({ action: 'RESOLVE', resolution: 'Second attempt to resolve the same complaint.' });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('TEST-GRV-INT-10 reopening needs a resolved complaint and a reason; the resolution is cleared and the reason audited', async () => {
    const c = await openComplaint('reopen');
    const a = env.appAs(env.A, GRV);
    const notResolved = await request(a)
      .post(`/v1/complaints/${c.body.id}/resolution`)
      .set('Idempotency-Key', key('reopen-early'))
      .set('If-Match', etag(c))
      .send({ action: 'REOPEN', reason: 'Customer says it is still open' });
    expect(notResolved.status).toBe(409);
    expect(notResolved.body.error.code).toBe('INVALID_TRANSITION');

    const resolved = await request(a)
      .post(`/v1/complaints/${c.body.id}/resolution`)
      .set('Idempotency-Key', key('reopen-res'))
      .set('If-Match', etag(c))
      .send({ action: 'RESOLVE', resolution: 'Callback made and the file was closed.' });
    const reopened = await request(a)
      .post(`/v1/complaints/${c.body.id}/resolution`)
      .set('Idempotency-Key', key('reopen-go'))
      .set('If-Match', etag(resolved))
      .send({ action: 'REOPEN', reason: 'Customer says the issue came back' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.status).toBe('OPEN');
    expect(reopened.body.resolution).toBeNull();
    expect(reopened.body.resolvedAt).toBeNull();

    const audit = await env.admin.query(
      `select reason from app.audit_event where entity_id = $1 and action = 'complaint.reopened'`,
      [c.body.id],
    );
    expect(audit.rows[0].reason).toBe('Customer says the issue came back');
  });

  it('TEST-GRV-INT-11 two parallel resolutions with the same If-Match: exactly one succeeds', async () => {
    const c = await openComplaint('race-resolve');
    const a = env.appAs(env.A, GRV);
    const attempt = (n: number) =>
      request(a)
        .post(`/v1/complaints/${c.body.id}/resolution`)
        .set('Idempotency-Key', key(`race-res-${n}`))
        .set('If-Match', etag(c))
        .send({ action: 'RESOLVE', resolution: `Resolution written by writer ${n}.` });
    const results = await Promise.all([attempt(1), attempt(2)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(['VERSION_CONFLICT', 'INVALID_TRANSITION']).toContain(loser.body.error.code);
    const row = await env.admin.query(`select status, lock_version from app.complaint where id = $1`, [
      c.body.id,
    ]);
    expect(row.rows[0]).toMatchObject({ status: 'RESOLVED', lock_version: 1 });
  });

  it('TEST-GRV-INT-12 two parallel assignments with the same If-Match: exactly one succeeds and the other is 409', async () => {
    const c = await openComplaint('race-assign');
    const a = env.appAs(env.A, GRV);
    const results = await Promise.all([
      request(a)
        .patch(`/v1/complaints/${c.body.id}`)
        .set('If-Match', etag(c))
        .send({ ownerUserId: env.A.userIds[0] }),
      request(a)
        .patch(`/v1/complaints/${c.body.id}`)
        .set('If-Match', etag(c))
        .send({ ownerUserId: env.A.userIds[1] }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.body.error.code).toBe('VERSION_CONFLICT');
    const row = await env.admin.query(`select owner_user_id, lock_version from app.complaint where id = $1`, [
      c.body.id,
    ]);
    expect(row.rows[0].lock_version).toBe(1);
  });

  it('TEST-GRV-INT-13 complaints are never deleted: DELETE is 404 and the row remains', async () => {
    const c = await openComplaint('nodelete');
    const a = env.appAs(env.A, GRV);
    const res = await request(a).delete(`/v1/complaints/${c.body.id}`).set('If-Match', etag(c));
    expect(res.status).toBe(404);
    const row = await env.admin.query(`select count(*)::int as n from app.complaint where id = $1`, [
      c.body.id,
    ]);
    expect(row.rows[0].n).toBe(1);
  });

  it('TEST-GRV-INT-14 permissions: intake needs complaint.create, handling needs complaint.manage, and the two do not imply each other', async () => {
    await ensureSeeded();
    const intakeOnly = env.appAs(env.A, ['complaint.create']);
    const handlerOnly = env.appAs(env.A, ['complaint.manage']);
    const body = {
      complainantType: 'APPLICATION',
      complainantId: A_APP,
      channel: 'BRANCH',
      category: 'SERVICE',
      description: COMPLAINT_TEXT,
    };
    expect(
      (await request(intakeOnly).post('/v1/complaints').set('Idempotency-Key', key('perm-1')).send(body))
        .status,
    ).toBe(201);
    expect((await request(intakeOnly).get('/v1/complaints')).status).toBe(403);
    expect(
      (await request(handlerOnly).post('/v1/complaints').set('Idempotency-Key', key('perm-2')).send(body))
        .status,
    ).toBe(403);
    expect((await request(handlerOnly).get('/v1/complaints')).status).toBe(200);
  });
});
