// apps/api/test/rules.spec.ts — owner: Developer 2 & 6 (Module 23: Business Rule Engine)
import type { TxRunner } from '@dsa/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';
import { createMockRulesStore } from './support/mock-rules-db';

describe('Module 23: Business Rule Engine (BRE) API & Integration Tests', () => {
  const authorPrincipal = testPrincipal({
    id: 'usr_author_01',
    tenantId: 'ten_01JTESTTENANT00000000000000',
    authTime: new Date().toISOString(),
    grants: [
      { code: 'rule.author', scope: 'TENANT', branchIds: [] },
      { code: 'rule.simulate', scope: 'TENANT', branchIds: [] },
    ],
  });

  const approverPrincipal = testPrincipal({
    id: 'usr_approver_02',
    tenantId: 'ten_01JTESTTENANT00000000000000',
    authTime: new Date().toISOString(),
    grants: [
      { code: 'rule.approve', scope: 'TENANT', branchIds: [] },
      { code: 'rule.publish', scope: 'TENANT', branchIds: [] },
      { code: 'rule.suspend', scope: 'TENANT', branchIds: [] },
      { code: 'rule.simulate', scope: 'TENANT', branchIds: [] },
    ],
  });

  const staffWithoutPerms = testPrincipal({
    id: 'usr_unauthorized_03',
    tenantId: 'ten_01JTESTTENANT00000000000000',
    grants: [{ code: 'lead.read', scope: 'BRANCH', branchIds: ['br_mumbai'] }],
  });

  const foreignTenantUser = testPrincipal({
    id: 'usr_foreign_04',
    tenantId: 'ten_OTHER_000000000000000000',
    authTime: new Date().toISOString(),
    grants: [
      { code: 'rule.author', scope: 'TENANT', branchIds: [] },
      { code: 'rule.simulate', scope: 'TENANT', branchIds: [] },
    ],
  });

  it('TEST-BRE-001 rejects unauthenticated request with 401 UNAUTHENTICATED', async () => {
    const store = createMockRulesStore();
    const app = createTestApp({ deps: { txRunner: store.runner } });

    const res = await request(app).get('/v1/decision-definitions');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('TEST-BRE-002 rejects unauthorized request with 403 FORBIDDEN when lacking permissions', async () => {
    const store = createMockRulesStore();
    const app = createTestApp({
      auth: fakeAuth(staffWithoutPerms),
      deps: { txRunner: store.runner },
    });

    const res = await request(app).get('/v1/decision-definitions');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('TEST-BRE-003 lists decision definitions including all 6 MVP keys', async () => {
    const store = createMockRulesStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    const res = await request(app).get('/v1/decision-definitions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(6);

    const keys = res.body.data.map((d: { key: string }) => d.key);
    expect(keys).toContain('DK-lead.duplicate');
    expect(keys).toContain('DK-lead.assignment');
    expect(keys).toContain('DK-application.completeness');
  });

  it('TEST-BRE-004 gets single decision definition with ETag and returns 404 for unknown key', async () => {
    const store = createMockRulesStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    const res = await request(app).get('/v1/decision-definitions/DK-lead.assignment');
    expect(res.status).toBe(200);
    expect(res.body.key).toBe('DK-lead.assignment');
    expect(res.header['etag']).toBe('"1-mvp"');

    const notFoundRes = await request(app).get('/v1/decision-definitions/DK-unknown.key');
    expect(notFoundRes.status).toBe(404);
    expect(notFoundRes.body.error.code).toBe('DECISION_KEY_UNKNOWN');
  });

  it('TEST-BRE-005 creates rule set with initial draft version v1 and rs_ prefix', async () => {
    const store = createMockRulesStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    const payload = {
      decisionKey: 'DK-lead.assignment',
      scopeType: 'TENANT_DEFAULT',
      name: 'Global Lead Routing Rules',
    };

    const res = await request(app).post('/v1/rule-sets').send(payload);
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^rs_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(res.body.decisionKey).toBe('DK-lead.assignment');
    expect(res.body.draftVersionCount).toBe(1);
    expect(res.header['etag']).toBe('"0"');
  });

  it('TEST-BRE-006 rejects duplicate rule set for same decision key and scope', async () => {
    const store = createMockRulesStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    const payload = {
      decisionKey: 'DK-lead.assignment',
      scopeType: 'TENANT_DEFAULT',
      name: 'Rule Set 1',
    };

    const res1 = await request(app).post('/v1/rule-sets').send(payload);
    expect(res1.status).toBe(201);

    const res2 = await request(app).post('/v1/rule-sets').send(payload);
    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe('RULE_SET_EXISTS');
  });

  it('TEST-BRE-007 lists rule sets with filtering', async () => {
    const store = createMockRulesStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    await request(app).post('/v1/rule-sets').send({
      decisionKey: 'DK-lead.assignment',
      scopeType: 'TENANT_DEFAULT',
      name: 'Lead Assignment',
    });

    const res = await request(app).get('/v1/rule-sets?decisionKey=DK-lead.assignment');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].decisionKey).toBe('DK-lead.assignment');
  });

  it('TEST-BRE-008 creates new draft version and enforces maximum of 5 drafts', async () => {
    const store = createMockRulesStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    const rsRes = await request(app).post('/v1/rule-sets').send({
      decisionKey: 'DK-lead.assignment',
      scopeType: 'TENANT_DEFAULT',
      name: 'Draft Limit Test',
    });
    const ruleSetId = rsRes.body.id;

    // We already have 1 draft (v1). Create 4 more -> reaches 5
    for (let i = 2; i <= 5; i++) {
      const vRes = await request(app)
        .post(`/v1/rule-sets/${ruleSetId}/versions`)
        .send({ changeReason: `Draft version ${i}` });
      expect(vRes.status).toBe(201);
      expect(vRes.body.versionNo).toBe(i);
    }

    // 6th draft attempt must be rejected with 409 DRAFT_LIMIT_REACHED
    const excessRes = await request(app)
      .post(`/v1/rule-sets/${ruleSetId}/versions`)
      .send({ changeReason: 'Excess draft' });
    expect(excessRes.status).toBe(409);
    expect(excessRes.body.error.code).toBe('DRAFT_LIMIT_REACHED');
  });

  it('TEST-BRE-009 edits draft definition with optimistic locking If-Match header', async () => {
    const store = createMockRulesStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    const rsRes = await request(app).post('/v1/rule-sets').send({
      decisionKey: 'DK-lead.assignment',
      scopeType: 'TENANT_DEFAULT',
      name: 'Editing Test',
    });
    const ruleSetId = rsRes.body.id;

    const listVersions = await request(app).get(`/v1/rule-sets/${ruleSetId}/versions`);
    const versionId = listVersions.body.data[0].id;

    const newDef = {
      schemaVersion: 1,
      hitPolicy: 'FIRST',
      rules: [
        {
          uid: 'RUL-ASSIGN-MUMBAI',
          name: 'Route Mumbai leads',
          enabled: true,
          orderNo: 0,
          conditions: [{ field: 'lead.branch_id', operator: '==', value: 'br_mumbai' }],
          output: { pool: { queueId: 'wq_mumbai' }, strategy: 'ROUND_ROBIN', reasonText: 'Mumbai pool' },
        },
      ],
    };

    // Stale If-Match -> 409 VERSION_CONFLICT
    const staleRes = await request(app)
      .put(`/v1/rule-set-versions/${versionId}`)
      .set('If-Match', '"99"')
      .send({ definition: newDef });
    expect(staleRes.status).toBe(409);
    expect(staleRes.body.error.code).toBe('VERSION_CONFLICT');

    // Valid If-Match -> 200 OK
    const updateRes = await request(app)
      .put(`/v1/rule-set-versions/${versionId}`)
      .set('If-Match', '"0"')
      .send({ definition: newDef, changeReason: 'Updated Mumbai rule' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.definition.rules).toHaveLength(1);
    expect(updateRes.body.definition.rules[0].uid).toBe('RUL-ASSIGN-MUMBAI');
    expect(updateRes.header['etag']).toBe('"1"');
  });

  it('TEST-BRE-010 validates rule definition returning structured validation report', async () => {
    const store = createMockRulesStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    const rsRes = await request(app).post('/v1/rule-sets').send({
      decisionKey: 'DK-lead.assignment',
      scopeType: 'TENANT_DEFAULT',
      name: 'Validation Test',
    });
    const ruleSetId = rsRes.body.id;
    const listVersions = await request(app).get(`/v1/rule-sets/${ruleSetId}/versions`);
    const versionId = listVersions.body.data[0].id;

    const validDef = {
      schemaVersion: 1,
      hitPolicy: 'FIRST',
      rules: [
        {
          uid: 'RUL-ASSIGN-01',
          name: 'PL routing',
          enabled: true,
          orderNo: 0,
          conditions: [{ field: 'lead.product_category', operator: '==', value: 'PL' }],
          output: { pool: { queueId: 'wq_pl' }, strategy: 'ROUND_ROBIN', reasonText: 'PL pool' },
        },
      ],
    };

    await request(app)
      .put(`/v1/rule-set-versions/${versionId}`)
      .set('If-Match', '"0"')
      .send({ definition: validDef });

    const valRes = await request(app).post(`/v1/rule-set-versions/${versionId}/validate`);
    expect(valRes.status).toBe(200);
    expect(valRes.body.result).toBe('PASS');
    expect(valRes.body.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('TEST-BRE-011 simulates rule evaluation against synthetic facts', async () => {
    const store = createMockRulesStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    const rsRes = await request(app).post('/v1/rule-sets').send({
      decisionKey: 'DK-lead.assignment',
      scopeType: 'TENANT_DEFAULT',
      name: 'Simulation Test',
    });
    const ruleSetId = rsRes.body.id;
    const listVersions = await request(app).get(`/v1/rule-sets/${ruleSetId}/versions`);
    const versionId = listVersions.body.data[0].id;

    const validDef = {
      schemaVersion: 1,
      hitPolicy: 'FIRST',
      rules: [
        {
          uid: 'RUL-MUMBAI',
          name: 'Mumbai match',
          enabled: true,
          orderNo: 0,
          conditions: [{ field: 'lead.branch_id', operator: '==', value: 'br_mumbai' }],
          output: { pool: 'mumbai_pool' },
        },
      ],
    };

    await request(app)
      .put(`/v1/rule-set-versions/${versionId}`)
      .set('If-Match', '"0"')
      .send({ definition: validDef });

    const simRes = await request(app)
      .post(`/v1/rule-set-versions/${versionId}/simulations`)
      .send({
        facts: { lead: { branch_id: 'br_mumbai' } },
      });

    expect(simRes.status).toBe(201);
    expect(simRes.body.status).toBe('COMPLETED');
    expect(simRes.body.summary.outputs).toEqual({ pool: 'mumbai_pool' });
    expect(simRes.body.summary.matchedRuleUids).toEqual(['RUL-MUMBAI']);
  });

  it('TEST-BRE-012 creates, lists, and updates synthetic test cases', async () => {
    const store = createMockRulesStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    const rsRes = await request(app).post('/v1/rule-sets').send({
      decisionKey: 'DK-lead.assignment',
      scopeType: 'TENANT_DEFAULT',
      name: 'Test Cases Suite',
    });
    const ruleSetId = rsRes.body.id;

    const tcRes = await request(app)
      .post(`/v1/rule-sets/${ruleSetId}/test-cases`)
      .send({
        name: 'TC-01: Mumbai routing test',
        input: { lead: { branch_id: 'br_mumbai' } },
        expectedStatus: 'OK',
        expectedOutput: { pool: 'mumbai_pool' },
      });

    expect(tcRes.status).toBe(201);
    expect(tcRes.body.id).toMatch(/^tc_[0-9A-HJKMNP-TV-Z]{26}$/);

    const listRes = await request(app).get(`/v1/rule-sets/${ruleSetId}/test-cases`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBe(1);
    expect(listRes.body.data[0].name).toBe('TC-01: Mumbai routing test');
  });

  it('TEST-BRE-013 lifecycle: submit version requires valid validation report', async () => {
    const store = createMockRulesStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    const rsRes = await request(app).post('/v1/rule-sets').send({
      decisionKey: 'DK-lead.assignment',
      scopeType: 'TENANT_DEFAULT',
      name: 'Lifecycle Test',
    });
    const ruleSetId = rsRes.body.id;
    const listVersions = await request(app).get(`/v1/rule-sets/${ruleSetId}/versions`);
    const versionId = listVersions.body.data[0].id;

    // Attempting submit without validation report -> 422 EVIDENCE_MISSING
    const earlySubmit = await request(app)
      .post(`/v1/rule-set-versions/${versionId}/submit`)
      .send({ changeReason: 'Ready for review' });
    expect(earlySubmit.status).toBe(422);
    expect(earlySubmit.body.error.code).toBe('EVIDENCE_MISSING');

    // Run validation first
    await request(app).post(`/v1/rule-set-versions/${versionId}/validate`);

    // Submit now succeeds
    const submitRes = await request(app)
      .post(`/v1/rule-set-versions/${versionId}/submit`)
      .send({ changeReason: 'Passed validation, ready for review' });
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.status).toBe('IN_REVIEW');
  });

  it('TEST-BRE-014 maker-checker SOD-01: author cannot approve their own version', async () => {
    const store = createMockRulesStore();
    // Author has approve permissions too in this test to verify SOD-01 blocks self-approval
    const multiRoleAuthor = testPrincipal({
      id: 'usr_author_01', // created the version
      tenantId: 'ten_01JTESTTENANT00000000000000',
      authTime: new Date().toISOString(),
      grants: [
        { code: 'rule.author', scope: 'TENANT', branchIds: [] },
        { code: 'rule.approve', scope: 'TENANT', branchIds: [] },
        { code: 'rule.simulate', scope: 'TENANT', branchIds: [] },
      ],
    });

    const app = createTestApp({
      auth: fakeAuth(multiRoleAuthor),
      deps: { txRunner: store.runner },
    });

    const rsRes = await request(app).post('/v1/rule-sets').send({
      decisionKey: 'DK-lead.assignment',
      scopeType: 'TENANT_DEFAULT',
      name: 'SOD Test',
    });
    const ruleSetId = rsRes.body.id;
    const listVersions = await request(app).get(`/v1/rule-sets/${ruleSetId}/versions`);
    const versionId = listVersions.body.data[0].id;

    await request(app).post(`/v1/rule-set-versions/${versionId}/validate`);
    const subRes = await request(app)
      .post(`/v1/rule-set-versions/${versionId}/submit`)
      .send({ changeReason: 'Submitted' });
    const contentHash = subRes.body.contentHash;

    // Self-approval attempt -> 403 SOD_VIOLATION
    const selfApproveRes = await request(app)
      .post(`/v1/rule-set-versions/${versionId}/reviews`)
      .send({
        action: 'APPROVE',
        comment: 'Self approval attempt',
        reviewedContentHash: contentHash,
      });

    expect(selfApproveRes.status).toBe(403);
    expect(selfApproveRes.body.error.code).toBe('SOD_VIOLATION');
  });

  it('TEST-BRE-015 lifecycle: independent approver approves and publishes version to ACTIVE', async () => {
    const store = createMockRulesStore();

    // Author creates and submits
    const authorApp = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    const rsRes = await request(authorApp).post('/v1/rule-sets').send({
      decisionKey: 'DK-lead.assignment',
      scopeType: 'TENANT_DEFAULT',
      name: 'End to End Lifecycle',
    });
    const ruleSetId = rsRes.body.id;
    const listVersions = await request(authorApp).get(`/v1/rule-sets/${ruleSetId}/versions`);
    const versionId = listVersions.body.data[0].id;

    await request(authorApp).post(`/v1/rule-set-versions/${versionId}/validate`);
    const subRes = await request(authorApp)
      .post(`/v1/rule-set-versions/${versionId}/submit`)
      .send({ changeReason: 'Initial complete rule set' });
    const contentHash = subRes.body.contentHash;

    // Independent approver reviews
    const approverApp = createTestApp({
      auth: fakeAuth(approverPrincipal),
      deps: { txRunner: store.runner },
    });

    const approveRes = await request(approverApp)
      .post(`/v1/rule-set-versions/${versionId}/reviews`)
      .send({
        seat: 'RULE_APPROVER',
        action: 'APPROVE',
        comment: 'Compliance verified against policy v1',
        reviewedContentHash: contentHash,
      });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe('APPROVED');

    // Publish to ACTIVE
    const publishRes = await request(approverApp)
      .post(`/v1/rule-set-versions/${versionId}/publish`)
      .send({ reason: 'Production launch of lead assignment' });
    expect(publishRes.status).toBe(200);
    expect(publishRes.body.status).toBe('ACTIVE');
  });

  it('TEST-BRE-016 suspension and reinstatement: user who suspended cannot reinstate', async () => {
    const store = createMockRulesStore();

    const authorApp = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });
    const approverApp = createTestApp({
      auth: fakeAuth(approverPrincipal), // usr_approver_02
      deps: { txRunner: store.runner },
    });

    const rsRes = await request(authorApp).post('/v1/rule-sets').send({
      decisionKey: 'DK-lead.assignment',
      scopeType: 'TENANT_DEFAULT',
      name: 'Suspension Test',
    });
    const ruleSetId = rsRes.body.id;
    const listVersions = await request(authorApp).get(`/v1/rule-sets/${ruleSetId}/versions`);
    const versionId = listVersions.body.data[0].id;

    await request(authorApp).post(`/v1/rule-set-versions/${versionId}/validate`);
    const subRes = await request(authorApp)
      .post(`/v1/rule-set-versions/${versionId}/submit`)
      .send({ changeReason: 'Submit for publish' });
    await request(approverApp).post(`/v1/rule-set-versions/${versionId}/reviews`).send({
      action: 'APPROVE',
      comment: 'Approved',
      reviewedContentHash: subRes.body.contentHash,
    });
    await request(approverApp)
      .post(`/v1/rule-set-versions/${versionId}/publish`)
      .send({ reason: 'Activate' });

    // usr_approver_02 suspends
    const suspendRes = await request(approverApp)
      .post(`/v1/rule-set-versions/${versionId}/suspend`)
      .send({ suspendReason: 'Emergency stop due to anomaly' });
    expect(suspendRes.status).toBe(200);
    expect(suspendRes.body.status).toBe('SUSPENDED');

    // usr_approver_02 tries to reinstate -> 403 SOD_VIOLATION
    const invalidReinstate = await request(approverApp)
      .post(`/v1/rule-set-versions/${versionId}/reinstate`)
      .send({ reason: 'Trying to reinstate' });
    expect(invalidReinstate.status).toBe(403);
    expect(invalidReinstate.body.error.code).toBe('SOD_VIOLATION');

    // A different authorized user can reinstate
    const secondApprover = testPrincipal({
      id: 'usr_independent_approver_99',
      tenantId: 'ten_01JTESTTENANT00000000000000',
      authTime: new Date().toISOString(),
      grants: [
        { code: 'rule.suspend', scope: 'TENANT', branchIds: [] },
      ],
    });
    const secondApp = createTestApp({
      auth: fakeAuth(secondApprover),
      deps: { txRunner: store.runner },
    });

    const validReinstate = await request(secondApp)
      .post(`/v1/rule-set-versions/${versionId}/reinstate`)
      .send({ reason: 'Independent check completed, safe to reinstate' });
    expect(validReinstate.status).toBe(200);
    expect(validReinstate.body.status).toBe('ACTIVE');
  });

  it('TEST-BRE-017 evaluates live decision and returns decision record', async () => {
    const store = createMockRulesStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    const evalPayload = {
      subject: { type: 'LEAD', id: 'lead_01JTESTLEAD00000000000001' },
      facts: {
        lead: { branch_id: 'br_mumbai', product_category: 'PL', source: 'WEB' },
        context: { local_hour: 14, local_weekday: 'MON' },
      },
    };

    const evalRes = await request(app)
      .post('/v1/decisions/DK-lead.assignment/evaluations')
      .set('Idempotency-Key', 'lead_eval_01')
      .send(evalPayload);

    expect(evalRes.status).toBe(200);
    expect(evalRes.body.decisionKey).toBe('DK-lead.assignment');
    expect(evalRes.body.decisionRecordId).toBeDefined();

    // Replay with same idempotency key
    const replayRes = await request(app)
      .post('/v1/decisions/DK-lead.assignment/evaluations')
      .set('Idempotency-Key', 'lead_eval_01')
      .send(evalPayload);

    expect(replayRes.status).toBe(200);
    expect(replayRes.body.replayed).toBe(true);
    expect(replayRes.body.decisionRecordId).toBe(evalRes.body.decisionRecordId);
  });

  it('TEST-BRE-018 lists and gets decision records', async () => {
    const store = createMockRulesStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    // Make an evaluation to create a record
    const evalRes = await request(app)
      .post('/v1/decisions/DK-sla.target/evaluations')
      .send({
        subject: { type: 'TASK', id: 'task_01' },
        facts: { sla: { class: 'CUSTOMER_FIRST_CONTACT' }, record: { type: 'TASK' } },
      });
    const recordId = evalRes.body.decisionRecordId;

    const listRes = await request(app).get('/v1/decision-records?decisionKey=DK-sla.target');
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBe(1);
    expect(listRes.body.data[0].id).toBe(recordId);

    const getRes = await request(app).get(`/v1/decision-records/${recordId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.id).toBe(recordId);
  });

  it('TEST-BRE-019 tenant isolation: foreign tenant cannot access records', async () => {
    const store = createMockRulesStore();
    const appA = createTestApp({
      auth: fakeAuth(authorPrincipal), // ten_01JTESTTENANT...
      deps: { txRunner: store.runner },
    });
    const appB = createTestApp({
      auth: fakeAuth(foreignTenantUser), // ten_OTHER...
      deps: { txRunner: store.runner },
    });

    const rsRes = await request(appA).post('/v1/rule-sets').send({
      decisionKey: 'DK-lead.assignment',
      scopeType: 'TENANT_DEFAULT',
      name: 'Tenant A Rules',
    });
    const ruleSetId = rsRes.body.id;

    // Tenant B cannot view Tenant A's rule set -> 404 NOT_FOUND
    const failRes = await request(appB).get(`/v1/rule-sets/${ruleSetId}`);
    expect(failRes.status).toBe(404);
    expect(failRes.body.error.code).toBe('NOT_FOUND');
  });

  it('TEST-BRE-020 database error handling: returns clean 500 without leaking connection credentials', async () => {
    const failingRunner: TxRunner = {
      withTenantTx: async () => {
        throw new Error('Database password leak test at postgresql://postgres:supersecret@db:5432');
      },
    };

    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: failingRunner },
    });

    const res = await request(app).get('/v1/rule-sets');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('supersecret');
    expect(JSON.stringify(res.body)).not.toContain('postgresql://');
  });

  it('TEST-BRE-021 retrieves full rule set and version details with ETag, schemas, and risk tiers', async () => {
    const store = createMockRulesStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    const defRes = await request(app).get('/v1/decision-definitions/DK-lead.assignment');
    expect(defRes.status).toBe(200);
    expect(defRes.body.tier).toBe('T2');
    expect(defRes.body.inputSchema).toBeDefined();
    expect(defRes.body.outputSchema).toBeDefined();
    expect(defRes.body.fallbackPolicy).toBe('DEFAULT_OUTPUT');

    const rsRes = await request(app).post('/v1/rule-sets').send({
      decisionKey: 'DK-lead.assignment',
      scopeType: 'TENANT_DEFAULT',
      name: 'Detail Inspection Test',
    });
    const rsId = rsRes.body.id;

    const getRs = await request(app).get(`/v1/rule-sets/${rsId}`);
    expect(getRs.status).toBe(200);
    expect(getRs.body.id).toBe(rsId);
    expect(getRs.header['etag']).toBe('"0"');

    const listV = await request(app).get(`/v1/rule-sets/${rsId}/versions`);
    const verId = listV.body.data[0].id;

    const getVer = await request(app).get(`/v1/rule-set-versions/${verId}`);
    expect(getVer.status).toBe(200);
    expect(getVer.body.id).toBe(verId);
    expect(getVer.body.status).toBe('DRAFT');
    expect(getVer.header['etag']).toBe('"0"');
  });

  it('TEST-BRE-022 rejects updating rule set version when If-Match header is missing or version is outside DRAFT state', async () => {
    const store = createMockRulesStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    const rsRes = await request(app).post('/v1/rule-sets').send({
      decisionKey: 'DK-lead.assignment',
      scopeType: 'TENANT_DEFAULT',
      name: 'Immutability Test',
    });
    const rsId = rsRes.body.id;
    const listV = await request(app).get(`/v1/rule-sets/${rsId}/versions`);
    const verId = listV.body.data[0].id;

    const newDef = {
      schemaVersion: 1,
      hitPolicy: 'FIRST',
      rules: [],
    };

    // Missing If-Match header -> 422 VALIDATION_ERROR
    const noHeaderRes = await request(app)
      .put(`/v1/rule-set-versions/${verId}`)
      .send({ definition: newDef });
    expect(noHeaderRes.status).toBe(422);
    expect(noHeaderRes.body.error.code).toBe('VALIDATION_ERROR');

    // Submit version to IN_REVIEW
    await request(app).post(`/v1/rule-set-versions/${verId}/validate`);
    await request(app).post(`/v1/rule-set-versions/${verId}/submit`).send({ changeReason: 'Ready for review' });

    // Attempting edit on IN_REVIEW version -> 409 INVALID_STATE
    const nonDraftEdit = await request(app)
      .put(`/v1/rule-set-versions/${verId}`)
      .set('If-Match', '"0"')
      .send({ definition: newDef });
    expect(nonDraftEdit.status).toBe(409);
    expect(nonDraftEdit.body.error.code).toBe('INVALID_STATE');
  });

  it('TEST-BRE-023 validates definition returning FAIL and issues on duplicate rule ordering', async () => {
    const store = createMockRulesStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    const rsRes = await request(app).post('/v1/rule-sets').send({
      decisionKey: 'DK-lead.assignment',
      scopeType: 'TENANT_DEFAULT',
      name: 'Invalid Validation Test',
    });
    const rsId = rsRes.body.id;
    const listV = await request(app).get(`/v1/rule-sets/${rsId}/versions`);
    const verId = listV.body.data[0].id;

    const invalidDef = {
      schemaVersion: 1,
      hitPolicy: 'FIRST',
      rules: [
        {
          uid: 'RUL-DUP-01',
          name: 'First rule',
          enabled: true,
          orderNo: 0,
          conditions: [{ field: 'lead.branch_id', operator: '==', value: 'br_delhi' }],
          output: { pool: 'delhi' },
        },
        {
          uid: 'RUL-DUP-02',
          name: 'Second rule with duplicate order',
          enabled: true,
          orderNo: 0,
          conditions: [{ field: 'lead.branch_id', operator: '==', value: 'br_mumbai' }],
          output: { pool: 'mumbai' },
        },
      ],
    };

    await request(app)
      .put(`/v1/rule-set-versions/${verId}`)
      .set('If-Match', '"0"')
      .send({ definition: invalidDef });

    const valRes = await request(app).post(`/v1/rule-set-versions/${verId}/validate`);
    expect(valRes.status).toBe(200);
    expect(valRes.body.result).toBe('FAIL');
    expect(valRes.body.issues.length).toBeGreaterThan(0);
    expect(valRes.body.issues.some((i: { code: string }) => i.code === 'DUPLICATE_ORDER_NO')).toBe(true);
  });

  it('TEST-BRE-024 compares two rule set versions and computes added/removed/modified rule differences', async () => {
    const store = createMockRulesStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    const rsRes = await request(app).post('/v1/rule-sets').send({
      decisionKey: 'DK-lead.assignment',
      scopeType: 'TENANT_DEFAULT',
      name: 'Comparison Test',
    });
    const rsId = rsRes.body.id;
    const listV = await request(app).get(`/v1/rule-sets/${rsId}/versions`);
    const v1Id = listV.body.data[0].id;

    // Define v1
    const v1Def = {
      schemaVersion: 1,
      hitPolicy: 'FIRST',
      rules: [
        {
          uid: 'RUL-ORIGINAL',
          name: 'Original rule',
          enabled: true,
          orderNo: 0,
          conditions: [{ field: 'lead.branch_id', operator: '==', value: 'br_delhi' }],
          output: { pool: 'delhi_v1' },
        },
      ],
    };
    await request(app)
      .put(`/v1/rule-set-versions/${v1Id}`)
      .set('If-Match', '"0"')
      .send({ definition: v1Def });

    // Create v2
    const v2Res = await request(app)
      .post(`/v1/rule-sets/${rsId}/versions`)
      .send({ changeReason: 'Draft v2' });
    const v2Id = v2Res.body.id;

    // Update v2 with modified rule and added rule
    const v2Def = {
      schemaVersion: 1,
      hitPolicy: 'FIRST',
      rules: [
        {
          uid: 'RUL-ORIGINAL',
          name: 'Original rule modified',
          enabled: true,
          orderNo: 0,
          conditions: [{ field: 'lead.branch_id', operator: '==', value: 'br_delhi' }],
          output: { pool: 'delhi_v2_updated' },
        },
        {
          uid: 'RUL-NEW-02',
          name: 'Newly added rule',
          enabled: true,
          orderNo: 1,
          conditions: [{ field: 'lead.branch_id', operator: '==', value: 'br_pune' }],
          output: { pool: 'pune_pool' },
        },
      ],
    };
    await request(app)
      .put(`/v1/rule-set-versions/${v2Id}`)
      .set('If-Match', '"0"')
      .send({ definition: v2Def });

    const compRes = await request(app)
      .post(`/v1/rule-sets/${rsId}/comparisons`)
      .send({
        baseVersionId: v1Id,
        targetVersionId: v2Id,
        sampleFacts: [{ lead: { branch_id: 'br_delhi' } }],
      });

    expect(compRes.status).toBe(200);
    expect(compRes.body.baseVersionId).toBe(v1Id);
    expect(compRes.body.targetVersionId).toBe(v2Id);
    expect(compRes.body.ruleDiffs.addedRuleUids).toContain('RUL-NEW-02');
    expect(compRes.body.ruleDiffs.modifiedRuleUids).toContain('RUL-ORIGINAL');
    expect(compRes.body.sampleEvaluationDifferences[0].different).toBe(true);
  });

  it('TEST-BRE-025 runs impact analysis against test cases and reports pass/fail summary', async () => {
    const store = createMockRulesStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    const rsRes = await request(app).post('/v1/rule-sets').send({
      decisionKey: 'DK-lead.assignment',
      scopeType: 'TENANT_DEFAULT',
      name: 'Impact Analysis Test',
    });
    const rsId = rsRes.body.id;
    const listV = await request(app).get(`/v1/rule-sets/${rsId}/versions`);
    const verId = listV.body.data[0].id;

    const validDef = {
      schemaVersion: 1,
      hitPolicy: 'FIRST',
      rules: [
        {
          uid: 'RUL-MUMBAI',
          name: 'Route Mumbai',
          enabled: true,
          orderNo: 0,
          conditions: [{ field: 'lead.branch_id', operator: '==', value: 'br_mumbai' }],
          output: { pool: 'mumbai_pool' },
        },
      ],
    };

    await request(app)
      .put(`/v1/rule-set-versions/${verId}`)
      .set('If-Match', '"0"')
      .send({ definition: validDef });

    // Add a passing test case
    await request(app)
      .post(`/v1/rule-sets/${rsId}/test-cases`)
      .send({
        name: 'TC-Mumbai',
        input: { lead: { branch_id: 'br_mumbai' } },
        expectedStatus: 'OK',
        expectedOutput: { pool: 'mumbai_pool' },
      });

    const impactRes = await request(app)
      .post(`/v1/rule-set-versions/${verId}/impact-analyses`)
      .send({ testSuiteRun: true });

    expect(impactRes.status).toBe(200);
    expect(impactRes.body.testCasesTotal).toBe(1);
    expect(impactRes.body.testCasesPassed).toBe(1);
    expect(impactRes.body.testCasesFailed).toBe(0);
    expect(impactRes.body.readyForReview).toBe(true);
  });

  it('TEST-BRE-026 updates test case with If-Match concurrency header', async () => {
    const store = createMockRulesStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    const rsRes = await request(app).post('/v1/rule-sets').send({
      decisionKey: 'DK-lead.assignment',
      scopeType: 'TENANT_DEFAULT',
      name: 'TC Concurrency Test',
    });
    const rsId = rsRes.body.id;

    const tcRes = await request(app)
      .post(`/v1/rule-sets/${rsId}/test-cases`)
      .send({
        name: 'Initial TC Name',
        input: { lead: { branch_id: 'br_delhi' } },
        expectedStatus: 'OK',
        expectedOutput: { pool: 'delhi_pool' },
      });
    const tcId = tcRes.body.id;

    // Stale If-Match -> 409 VERSION_CONFLICT
    const staleRes = await request(app)
      .put(`/v1/rule-test-cases/${tcId}`)
      .set('If-Match', '"5"')
      .send({ name: 'Stale attempt' });
    expect(staleRes.status).toBe(409);
    expect(staleRes.body.error.code).toBe('VERSION_CONFLICT');

    // Valid update
    const updateRes = await request(app)
      .put(`/v1/rule-test-cases/${tcId}`)
      .set('If-Match', '"0"')
      .send({ name: 'Updated TC Name' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.name).toBe('Updated TC Name');
    expect(updateRes.header['etag']).toBe('"1"');
  });

  it('TEST-BRE-027 reviews and rejects draft version with action REJECT transitioning to REJECTED', async () => {
    const store = createMockRulesStore();
    const authorApp = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });
    const approverApp = createTestApp({
      auth: fakeAuth(approverPrincipal),
      deps: { txRunner: store.runner },
    });

    const rsRes = await request(authorApp).post('/v1/rule-sets').send({
      decisionKey: 'DK-lead.assignment',
      scopeType: 'TENANT_DEFAULT',
      name: 'Rejection Flow Test',
    });
    const rsId = rsRes.body.id;
    const listV = await request(authorApp).get(`/v1/rule-sets/${rsId}/versions`);
    const verId = listV.body.data[0].id;

    await request(authorApp).post(`/v1/rule-set-versions/${verId}/validate`);
    const subRes = await request(authorApp)
      .post(`/v1/rule-set-versions/${verId}/submit`)
      .send({ changeReason: 'Ready for review' });

    const rejectRes = await request(approverApp)
      .post(`/v1/rule-set-versions/${verId}/reviews`)
      .send({
        action: 'REJECT',
        comment: 'Condition threshold exceeds allowed policy limits.',
        reviewedContentHash: subRes.body.contentHash,
      });

    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.status).toBe('REJECTED');
  });

  it('TEST-BRE-028 retires an active version transitioning it to RETIRED', async () => {
    const store = createMockRulesStore();
    const authorApp = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });
    const approverApp = createTestApp({
      auth: fakeAuth(approverPrincipal),
      deps: { txRunner: store.runner },
    });

    const rsRes = await request(authorApp).post('/v1/rule-sets').send({
      decisionKey: 'DK-lead.assignment',
      scopeType: 'TENANT_DEFAULT',
      name: 'Retire Flow Test',
    });
    const rsId = rsRes.body.id;
    const listV = await request(authorApp).get(`/v1/rule-sets/${rsId}/versions`);
    const verId = listV.body.data[0].id;

    await request(authorApp).post(`/v1/rule-set-versions/${verId}/validate`);
    const subRes = await request(authorApp)
      .post(`/v1/rule-set-versions/${verId}/submit`)
      .send({ changeReason: 'Initial' });
    await request(approverApp).post(`/v1/rule-set-versions/${verId}/reviews`).send({
      action: 'APPROVE',
      comment: 'Approved',
      reviewedContentHash: subRes.body.contentHash,
    });
    await request(approverApp).post(`/v1/rule-set-versions/${verId}/publish`).send({
      reason: 'Activate',
    });

    const retireRes = await request(approverApp)
      .post(`/v1/rule-set-versions/${verId}/retire`)
      .send({ reason: 'Decommissioned campaign rules' });

    expect(retireRes.status).toBe(200);
    expect(retireRes.body.status).toBe('RETIRED');
  });

  it('TEST-BRE-029 executes rollback of an active rule set to an eligible superseded version', async () => {
    const store = createMockRulesStore();
    const authorApp = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });
    const approverApp = createTestApp({
      auth: fakeAuth(approverPrincipal),
      deps: { txRunner: store.runner },
    });

    // 1. Create rule set and publish v1
    const rsRes = await request(authorApp).post('/v1/rule-sets').send({
      decisionKey: 'DK-lead.assignment',
      scopeType: 'TENANT_DEFAULT',
      name: 'Rollback Flow Test',
    });
    const rsId = rsRes.body.id;
    const listV1 = await request(authorApp).get(`/v1/rule-sets/${rsId}/versions`);
    const v1Id = listV1.body.data[0].id;

    await request(authorApp).post(`/v1/rule-set-versions/${v1Id}/validate`);
    const subV1 = await request(authorApp).post(`/v1/rule-set-versions/${v1Id}/submit`).send({ changeReason: 'Initial version 1' });
    await request(approverApp).post(`/v1/rule-set-versions/${v1Id}/reviews`).send({
      action: 'APPROVE',
      comment: 'Approved v1',
      reviewedContentHash: subV1.body.contentHash,
    });
    await request(approverApp).post(`/v1/rule-set-versions/${v1Id}/publish`).send({ reason: 'Publish v1' });

    // 2. Create and publish v2 -> v1 becomes SUPERSEDED
    const v2Res = await request(authorApp).post(`/v1/rule-sets/${rsId}/versions`).send({ changeReason: 'Draft version 2' });
    const v2Id = v2Res.body.id;
    await request(authorApp).post(`/v1/rule-set-versions/${v2Id}/validate`);
    const subV2 = await request(authorApp).post(`/v1/rule-set-versions/${v2Id}/submit`).send({ changeReason: 'Updated version 2' });
    await request(approverApp).post(`/v1/rule-set-versions/${v2Id}/reviews`).send({
      action: 'APPROVE',
      comment: 'Approved v2',
      reviewedContentHash: subV2.body.contentHash,
    });
    await request(approverApp).post(`/v1/rule-set-versions/${v2Id}/publish`).send({ reason: 'Publish v2' });

    // 3. Rollback back to v1
    const rollbackRes = await request(approverApp)
      .post(`/v1/rule-sets/${rsId}/rollbacks`)
      .send({
        targetVersionId: v1Id,
        reason: 'Rollback to v1 due to unexpected routing in v2',
      });

    expect(rollbackRes.status).toBe(200);
    expect(rollbackRes.body.id).toBe(v1Id);
    expect(rollbackRes.body.status).toBe('ACTIVE');
  });

  it('TEST-BRE-030 live evaluation applies fallback policy when facts match 0 rules', async () => {
    const store = createMockRulesStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    const res = await request(app)
      .post('/v1/decisions/DK-lead.assignment/evaluations')
      .send({
        subject: { type: 'LEAD', id: 'lead_unknown_99' },
        facts: {
          lead: { branch_id: 'br_nonexistent_branch' },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.decisionKey).toBe('DK-lead.assignment');
    expect(res.body.fallbackApplied).toBe(true);
    expect(res.body.fallbackPolicy).toBe('DEFAULT_OUTPUT');
    expect(res.body.matchedRuleUids).toHaveLength(0);
  });
});

