// Org chart (API-ORG-010), access reviews (API-ACL-005/006, M-080), BRE reference lists (API-BRE-028/029, M-079) and the
// lender reason map (API-LND-007, M-078) against a real database, with the production wiring. Synthetic data only.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mapLenderReason } from '../src/modules/origination/catalogue/reason-map';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

let env: IsolationEnv;

beforeAll(async () => {
  env = await startIsolationEnv();
  const a = env.A;
  const q = (text: string, values: unknown[]) => env.admin.query(text, values);
  await q(
    `insert into app.role (id, tenant_id, code, name, created_by) values ('role_oab_1', $1, 'ROLE-OAB', 'Reviewed role', 'iso')`,
    [a.tenantId],
  );
  await q(
    `insert into app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, created_by)
     values ('ura_oab_1', $1, $2, 'role_oab_1', 'TENANT', 'iso'), ('ura_oab_2', $1, $3, 'role_oab_1', 'TENANT', 'iso')`,
    [a.tenantId, a.userIds[0], a.userIds[1]],
  );
  await q(
    `insert into app.lender (id, tenant_id, name, lender_type, created_by, updated_by) values ('lnd_oab_1', $1, 'Map Lender', 'NBFC', 'iso', 'iso')`,
    [a.tenantId],
  );
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

describe('TEST-OAB-INT org chart, access reviews, reference lists, reason map', () => {
  it('TEST-OAB-INT-01 API-ORG-010 shows branches, teams, managers and members as of a date', async () => {
    const res = await request(env.appAs(env.A, [])).get('/v1/org-chart');
    expect(res.status).toBe(200);
    const team = res.body.branches[0].teams[0];
    expect(team.manager.userId).toBe(env.A.userIds[0]);
    expect(team.members.map((m: { userId: string }) => m.userId)).toContain(env.A.userIds[1]);
    const before = await request(env.appAs(env.A, [])).get('/v1/org-chart?asOf=2020-01-01T00:00:00Z');
    expect(before.body.branches[0].teams[0].members).toEqual([]);
  });

  it("TEST-OAB-INT-02 API-ACL-005/006 snapshots assignments; SOD-10 refuses one's own; REVOKE ends the assignment", async () => {
    const app = env.appAs(env.A, ['user.manage']);
    const started = await request(app)
      .post('/v1/access-reviews')
      .set('Idempotency-Key', 'oab_review_0001')
      .send({ name: 'Quarterly review', dueAt: '2030-01-01T00:00:00Z' });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const own = started.body.items.find((i: { userId: string }) => i.userId === env.A.userIds[0]);
    const other = started.body.items.find((i: { userId: string }) => i.userId === env.A.userIds[1]);
    const self = await request(app)
      .post(`/v1/access-reviews/${started.body.id}/decisions`)
      .send({ decisions: [{ itemId: own.id, decision: 'CERTIFY' }] });
    expect(self.status).toBe(403);
    const revoke = await request(app)
      .post(`/v1/access-reviews/${started.body.id}/decisions`)
      .send({ decisions: [{ itemId: other.id, decision: 'REVOKE', reason: 'Moved teams' }] });
    expect(revoke.status, JSON.stringify(revoke.body)).toBe(200);
    const live = await env.admin.query(
      `select count(*)::int as n from app.user_role_assignment where id = 'ura_oab_2' and effective_range @> now()`,
    );
    expect(live.rows[0].n).toBe(0);
  });

  it('TEST-OAB-INT-03 API-BRE-028/029 creates a list by code, publishes versions, refuses wrong types and oversize lists', async () => {
    const app = env.appAs(env.A, ['config.manage', 'rule.author']);
    const v1 = await request(app)
      .post('/v1/reference-lists/SERVICEABLE_PINCODES/versions')
      .set('Idempotency-Key', 'oab_list_0001')
      .send({ name: 'Serviceable pincodes', valueType: 'PINCODE', values: ['400001', '411001'] });
    expect(v1.status, JSON.stringify(v1.body)).toBe(201);
    expect(v1.body.versionNo).toBe(1);
    const v2 = await request(app)
      .post(`/v1/reference-lists/${v1.body.listId}/versions`)
      .set('Idempotency-Key', 'oab_list_0002')
      .send({ values: ['400001', '411001', '560001'] });
    expect(v2.body.versionNo).toBe(2);
    const bad = await request(app)
      .post(`/v1/reference-lists/${v1.body.listId}/versions`)
      .set('Idempotency-Key', 'oab_list_0003')
      .send({ values: ['ABC'] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details[0].issue).toBe('TYPE_MISMATCH');
    const big = await request(app)
      .post(`/v1/reference-lists/${v1.body.listId}/versions`)
      .set('Idempotency-Key', 'oab_list_0004')
      .send({ values: Array.from({ length: 1001 }, (_, i) => String(400000 + i)) });
    expect(big.body.error.details[0].issue).toBe('LIST_TOO_LARGE');
    const list = await request(app).get('/v1/reference-lists');
    expect(list.body.data[0].versions.map((v: { versionNo: number }) => v.versionNo)).toEqual([2, 1]);
    expect((await request(env.appAs(env.B, ['rule.author'])).get('/v1/reference-lists')).body.data).toEqual(
      [],
    );
  });

  it('TEST-OAB-INT-04 API-LND-007 replaces the reason map under If-Match, and maps lender wording to codes', async () => {
    const app = env.appAs(env.A, ['config.manage']);
    const cur = await request(app).get('/v1/lenders/lnd_oab_1/reason-map');
    expect(cur.body.mappings).toEqual([]);
    const put = await request(app)
      .put('/v1/lenders/lnd_oab_1/reason-map')
      .set('If-Match', String(cur.headers.etag))
      .send({ mappings: [{ lenderReason: 'Low CIBIL', reasonCode: 'CREDIT_HISTORY' }] });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(mapLenderReason(put.body.mappings, '  low cibil ')).toBe('CREDIT_HISTORY');
    expect(mapLenderReason(put.body.mappings, 'something else')).toBe('OTHER');
    const stale = await request(app)
      .put('/v1/lenders/lnd_oab_1/reason-map')
      .set('If-Match', String(cur.headers.etag))
      .send({ mappings: [] });
    expect(stale.status).toBe(409);
    expect(
      (await request(env.appAs(env.B, ['config.manage'])).get('/v1/lenders/lnd_oab_1/reason-map')).status,
    ).toBe(404);
  });
});
