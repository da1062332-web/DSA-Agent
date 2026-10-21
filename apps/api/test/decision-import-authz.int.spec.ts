// Permission audit F-05 and F-06 (docs/PERMISSION_UI_VISIBILITY_AUDIT.md), on a throwaway PostgreSQL as the API role (NOBYPASSRLS), through the
// full app and the real routes. Role grant sets are the live grants of tenant qloax-dsa as read from hosted on 2026-10-19.
//   F-05  POST /v1/decisions/:key/evaluations needs rule.simulate; the engine used in-process by leads, tasks, applications and automation is
//         not behind it, and a result stored for one tenant is never replayed to another.
//   F-06  GET /v1/imports, /imports/:id and /imports/:id/report need an import permission; import.run and config.manage see every batch of the
//         tenant, anyone else sees only their own uploads of the targets they may use.
// Every evaluation here uses facts nobody else used: the engine derives the record id from the facts alone (finding F-23, see the todo below).
import type { PermissionCode, RequestContext } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { LiveDecisionEngine } from '../src/modules/rules/engine/decision-engine';
import { testPrincipal } from './support/fake-auth';

const P = (...c: string[]) => c as PermissionCode[];
const NONE = P();
const READ_ONLY_STAFF = P('customer.read', 'lead.read', 'task.read'); // no create or import permission
const SALES_EXEC = P(
  'activity.create',
  'consent.record',
  'customer.read',
  'lead.create',
  'lead.qualify',
  'lead.read',
  'lead.update',
  'message.send',
  'task.read',
);
const RM = P('application.read', 'customer.create', 'customer.read', 'lead.create', 'lead.read', 'task.read');
const RULE_AUTHOR = P('rule.author', 'rule.simulate');
const RULE_APPROVER = P('rule.approve', 'rule.publish', 'rule.simulate', 'rule.suspend');
const RULE_AUTHOR_ONLY = P('rule.author'); // a hypothetical role without rule.simulate
const BRANCH_MGR = P('import.run', 'export.run', 'lead.read');
const TENANT_ADMIN = P('config.manage', 'user.manage', 'role.manage');
const LEAD_CREATOR = P('lead.create', 'lead.read');
const CUSTOMER_CREATOR = P('customer.create', 'customer.read');

let env: IsolationEnv;
const as = (tenant: 'A' | 'B', codes: PermissionCode[], userIndex: 0 | 1 = 0) =>
  env.appAs(tenant === 'A' ? env.A : env.B, codes, userIndex);
const nonce = () => Math.random().toString(36).slice(2, 12);
const idem = () => 'dia-' + nonce();

/** Facts no earlier call used, so the hash-derived record id is new (F-23). */
const factsFor = (tag: string) => ({
  lead: { branch_id: `br_${tag}`, product_category: 'PL', source: 'WEB' },
  context: { local_hour: 14, local_weekday: 'MON' },
});
const evaluate = (tenant: 'A' | 'B', codes: PermissionCode[], key: string, tag = nonce()) =>
  request(as(tenant, codes))
    .post('/v1/decisions/DK-lead.assignment/evaluations')
    .set('Idempotency-Key', key)
    .send({ subject: { type: 'LEAD', id: 'lead_01JTESTLEAD00000000000001' }, facts: factsFor(tag) });

const importIds = (res: { body: { data?: { id: string }[] } | { id: string }[] }) =>
  ((Array.isArray(res.body) ? res.body : (res.body.data ?? [])) as { id: string }[]).map((b) => b.id).sort();

beforeAll(async () => {
  env = await startIsolationEnv();
  const batch = (id: string, tenant: string, user: string, target: 'LEAD' | 'CUSTOMER') =>
    env.admin.query(
      `INSERT INTO app.import_batch (id, tenant_id, requester_id, target_entity, source_file_key, file_format, file_size_bytes, checksum_sha256, status)
       VALUES ($1, $2, $3, $4, 'k/' || $1, 'CSV', 10, 'abc', 'UPLOADED')`,
      [id, tenant, user, target],
    );
  await batch('imp_dia_lead', env.A.tenantId, env.A.userIds[0], 'LEAD');
  await batch('imp_dia_customer', env.A.tenantId, env.A.userIds[0], 'CUSTOMER');
  await batch('imp_dia_other_tenant', env.B.tenantId, env.B.userIds[0], 'LEAD');
}, 240_000);

