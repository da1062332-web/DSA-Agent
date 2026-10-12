// Integration: module platform against PostgreSQL 16 with the Dev 1 migrations (M-000, M-001, M-002, M-004),
// connected as dsa_api (NOBYPASSRLS) exactly like production. Needs Docker: `npm run test:int -w @dsa/api`.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Database, Principal } from '@dsa/contracts';
import { createAuditPort, createAuthz, createIdGenerator, createUserDirectory } from '@dsa/kernel';
import type { Kysely } from 'kysely';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createDb } from '../src/kernel-min/db';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { fakeAuth, testPrincipal } from './support/fake-auth';

const MIGRATIONS = [
  '20261001000000_roles_and_helpers.sql',
  '20261001000001_platform_core.sql',
  '20261001000002_kernel_infra.sql',
  '20261001000004_platform_membership_grants.sql',
];
const A = 'ten_01JTENANTA00000000000000A';
const B = 'ten_01JTENANTB00000000000000B';

let container: StartedPostgreSqlContainer;
let admin: pg.Client;
let db: Kysely<Database>;

const admins = (tenantId: string, userId: string): Principal =>
  testPrincipal({
    id: userId,
    tenantId,
    grants: (['config.manage', 'user.manage'] as const).map((code) => ({
      code,
      scope: 'TENANT',
      branchIds: [],
    })),
  });

function appFor(principal: Principal) {
  const ids = createIdGenerator();
  return createApp({
    deps: {
      txRunner: createTxRunner(db),
      authz: createAuthz(),
      audit: createAuditPort(ids),
      ids,
      userDirectory: createUserDirectory(),
    },
    corsAllowedOrigins: [],
    auth: fakeAuth(principal),
  });
}

async function seedTenant(tenantId: string, suffix: string) {
  await admin.query(
    `insert into app.tenant (id, slug, legal_name, tenant_type, created_by)
                     values ($1, $2, 'T', 'DSA_ORG', 'test')`,
    [tenantId, `t-${suffix}`],
  );
  await admin.query(
    `insert into app.organisation (id, tenant_id, legal_name, constitution, created_by, updated_by)
                     values ($1, $2, 'Org', 'PVT_LTD', 'test', 'test')`,
    [`org_${suffix}`, tenantId],
  );
  await admin.query(
    `insert into app.branch (id, tenant_id, organisation_id, code, name, created_by, updated_by)
                     values ($1, $2, $3, 'MUM01', 'Mumbai', 'test', 'test')`,
    [`br_${suffix}`, tenantId, `org_${suffix}`],
  );
  for (const n of ['1', '2']) {
    await admin.query(
      `insert into app.app_user (id, tenant_id, idp_subject, email, display_name, primary_branch_id, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, 'test', 'test')`,
      [
        `usr_${suffix}${n}`,
        tenantId,
        `sub-${suffix}${n}`,
        `u${n}@${suffix}.example.com`,
        `User ${n}`,
        `br_${suffix}`,
      ],
    );
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  for (const file of MIGRATIONS) {
    await admin.query(
      readFileSync(path.resolve(import.meta.dirname, '../../../supabase/migrations', file), 'utf8'),
    );
  }
  await admin.query(`CREATE ROLE dsa_api LOGIN PASSWORD 'test' NOBYPASSRLS IN ROLE dsa_app;
                     ALTER ROLE dsa_api SET search_path = app, extensions;`);
  await seedTenant(A, 'a');
  await seedTenant(B, 'b');

  const url = new URL(container.getConnectionUri());
  url.username = 'dsa_api';
  url.password = 'test';
  db = createDb(url.toString(), { poolMax: 4 });
});

afterAll(async () => {
  await db?.destroy();
  await admin?.end();
  await container?.stop();
});

