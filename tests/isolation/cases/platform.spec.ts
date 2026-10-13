// TEST-SEC-001 cases for module platform (owner: Dev 1) — MOD-TEN, MOD-ORG, MOD-USR read model.
// Tenant B holds every admin permission and still must not see or change tenant A. Both tenants have the same
// branch code, team name and queue code, so a leak cannot hide behind a different natural key.
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_ADMIN, KEYS, startIsolationEnv, versionOf, type IsolationEnv } from '../harness';

let env: IsolationEnv;
beforeAll(async () => {
  env = await startIsolationEnv();
});
afterAll(async () => {
  await env?.stop();
});

const idsOf = (body: { data: { id: string }[] }) => body.data.map((r) => r.id);

describe('TEST-SEC-001 platform: reads never cross tenants', () => {
  it('API-USR-010 API-TEN-SELF /v1/me and /v1/tenant are the caller’s own', async () => {
    const b = env.appAs(env.B, ALL_ADMIN);
    expect((await request(b).get('/v1/me')).body.tenantId).toBe(env.B.tenantId);
    expect((await request(b).get('/v1/tenant')).body.id).toBe(env.B.tenantId);
  });

  it('API-ORG-001 API-ORG-004 API-ORG-007-LIST API-ORG-012 API-USR-LIST lists contain only the caller’s tenant', async () => {
    const b = env.appAs(env.B, ALL_ADMIN);
    const lists: [string, string[]][] = [
      ['/v1/organisations', [env.A.orgId]],
      ['/v1/branches', [env.A.branchId]],
      ['/v1/teams', [env.A.teamId]],
      ['/v1/work-queues', [env.A.queueId]],
      ['/v1/users', env.A.userIds],
    ];
    for (const [path, foreign] of lists) {
      const res = await request(b).get(path);
      expect(res.status, path).toBe(200);
      for (const id of foreign) expect(idsOf(res.body), path).not.toContain(id);
    }
    // Same natural key, exactly one row: tenant B's own.
    const branches = await request(b).get(`/v1/branches?q=${KEYS.branchCode}`);
    expect(idsOf(branches.body)).toEqual([env.B.branchId]);
    const queues = await request(b).get(`/v1/work-queues?q=${KEYS.queueCode}`);
    expect(idsOf(queues.body)).toEqual([env.B.queueId]);
  });

  it('API-ORG-001-GET API-ORG-004-GET API-ORG-007-GET API-ORG-012-GET another tenant’s id is 404, never 403', async () => {
    const b = env.appAs(env.B, ALL_ADMIN);
    for (const path of [
      `/v1/organisations/${env.A.orgId}`,
      `/v1/branches/${env.A.branchId}`,
      `/v1/teams/${env.A.teamId}`,
      `/v1/work-queues/${env.A.queueId}`,
    ]) {
      const res = await request(b).get(path);
      expect(res.status, path).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('API-USR-LIST filters cannot reach another tenant', async () => {
    const res = await request(env.appAs(env.B, ALL_ADMIN)).get(`/v1/users?branchId=${env.A.branchId}`);
    expect(res.body.data).toEqual([]);
  });
});

describe('TEST-SEC-001 platform: writes never cross tenants', () => {
  it('API-ORG-002 API-ORG-005 API-ORG-006 API-ORG-008 API-ORG-009 API-ORG-013 API-ORG-014 writes on another tenant’s id are 404 and change nothing', async () => {
    const b = env.appAs(env.B, ALL_ADMIN);
    const before = {
      org: await versionOf(env.admin, 'organisation', env.A.orgId),
      branch: await versionOf(env.admin, 'branch', env.A.branchId),
      team: await versionOf(env.admin, 'team', env.A.teamId),
      queue: await versionOf(env.admin, 'work_queue', env.A.queueId),
    };
    const writes = [
      request(b)
        .patch(`/v1/organisations/${env.A.orgId}`)
        .set('If-Match', '"0"')
        .send({ legalName: 'Hijacked' }),
      request(b).patch(`/v1/branches/${env.A.branchId}`).set('If-Match', '"0"').send({ name: 'Hijacked' }),
      request(b).post(`/v1/branches/${env.A.branchId}/deactivation`).set('If-Match', '"0"'),
      request(b).patch(`/v1/teams/${env.A.teamId}`).set('If-Match', '"0"').send({ name: 'Hijacked' }),
      request(b).put(`/v1/teams/${env.A.teamId}/members`).set('If-Match', '"0"').send({ userIds: [] }),
      request(b).patch(`/v1/work-queues/${env.A.queueId}`).set('If-Match', '"0"').send({ active: false }),
      request(b).put(`/v1/work-queues/${env.A.queueId}/members`).set('If-Match', '"0"').send({ members: [] }),
    ];
    for (const res of await Promise.all(writes)) {
      expect(res.status, res.req.path).toBe(404);
    }
    expect({
      org: await versionOf(env.admin, 'organisation', env.A.orgId),
      branch: await versionOf(env.admin, 'branch', env.A.branchId),
      team: await versionOf(env.admin, 'team', env.A.teamId),
      queue: await versionOf(env.admin, 'work_queue', env.A.queueId),
    }).toEqual(before);
    const members = await env.admin.query(
      `select count(*)::int as n from app.team_membership where team_id = $1 and effective_range @> now()`,
      [env.A.teamId],
    );
    expect(members.rows[0].n).toBe(1);
  });

  it('API-ORG-003 API-ORG-007 API-ORG-011 creates cannot reference another tenant’s branch, team or users', async () => {
    const b = env.appAs(env.B, ALL_ADMIN);
    const team = await request(b)
      .post('/v1/teams')
      .set('Idempotency-Key', 'iso-team-foreign-branch')
      .send({ name: 'Cross', branchId: env.A.branchId });
    expect(team.status).toBe(422);
    const manager = await request(b)
      .post('/v1/teams')
      .set('Idempotency-Key', 'iso-team-foreign-manager')
      .send({ name: 'Cross 2', managerUserId: env.A.userIds[0] });
    expect(manager.status).toBe(422);
    const queue = await request(b)
      .post('/v1/work-queues')
      .set('Idempotency-Key', 'iso-queue-foreign-team')
      .send({ code: 'X-TEAM', name: 'X', kind: 'TEAM', teamId: env.A.teamId, recordTypes: ['LEAD'] });
    expect(queue.status).toBe(422);

    // A branch created by B with A's code lands in B only.
    const branch = await request(b)
      .post('/v1/branches')
      .set('Idempotency-Key', 'iso-branch-same-code')
      .send({ code: 'PUN01', name: 'Pune' });
    expect(branch.status).toBe(201);
    const owner = await env.admin.query(`select tenant_id from app.branch where id = $1`, [branch.body.id]);
    expect(owner.rows[0].tenant_id).toBe(env.B.tenantId);
  });

  it('API-ORG-009 API-ORG-014 another tenant’s users cannot be added as members', async () => {
    const b = env.appAs(env.B, ALL_ADMIN);
    const team = await request(b).get(`/v1/teams/${env.B.teamId}`);
    const res = await request(b)
      .put(`/v1/teams/${env.B.teamId}/members`)
      .set('If-Match', team.headers.etag as string)
      .send({ userIds: [env.A.userIds[0]] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_ASSIGNEE');

    const queue = await request(b).get(`/v1/work-queues/${env.B.queueId}`);
    const q = await request(b)
      .put(`/v1/work-queues/${env.B.queueId}/members`)
      .set('If-Match', queue.headers.etag as string)
      .send({ members: [{ userId: env.A.userIds[0], canPick: true, canAssign: false }] });
    expect(q.status).toBe(422);
  });

  it('FR-TEN-007 a tenant id in the body is rejected, never trusted', async () => {
    const res = await request(env.appAs(env.B, ALL_ADMIN))
      .post('/v1/branches')
      .set('Idempotency-Key', 'iso-body-tenant')
      .send({ code: 'NSK01', name: 'Nashik', tenantId: env.A.tenantId });
    expect(res.status).toBe(422);
    const leaked = await env.admin.query(
      `select count(*)::int as n from app.branch where tenant_id = $1 and code = 'NSK01'`,
      [env.A.tenantId],
    );
    expect(leaked.rows[0].n).toBe(0);
  });

  it('TEST-SEC-001-AUD audit rows are written in the acting tenant only', async () => {
    const a = await env.admin.query(`select count(*)::int as n from app.audit_event where tenant_id = $1`, [
      env.A.tenantId,
    ]);
    expect(a.rows[0].n).toBe(0);
  });
});

describe('TEST-SEC-001 database backstop (RLS)', () => {
  it('TEST-SEC-001-RLS dsa_api with no tenant set sees no rows (fail closed)', async () => {
    for (const table of [
      'tenant',
      'organisation',
      'branch',
      'app_user',
      'team',
      'work_queue',
      'audit_event',
    ]) {
      const r = await env.db.transaction().execute(async (tx) => {
        return sql<{ n: number }>`select count(*)::int as n from ${sql.table(table)}`.execute(tx);
      });
      expect(r.rows[0]?.n, table).toBe(0);
    }
  });

  it('TEST-SEC-001-RLS with tenant B set, an insert claiming tenant A is refused by RLS', async () => {
    await expect(
      env.db.transaction().execute(async (tx) => {
        await sql`select set_config('app.tenant_id', ${env.B.tenantId}, true)`.execute(tx);
        await sql`insert into branch (id, tenant_id, organisation_id, code, name, created_by, updated_by)
                  values ('br_iso_evil', ${env.A.tenantId}, ${env.A.orgId}, 'EVIL', 'Evil', 'x', 'x')`.execute(
          tx,
        );
      }),
    ).rejects.toThrow();
  });
});