afterAll(async () => {
  await env?.stop();
});

describe('F-05 decision evaluation over HTTP needs rule.simulate', () => {
  it('TEST-DIA-F05-01 no permissions, sales, RM, branch manager, tenant admin and rule.author without rule.simulate are refused (403) before the body is read', async () => {
    for (const codes of [NONE, SALES_EXEC, RM, BRANCH_MGR, TENANT_ADMIN, RULE_AUTHOR_ONLY]) {
      const res = await evaluate('A', codes, idem());
      expect(res.status, codes.join(',')).toBe(403);
    }
    // refused before the Idempotency-Key and the body are validated: a malformed call learns nothing
    const bare = await request(as('A', NONE)).post('/v1/decisions/DK-lead.assignment/evaluations').send({});
    expect(bare.status).toBe(403);
    const records = await env.admin.query(
      `SELECT count(*)::int AS n FROM app.decision_record WHERE tenant_id = $1`,
      [env.A.tenantId],
    );
    expect(records.rows[0].n).toBe(0);
  });

  it('TEST-DIA-F05-02 rule.author with rule.simulate, and the rule approver, are allowed and a valid payload returns a decision record', async () => {
    for (const codes of [RULE_AUTHOR, RULE_APPROVER]) {
      const res = await evaluate('A', codes, idem());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.decisionKey).toBe('DK-lead.assignment');
      expect(res.body.decisionRecordId).toBeDefined();
    }
  });

  it('TEST-DIA-F05-03 a refused caller cannot pre-seed a result under an Idempotency-Key that server code later uses', async () => {
    const key = 'lead_forged:first-contact';
    expect((await evaluate('A', SALES_EXEC, key)).status).toBe(403);
    const seeded = await env.admin.query(
      `SELECT count(*)::int AS n FROM app.decision_record WHERE idempotency_key = $1`,
      [key],
    );
    expect(seeded.rows[0].n).toBe(0);
  });

  it('TEST-DIA-F05-04 replay is per tenant: tenant B with the same key gets its own fresh record, never tenant A’s; tenant A still replays its own', async () => {
    const key = idem();
    const a = await evaluate('A', RULE_AUTHOR, key);
    expect(a.status).toBe(200);
    const b = await evaluate('B', RULE_AUTHOR, key); // other facts: only the key is shared
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    expect(b.body.replayed).toBe(false);
    expect(b.body.decisionRecordId).not.toBe(a.body.decisionRecordId);
    const again = await evaluate('A', RULE_AUTHOR, key);
    expect(again.body.replayed).toBe(true);
    expect(again.body.decisionRecordId).toBe(a.body.decisionRecordId);
  });

  it('TEST-DIA-F05-05 server code still evaluates in-process with no permission check: a system identity with no grants gets a decision', async () => {
    const engine = new LiveDecisionEngine();
    const txRunner = createTxRunner(env.db);
    const ctx: RequestContext = {
      principal: testPrincipal({
        kind: 'SERVICE',
        id: 'SYSTEM:lead-service',
        tenantId: env.A.tenantId,
        grants: [],
      }),
      correlationId: 'corr-dia-system',
      now: new Date(),
    };
    const result = await txRunner.withTenantTx(ctx, (tx) =>
      engine.decide(tx, ctx, {
        decisionKey: 'DK-lead.assignment',
        scope: { branchId: 'br_mumbai' } as never,
        subject: { type: 'LEAD', id: 'lead_01JTESTLEAD00000000000002' },
        facts: factsFor(nonce()) as never,
        evaluationTime: new Date().toISOString(),
        idempotencyKey: 'lead_route:corr-dia-system',
      }),
    );
    expect(result.decisionRecordId).toBeDefined();
  });

  it('TEST-DIA-F23-01 identical facts under different keys, and identical facts in two tenants, each get their own record (no 409 collision)', async () => {
    const sameFacts = nonce();
    const first = await evaluate('A', RULE_AUTHOR, idem(), sameFacts);
    const second = await evaluate('A', RULE_AUTHOR, idem(), sameFacts); // same facts, another key
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.decisionRecordId).not.toBe(first.body.decisionRecordId);

    const other = await evaluate('B', RULE_AUTHOR, idem(), sameFacts); // same facts, another tenant
    expect(other.status, JSON.stringify(other.body)).toBe(200);
    expect(other.body.decisionRecordId).not.toBe(first.body.decisionRecordId);
  });
});