describe('platform (integration)', () => {
  it('TEST-ORG-INT-01 creates a branch; same key replays, other body with same key is 422', async () => {
    const app = appFor(admins(A, 'usr_a1'));
    const body = { code: 'PUN01', name: 'Pune' };
    const first = await request(app).post('/v1/branches').set('Idempotency-Key', 'create-pun01').send(body);
    expect(first.status).toBe(201);
    expect(first.headers.etag).toBe('"0"');

    const again = await request(app).post('/v1/branches').set('Idempotency-Key', 'create-pun01').send(body);
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body.id).toBe(first.body.id);

    const reused = await request(app)
      .post('/v1/branches')
      .set('Idempotency-Key', 'create-pun01')
      .send({ code: 'PUN02', name: 'Other' });
    expect(reused.status).toBe(422);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const dup = await request(app).post('/v1/branches').set('Idempotency-Key', 'create-pun01-b').send(body);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('INVALID_STATE');
  });

  it('TEST-ORG-INT-02 tenants are isolated: same branch code, other tenant sees 404', async () => {
    const appA = appFor(admins(A, 'usr_a1'));
    const appB = appFor(admins(B, 'usr_b1'));
    const listA = await request(appA).get('/v1/branches');
    const listB = await request(appB).get('/v1/branches');
    expect(listA.body.data.map((b: { code: string }) => b.code)).toEqual(['MUM01', 'PUN01']);
    expect(listB.body.data.map((b: { code: string }) => b.code)).toEqual(['MUM01']);
    expect((await request(appB).get('/v1/branches/br_a')).status).toBe(404);
    expect(
      (await request(appB).patch('/v1/branches/br_a').set('If-Match', '"0"').send({ name: 'X' })).status,
    ).toBe(404);
  });

  it('TEST-ORG-INT-03 PATCH needs the current version; ETag advances', async () => {
    const app = appFor(admins(A, 'usr_a1'));
    const ok = await request(app)
      .patch('/v1/branches/br_a')
      .set('If-Match', '"0"')
      .send({ name: 'Mumbai Central' });
    expect(ok.status).toBe(200);
    expect(ok.headers.etag).toBe('"1"');
    const stale = await request(app)
      .patch('/v1/branches/br_a')
      .set('If-Match', '"0"')
      .send({ name: 'Again' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('TEST-ORG-INT-04 team members are effective-dated; removal keeps history', async () => {
    const app = appFor(admins(A, 'usr_a1'));
    const team = await request(app)
      .post('/v1/teams')
      .set('Idempotency-Key', 'team-sales-1')
      .send({ name: 'Sales', branchId: 'br_a', managerUserId: 'usr_a1' });
    expect(team.status).toBe(201);

    const set = await request(app)
      .put(`/v1/teams/${team.body.id}/members`)
      .set('If-Match', `"${team.body.version}"`)
      .send({ userIds: ['usr_a1', 'usr_a2'] });
    expect(set.status).toBe(200);
    expect(set.body.memberCount).toBe(2);

    const cleared = await request(app)
      .put(`/v1/teams/${team.body.id}/members`)
      .set('If-Match', `"${set.body.version}"`)
      .send({ userIds: [] });
    expect(cleared.body.memberCount).toBe(0);
    const history = await admin.query(
      `select count(*)::int as n from app.team_membership where team_id = $1`,
      [team.body.id],
    );
    expect(history.rows[0].n).toBe(2);

    const foreign = await request(app)
      .put(`/v1/teams/${team.body.id}/members`)
      .set('If-Match', `"${cleared.body.version}"`)
      .send({ userIds: ['usr_b1'] });
    expect(foreign.status).toBe(422);
    expect(foreign.body.error.code).toBe('INVALID_ASSIGNEE');
  });

  it('TEST-ORG-INT-05 one INTAKE queue per branch; round-robin alternates between pickable members', async () => {
    const app = appFor(admins(A, 'usr_a1'));
    const q = await request(app)
      .post('/v1/work-queues')
      .set('Idempotency-Key', 'queue-intake-1')
      .send({
        code: 'MUM01-INTAKE',
        name: 'Intake',
        kind: 'INTAKE',
        branchId: 'br_a',
        recordTypes: ['LEAD'],
      });
    expect(q.status).toBe(201);
    const second = await request(app)
      .post('/v1/work-queues')
      .set('Idempotency-Key', 'queue-intake-2')
      .send({
        code: 'MUM01-INTAKE2',
        name: 'Intake 2',
        kind: 'INTAKE',
        branchId: 'br_a',
        recordTypes: ['LEAD'],
      });
    expect(second.status).toBe(409);

    const members = await request(app)
      .put(`/v1/work-queues/${q.body.id}/members`)
      .set('If-Match', `"${q.body.version}"`)
      .send({
        members: [
          { userId: 'usr_a1', canPick: true, canAssign: true },
          { userId: 'usr_a2', canPick: true, canAssign: false },
        ],
      });
    expect(members.status).toBe(200);
    expect(members.body.memberCount).toBe(2);

    const dir = createUserDirectory();
    const txRunner = createTxRunner(db);
    const ctx = { principal: admins(A, 'usr_a1'), correlationId: 'c-int-0005', now: new Date() };
    const picks: string[] = [];
    for (let i = 0; i < 3; i++) {
      const pick = await txRunner.withTenantTx(ctx, (tx) => dir.pickRoundRobin(tx, q.body.id));
      picks.push(pick!.userId);
    }
    expect(picks).toEqual(['usr_a1', 'usr_a2', 'usr_a1']);
  });

  it('TEST-ORG-INT-06 a branch with users cannot be deactivated; every change is audited', async () => {
    const app = appFor(admins(A, 'usr_a1'));
    const current = await request(app).get('/v1/branches/br_a');
    const res = await request(app)
      .post('/v1/branches/br_a/deactivation')
      .set('If-Match', current.headers.etag as string);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');

    const audit = await admin.query(`select action from app.audit_event where tenant_id = $1 order by seq`, [
      A,
    ]);
    expect(audit.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(['branch.created', 'branch.updated', 'team.created', 'team.members_replaced']),
    );
  });

  it('TEST-ORG-INT-07 a branch manager manages teams and queue members of their own branch only', async () => {
    const admin = appFor(admins(A, 'usr_a1'));
    const branchMgr = appFor(
      testPrincipal({
        id: 'usr_a2',
        tenantId: A,
        grants: [{ code: 'user.manage', scope: 'BRANCH', branchIds: ['br_a'] }],
      }),
    );

    const own = await request(branchMgr)
      .post('/v1/teams')
      .set('Idempotency-Key', 'bm-team-own-1')
      .send({ name: 'Branch team', branchId: 'br_a' });
    expect(own.status).toBe(201);
    const ownMembers = await request(branchMgr)
      .put(`/v1/teams/${own.body.id}/members`)
      .set('If-Match', `"${own.body.version}"`)
      .send({ userIds: ['usr_a1'] });
    expect(ownMembers.status).toBe(200);

    const crossBranch = await request(branchMgr)
      .post('/v1/teams')
      .set('Idempotency-Key', 'bm-team-cross-1')
      .send({ name: 'Head office' });
    expect(crossBranch.status).toBe(403);

    const pune = await request(admin).get('/v1/branches?q=PUN01');
    const otherTeam = await request(admin)
      .post('/v1/teams')
      .set('Idempotency-Key', 'admin-team-pune-1')
      .send({ name: 'Pune team', branchId: pune.body.data[0].id });
    const otherMembers = await request(branchMgr)
      .put(`/v1/teams/${otherTeam.body.id}/members`)
      .set('If-Match', `"${otherTeam.body.version}"`)
      .send({ userIds: ['usr_a1'] });
    expect(otherMembers.status).toBe(403);

    const queue = await request(admin).get('/v1/work-queues?q=MUM01-INTAKE');
    const q = queue.body.data[0];
    const queueMembers = await request(branchMgr)
      .put(`/v1/work-queues/${q.id}/members`)
      .set('If-Match', `"${q.version}"`)
      .send({ members: [{ userId: 'usr_a1', canPick: true, canAssign: true }] });
    expect(queueMembers.status).toBe(200);

    expect((await request(branchMgr).get('/v1/organisations')).status).toBe(403);
  });
});
