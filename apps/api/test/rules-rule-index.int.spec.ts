// rule_set_rule stores exactly one of order_no / priority (CHECK in 0010). Covers the 0055 seed and the submit path against
// a real database, plus the pure helpers that decide which of the two a rule gets. Synthetic data only.
import type { PermissionGrant } from '@dsa/contracts';
import { createAuditPort, createAuthz, createIdGenerator, createUserDirectory } from '@dsa/kernel';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { ruleOrderNo, rulePriority } from '../src/modules/rules/db';
import { fakeAuth, testPrincipal } from './support/fake-auth';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

describe('which of order_no / priority a rule gets (pure)', () => {
  const both = { orderNo: 2, priority: 80 };

  it('TEST-RULEIDX-01 FIRST, UNIQUE, COLLECT and RULE_ORDER store order_no only, even when the rule also carries a priority', () => {
    for (const policy of ['FIRST', 'UNIQUE', 'COLLECT', 'RULE_ORDER']) {
      expect(ruleOrderNo(policy, both, 7), policy).toBe(2);
      expect(rulePriority(policy, both), policy).toBeNull();
    }
  });

  it('TEST-RULEIDX-02 PRIORITY stores priority only, even when the rule also carries an orderNo', () => {
    expect(ruleOrderNo('PRIORITY', both, 7)).toBeNull();
    expect(rulePriority('PRIORITY', both)).toBe(80);
  });

  it('TEST-RULEIDX-03 missing values fall back to the definition position (order) or 0 (priority)', () => {
    expect(ruleOrderNo('FIRST', {}, 3)).toBe(3);
    expect(rulePriority('PRIORITY', {})).toBe(0);
  });

  it('TEST-RULEIDX-04 exactly one of the two is ever set', () => {
    for (const policy of ['FIRST', 'UNIQUE', 'COLLECT', 'RULE_ORDER', 'PRIORITY'])
      for (const r of [{}, { orderNo: 1 }, { priority: 5 }, both]) {
        const set = [ruleOrderNo(policy, r, 0), rulePriority(policy, r)].filter((v) => v !== null);
        expect(set.length, `${policy} ${JSON.stringify(r)}`).toBe(1);
      }
  });
});

describe('rule_set_rule against a fresh database', () => {
  let env: IsolationEnv;
  beforeAll(async () => {
    env = await startIsolationEnv();
  }, 180_000);
  afterAll(async () => {
    await env?.stop();
  });

  const grants: PermissionGrant[] = (['rule.author', 'rule.simulate'] as const).map((code) => ({
    code,
    scope: 'TENANT',
    branchIds: [],
  }));

  function appAsAuthor() {
    const ids = createIdGenerator();
    return createApp({
      deps: {
        txRunner: createTxRunner(env.db),
        authz: createAuthz(),
        audit: createAuditPort(ids),
        ids,
        userDirectory: createUserDirectory(),
      },
      corsAllowedOrigins: [],
      auth: fakeAuth(
        testPrincipal({
          tenantId: env.A.tenantId,
          id: env.A.userIds[0],
          primaryBranchId: env.A.branchId,
          authTime: new Date().toISOString(),
          grants,
        }),
      ),
    });
  }

  it('TEST-RULEIDX-05 migration 0055 seeds the four approved eligibility rules with order_no 0..3 and no priority', async () => {
    const { rows } = await env.admin.query(
      `SELECT r.rule_uid, r.order_no, r.priority, v.hit_policy, v.tenant_id
         FROM app.rule_set_rule r JOIN app.rule_set_version v ON v.id = r.version_id
        WHERE r.rule_uid LIKE 'RUL-ELG-%' ORDER BY v.tenant_id, r.order_no`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.length % 4).toBe(0);
    for (const r of rows) {
      expect(r.hit_policy).toBe('FIRST');
      expect(r.priority).toBeNull();
    }
    const first = rows.filter((r) => r.tenant_id === rows[0]!.tenant_id);
    expect(first.map((r) => [r.rule_uid, r.order_no])).toEqual([
      ['RUL-ELG-001', 0],
      ['RUL-ELG-002', 1],
      ['RUL-ELG-003', 2],
      ['RUL-ELG-004', 3],
    ]);
  });

  it('TEST-RULEIDX-06 the seeded definition keeps both fields (the evaluation input is unchanged)', async () => {
    const { rows } = await env.admin.query(
      `SELECT definition->'rules'->0 AS first_rule FROM app.rule_set_version
        WHERE content_hash = 'sha256:9e492649899860eb1d5491c443d001b167a6d8bd0fbefb45bd6fa827e9f5b3d2' LIMIT 1`,
    );
    expect(rows[0]!.first_rule).toMatchObject({ uid: 'RUL-ELG-001', orderNo: 0, priority: 100 });
  });

  it('TEST-RULEIDX-07 no row in the table violates the exactly-one rule', async () => {
    const { rows } = await env.admin.query(
      `SELECT count(*)::int AS bad FROM app.rule_set_rule WHERE (order_no IS NULL) = (priority IS NULL)`,
    );
    expect(rows[0]!.bad).toBe(0);
  });

  it('TEST-RULEIDX-08 submitting a FIRST version whose rules carry both orderNo and priority stores order_no only', async () => {
    const app = appAsAuthor();
    const created = await request(app)
      .post('/v1/rule-sets')
      .send({ decisionKey: 'DK-application.eligibility', scopeType: 'TENANT_DEFAULT', name: 'Index test' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const ruleSetId = created.body.id as string;
    const versions = await request(app).get(`/v1/rule-sets/${ruleSetId}/versions`);
    const versionId = versions.body.data[0].id as string;
    const draft = await request(app).get(`/v1/rule-set-versions/${versionId}`);
    const etag = draft.headers.etag as string;

    const output = (result: string) => ({
      result,
      maxEligibleAmount: null,
      reasons: [{ code: 'TEST', text: 'test' }],
    });
    const definition = {
      schemaVersion: 1,
      hitPolicy: 'FIRST',
      defaultOutput: output('REFER'),
      rules: [
        {
          uid: 'RUL-IDX-001',
          name: 'Low score',
          orderNo: 0,
          priority: 100,
          enabled: true,
          conditions: [{ field: 'applicant.credit_score', operator: '<', value: 500 }],
          output: output('INELIGIBLE'),
          explanation: 'test',
        },
        {
          uid: 'RUL-IDX-002',
          name: 'Good score',
          orderNo: 1,
          priority: 90,
          enabled: true,
          conditions: [{ field: 'applicant.credit_score', operator: '>=', value: 700 }],
          output: output('ELIGIBLE'),
          explanation: 'test',
        },
      ],
    };
    const put = await request(app)
      .put(`/v1/rule-set-versions/${versionId}`)
      .set('If-Match', etag)
      .send({ definition, hitPolicy: 'FIRST', defaultOutput: output('REFER'), changeReason: 'index test' });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const validated = await request(app).post(`/v1/rule-set-versions/${versionId}/validate`);
    expect(validated.status, JSON.stringify(validated.body)).toBeLessThan(300);
    const submitted = await request(app)
      .post(`/v1/rule-set-versions/${versionId}/submit`)
      .send({ changeReason: 'index test' });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);

    const { rows } = await env.admin.query(
      `SELECT rule_uid, order_no, priority FROM app.rule_set_rule WHERE version_id = $1 ORDER BY order_no`,
      [versionId],
    );
    expect(rows).toEqual([
      { rule_uid: 'RUL-IDX-001', order_no: 0, priority: null },
      { rule_uid: 'RUL-IDX-002', order_no: 1, priority: null },
    ]);
  });
});