describe('F-06 import batch reads need an import permission', () => {
  it('TEST-DIA-F06-01 no permissions, read-only staff and the rule roles are refused on the list, the detail and the report, including for an unknown id (403, not 404)', async () => {
    for (const codes of [NONE, READ_ONLY_STAFF, RULE_AUTHOR, RULE_APPROVER]) {
      for (const path of [
        '/v1/imports',
        '/v1/imports/imp_dia_lead',
        '/v1/imports/imp_missing',
        '/v1/imports/imp_dia_lead/report',
      ]) {
        const res = await request(as('A', codes)).get(path);
        expect(res.status, `${codes.join(',')} ${path}`).toBe(403);
      }
    }
  });

  it('TEST-DIA-F06-02 import.run and config.manage see every batch of their tenant, and only their tenant', async () => {
    for (const codes of [BRANCH_MGR, TENANT_ADMIN]) {
      const res = await request(as('A', codes)).get('/v1/imports');
      expect(res.status).toBe(200);
      expect(importIds(res)).toEqual(['imp_dia_customer', 'imp_dia_lead']);
    }
    const other = await request(as('B', BRANCH_MGR)).get('/v1/imports');
    expect(importIds(other)).toEqual(['imp_dia_other_tenant']);
  });

  it('TEST-DIA-F06-03 a caller who can create only leads sees only their own lead batches; only customers, only customer batches', async () => {
    expect(importIds(await request(as('A', LEAD_CREATOR)).get('/v1/imports'))).toEqual(['imp_dia_lead']);
    expect(importIds(await request(as('A', CUSTOMER_CREATOR)).get('/v1/imports'))).toEqual([
      'imp_dia_customer',
    ]);
    // sales and RM hold lead.create (and customer.create for RM): their own uploads only
    expect(importIds(await request(as('A', SALES_EXEC)).get('/v1/imports'))).toEqual(['imp_dia_lead']);
    expect(importIds(await request(as('A', RM)).get('/v1/imports'))).toEqual([
      'imp_dia_customer',
      'imp_dia_lead',
    ]);

    // the per-batch target check is unchanged: the wrong target is still a refusal on the detail
    expect((await request(as('A', LEAD_CREATOR)).get('/v1/imports/imp_dia_customer')).status).toBe(403);
    expect((await request(as('A', LEAD_CREATOR)).get('/v1/imports/imp_dia_lead')).status).toBe(200);
  });

  it('TEST-DIA-F06-04 another user’s batch is invisible to a caller without import.run or config.manage: empty list, 404 on the detail and the report', async () => {
    // user 2 of the same tenant, same permissions as the uploader (user 1)
    expect(importIds(await request(as('A', LEAD_CREATOR, 1)).get('/v1/imports'))).toEqual([]);
    expect((await request(as('A', LEAD_CREATOR, 1)).get('/v1/imports/imp_dia_lead')).status).toBe(404);
    expect((await request(as('A', LEAD_CREATOR, 1)).get('/v1/imports/imp_dia_lead/report')).status).toBe(404);
    // an import administrator is not restricted to their own uploads
    expect((await request(as('A', BRANCH_MGR, 1)).get('/v1/imports/imp_dia_lead')).status).toBe(200);
  });

  it('TEST-DIA-F06-05 another tenant’s batch is invisible: 404 for an import user of tenant A, never the batch', async () => {
    const res = await request(as('A', BRANCH_MGR)).get('/v1/imports/imp_dia_other_tenant');
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('imp_dia_other_tenant/');
  });
});
