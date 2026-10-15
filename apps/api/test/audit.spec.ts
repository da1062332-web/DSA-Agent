// apps/api/test/audit.spec.ts — Module 37: Audit (MOD-AUD, DOM-N)
import { describe, expect, it, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, fakeAuth, testPrincipal, testDeps } from './support/fake-auth';
import { createMockAuditStore } from './support/mock-audit-db';
import { GENESIS_PREV_HASH } from '../src/modules/audit/canonical';

describe('Module 37: Audit (MOD-AUD) Integration & Route Tests', () => {
  let store: ReturnType<typeof createMockAuditStore>;
  const tenantA = 'ten_01JTESTTENANT00000000000000';
  const tenantB = 'ten_01JTESTTENANT99999999999999';

  const auditorPrincipal = testPrincipal({
    tenantId: tenantA,
    id: 'usr_auditor_01',
    grants: [
      { code: 'audit.read', scope: 'TENANT', branchIds: [] },
      { code: 'audit.export_evidence', scope: 'TENANT', branchIds: [] },
    ],
  });

  const unauthorizedPrincipal = testPrincipal({
    tenantId: tenantA,
    id: 'usr_regular_01',
    grants: [{ code: 'lead.read', scope: 'TENANT', branchIds: [] }],
  });

  const tenantBPrincipal = testPrincipal({
    tenantId: tenantB,
    id: 'usr_tenant_b_auditor',
    grants: [
      { code: 'audit.read', scope: 'TENANT', branchIds: [] },
      { code: 'audit.export_evidence', scope: 'TENANT', branchIds: [] },
    ],
  });

  beforeEach(() => {
    store = createMockAuditStore();
  });

  function getApp(principal = auditorPrincipal) {
    return createTestApp({
      auth: fakeAuth(principal),
      deps: testDeps({ txRunner: store.runner }),
    });
  }

  // ==========================================================================
  // API-AUD-001 & API-AUD-002: Audit Search & Pagination
  // ==========================================================================
  it('TEST-AUD-001 requires authentication for /v1/audit-events', async () => {
    const unauthenticatedApp = createTestApp({
      deps: testDeps({ txRunner: store.runner }),
    });

    const res = await request(unauthenticatedApp).get('/v1/audit-events');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('TEST-AUD-002 rejects unauthorized user without audit.read with 403 FORBIDDEN', async () => {
    const app = getApp(unauthorizedPrincipal);
    const res = await request(app).get('/v1/audit-events');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('TEST-AUD-003 searches audit events with cursor pagination and redacts sensitive payloads', async () => {
    // Seed audit events for tenantA
    store.auditEvents.push(
      {
        id: 'aud_01JTESTAUDIT00000000000001',
        tenant_id: tenantA,
        seq: 1,
        occurred_at: new Date('2026-10-14T08:00:00Z'),
        actor_type: 'USER',
        actor_id: 'usr_staff_01',
        action: 'lead.created',
        entity_type: 'lead',
        entity_id: 'lead_01',
        permission_used: 'lead.create',
        approval_ref: null,
        reason: 'Direct intake',
        decision_record_id: 'dr_01',
        before: null,
        after: {
          name: 'Jane Doe',
          password: 'plainPassword123',
          token: 'secretToken',
        },
        external_side_effect: false,
        correlation_id: 'req_01',
        ip: '127.0.0.1',
        user_agent: 'VitestAgent',
        prev_hash: null,
        hash: null,
      },
      {
        id: 'aud_01JTESTAUDIT00000000000002',
        tenant_id: tenantA,
        seq: 2,
        occurred_at: new Date('2026-10-14T08:05:00Z'),
        actor_type: 'USER',
        actor_id: 'usr_staff_01',
        action: 'lead.qualify',
        entity_type: 'lead',
        entity_id: 'lead_01',
        permission_used: 'lead.qualify',
        approval_ref: null,
        reason: 'Passed pre-qualification rules',
        decision_record_id: 'dr_02',
        before: { status: 'NEW' },
        after: { status: 'QUALIFIED' },
        external_side_effect: false,
        correlation_id: 'req_02',
        ip: '127.0.0.1',
        user_agent: 'VitestAgent',
        prev_hash: null,
        hash: null,
      },
    );

    const app = getApp(auditorPrincipal);
    const res = await request(app).get('/v1/audit-events');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.limit).toBe(50);

    // Verify sensitive payload redaction
    const firstEvent = res.body.data.find((e: { id: string }) => e.id === 'aud_01JTESTAUDIT00000000000001');
    expect(firstEvent.after.password).toBe('[REDACTED]');
    expect(firstEvent.after.token).toBe('[REDACTED]');
    expect(firstEvent.after.name).toBe('Jane Doe');
  });

  it('TEST-AUD-004 filters audit events by action and correlationId', async () => {
    store.auditEvents.push(
      {
        id: 'aud_01JTESTAUDIT00000000000001',
        tenant_id: tenantA,
        seq: 1,
        occurred_at: new Date('2026-10-14T08:00:00Z'),
        actor_type: 'USER',
        actor_id: 'usr_staff_01',
        action: 'lead.created',
        entity_type: 'lead',
        entity_id: 'lead_01',
        permission_used: 'lead.create',
        approval_ref: null,
        reason: null,
        decision_record_id: null,
        before: null,
        after: null,
        external_side_effect: false,
        correlation_id: 'req_target_corr_01',
        ip: null,
        user_agent: null,
        prev_hash: null,
        hash: null,
      },
      {
        id: 'aud_01JTESTAUDIT00000000000002',
        tenant_id: tenantA,
        seq: 2,
        occurred_at: new Date('2026-10-14T08:05:00Z'),
        actor_type: 'USER',
        actor_id: 'usr_staff_02',
        action: 'task.completed',
        entity_type: 'task',
        entity_id: 'task_01',
        permission_used: 'task.update',
        approval_ref: null,
        reason: null,
        decision_record_id: null,
        before: null,
        after: null,
        external_side_effect: false,
        correlation_id: 'req_other_corr_02',
        ip: null,
        user_agent: null,
        prev_hash: null,
        hash: null,
      },
    );

    const app = getApp(auditorPrincipal);

    const resAction = await request(app).get('/v1/audit-events?action=lead.created');
    expect(resAction.status).toBe(200);
    expect(resAction.body.data).toHaveLength(1);
    expect(resAction.body.data[0].action).toBe('lead.created');

    const resCorr = await request(app).get('/v1/audit-events?correlationId=req_target_corr_01');
    expect(resCorr.status).toBe(200);
    expect(resCorr.body.data).toHaveLength(1);
    expect(resCorr.body.data[0].correlationId).toBe('req_target_corr_01');
  });

  // ==========================================================================
  // API-AUD-003: Audit Chain Verification & Sealer
  // ==========================================================================
  it('TEST-AUD-005 returns EMPTY status when tenant has no audit events', async () => {
    const app = getApp(auditorPrincipal);
    const res = await request(app).get('/v1/audit-chain/verification');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('EMPTY');
    expect(res.body.totalEvents).toBe(0);
    expect(res.body.sealedEvents).toBe(0);
  });

  it('TEST-AUD-006 seals unsealed audit events into tamper-evident hash chain and verifies status', async () => {
    // Add two unsealed events
    store.auditEvents.push(
      {
        id: 'aud_01JTESTAUDIT00000000000001',
        tenant_id: tenantA,
        seq: 1,
        occurred_at: new Date('2026-10-14T09:00:00Z'),
        actor_type: 'USER',
        actor_id: 'usr_staff_01',
        action: 'lead.created',
        entity_type: 'lead',
        entity_id: 'lead_01',
        permission_used: 'lead.create',
        approval_ref: null,
        reason: null,
        decision_record_id: null,
        before: null,
        after: { name: 'Customer A' },
        external_side_effect: false,
        correlation_id: 'req_01',
        ip: null,
        user_agent: null,
        prev_hash: null,
        hash: null,
      },
      {
        id: 'aud_01JTESTAUDIT00000000000002',
        tenant_id: tenantA,
        seq: 2,
        occurred_at: new Date('2026-10-14T09:05:00Z'),
        actor_type: 'USER',
        actor_id: 'usr_staff_01',
        action: 'lead.qualified',
        entity_type: 'lead',
        entity_id: 'lead_01',
        permission_used: 'lead.qualify',
        approval_ref: null,
        reason: null,
        decision_record_id: null,
        before: null,
        after: null,
        external_side_effect: false,
        correlation_id: 'req_02',
        ip: null,
        user_agent: null,
        prev_hash: null,
        hash: null,
      },
    );

    const app = getApp(auditorPrincipal);

    // Before sealing, verification should report INCOMPLETE
    const preRes = await request(app).get('/v1/audit-chain/verification');
    expect(preRes.status).toBe(200);
    expect(preRes.body.status).toBe('INCOMPLETE');
    expect(preRes.body.unsealedEvents).toBe(2);

    // Run sealer job
    const sealRes = await request(app).post('/v1/audit-chain/seal');
    expect(sealRes.status).toBe(200);
    expect(sealRes.body.sealedCount).toBe(2);
    expect(sealRes.body.latestHash).toBeDefined();

    // After sealing, verification should report VERIFIED
    const postRes = await request(app).get('/v1/audit-chain/verification');
    expect(postRes.status).toBe(200);
    expect(postRes.body.status).toBe('VERIFIED');
    expect(postRes.body.sealedEvents).toBe(2);
    expect(postRes.body.unsealedEvents).toBe(0);
    expect(postRes.body.verifiedRange!.fromSeq).toBe(1);
    expect(postRes.body.verifiedRange!.toSeq).toBe(2);
  });

  it('TEST-AUD-007 detects tampered events when stored hash diverges from canonical calculation', async () => {
    // Seed an event with an invalid/tampered hash
    store.auditEvents.push({
      id: 'aud_01JTESTAUDIT00000000000001',
      tenant_id: tenantA,
      seq: 1,
      occurred_at: new Date('2026-10-14T09:00:00Z'),
      actor_type: 'USER',
      actor_id: 'usr_staff_01',
      action: 'lead.created',
      entity_type: 'lead',
      entity_id: 'lead_01',
      permission_used: 'lead.create',
      approval_ref: null,
      reason: null,
      decision_record_id: null,
      before: null,
      after: { name: 'Customer Tampered' },
      external_side_effect: false,
      correlation_id: 'req_01',
      ip: null,
      user_agent: null,
      prev_hash: GENESIS_PREV_HASH,
      hash: 'deadbeef00000000000000000000000000000000000000000000000000000000', // invalid hash
    });

    const app = getApp(auditorPrincipal);
    const res = await request(app).get('/v1/audit-chain/verification');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('TAMPERED');
    expect(res.body.tamperedEvents).toBeDefined();
    expect(res.body.tamperedEvents[0].id).toBe('aud_01JTESTAUDIT00000000000001');
  });

  // ==========================================================================
  // Evidence Packs: Export & Retrieval (TASK-408 / SUB-AUD.03 C)
  // ==========================================================================
  it('TEST-AUD-008 rejects evidence pack creation without audit.export_evidence with 403', async () => {
    const principalWithoutExport = testPrincipal({
      tenantId: tenantA,
      id: 'usr_no_export',
      grants: [{ code: 'audit.read', scope: 'TENANT', branchIds: [] }],
    });

    const app = getApp(principalWithoutExport);
    const res = await request(app).post('/v1/evidence-packs').send({
      format: 'json',
      includeDecisionRecords: true,
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('TEST-AUD-009 creates evidence pack request, records audit event, and returns 202 Accepted', async () => {
    const app = getApp(auditorPrincipal);
    const res = await request(app)
      .post('/v1/evidence-packs')
      .send({
        format: 'json',
        includeDecisionRecords: true,
        action: 'lead.created',
      });

    expect(res.status).toBe(202);
    expect(res.body.id).toMatch(/^evp_/);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.tenantId).toBe(tenantA);

    // Verify evidence pack record in store
    expect(store.evidencePacks).toHaveLength(1);
    expect(store.evidencePacks[0]!.id).toBe(res.body.id);

    // Verify audit event was generated for the export request
    const exportAuditEvent = store.auditEvents.find((e) => e.action === 'audit.evidence_exported');
    expect(exportAuditEvent).toBeDefined();
    expect(exportAuditEvent?.entity_id).toBe(res.body.id);
  });

  it('TEST-AUD-010 retrieves evidence pack details by id and lists tenant packs', async () => {
    store.evidencePacks.push({
      id: 'evp_01JTESTPACK0000000000000001',
      tenant_id: tenantA,
      requested_by: 'usr_auditor_01',
      status: 'COMPLETED',
      filters: { action: 'lead.created' },
      record_count: 5,
      checksum: 'sha256:abcd1234ef5678',
      file_path: 'evidence-packs/ten_01JTESTTENANT00000000000000/evp_01JTESTPACK0000000000000001.json',
      error_message: null,
      created_at: new Date('2026-10-14T09:00:00Z'),
      completed_at: new Date('2026-10-14T09:01:00Z'),
      expires_at: new Date('2026-10-21T09:01:00Z'),
    });

    const app = getApp(auditorPrincipal);

    // Get detail
    const detailRes = await request(app).get('/v1/evidence-packs/evp_01JTESTPACK0000000000000001');
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.status).toBe('COMPLETED');
    expect(detailRes.body.checksum).toBe('sha256:abcd1234ef5678');
    expect(detailRes.body.recordCount).toBe(5);

    // List packs
    const listRes = await request(app).get('/v1/evidence-packs');
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0].id).toBe('evp_01JTESTPACK0000000000000001');
  });

  // ==========================================================================
  // Multi-Tenant Isolation
  // ==========================================================================
  it('TEST-AUD-011 enforces strict multi-tenant isolation across audit events and evidence packs', async () => {
    // Tenant A event
    store.auditEvents.push({
      id: 'aud_tenant_a_event',
      tenant_id: tenantA,
      seq: 1,
      occurred_at: new Date(),
      actor_type: 'USER',
      actor_id: 'usr_staff_01',
      action: 'lead.created',
      entity_type: 'lead',
      entity_id: 'lead_01',
      permission_used: 'lead.create',
      approval_ref: null,
      reason: null,
      decision_record_id: null,
      before: null,
      after: null,
      external_side_effect: false,
      correlation_id: 'req_01',
      ip: null,
      user_agent: null,
      prev_hash: null,
      hash: null,
    });

    // Tenant A evidence pack
    store.evidencePacks.push({
      id: 'evp_tenant_a_pack',
      tenant_id: tenantA,
      requested_by: 'usr_auditor_01',
      status: 'COMPLETED',
      filters: {},
      record_count: 1,
      checksum: 'sha256:123',
      file_path: null,
      error_message: null,
      created_at: new Date(),
      completed_at: new Date(),
      expires_at: new Date(),
    });

    // Tenant B attempts to read Tenant A's audit events and evidence packs
    const appB = getApp(tenantBPrincipal);

    const auditRes = await request(appB).get('/v1/audit-events');
    expect(auditRes.status).toBe(200);
    expect(auditRes.body.data).toHaveLength(0); // Tenant B sees 0 results

    const packDetailRes = await request(appB).get('/v1/evidence-packs/evp_tenant_a_pack');
    expect(packDetailRes.status).toBe(404); // Returns 404 NOT_FOUND for cross-tenant pack

    const packListRes = await request(appB).get('/v1/evidence-packs');
    expect(packListRes.status).toBe(200);
    expect(packListRes.body.data).toHaveLength(0); // Tenant B sees 0 packs
  });

  // ==========================================================================
  // Single Event & Linked MOD-BRE Decision Record Lookup
  // ==========================================================================
  it('TEST-AUD-012 retrieves single audit event and enforces tenant boundary and redaction', async () => {
    store.auditEvents.push({
      id: 'aud_single_01',
      tenant_id: tenantA,
      seq: 1,
      occurred_at: new Date('2026-10-14T10:00:00Z'),
      actor_type: 'USER',
      actor_id: 'usr_staff_01',
      action: 'customer.updated',
      entity_type: 'customer',
      entity_id: 'cust_01',
      permission_used: 'customer.update',
      approval_ref: null,
      reason: 'Phone update',
      decision_record_id: 'dr_single_01',
      before: { phone: '1234567890', token: 'sensitive_old' },
      after: { phone: '9876543210', token: 'sensitive_new' },
      external_side_effect: false,
      correlation_id: 'req_cust_01',
      ip: '10.0.0.1',
      user_agent: 'Vitest',
      prev_hash: null,
      hash: null,
    });

    const appA = getApp(auditorPrincipal);
    const resA = await request(appA).get('/v1/audit-events/aud_single_01');
    expect(resA.status).toBe(200);
    expect(resA.body.id).toBe('aud_single_01');
    expect(resA.body.before.token).toBe('[REDACTED]');
    expect(resA.body.after.token).toBe('[REDACTED]');
    expect(resA.body.after.phone).toBe('9876543210');

    // Non-existent event returns 404
    const notFoundRes = await request(appA).get('/v1/audit-events/aud_nonexistent');
    expect(notFoundRes.status).toBe(404);

    // Cross-tenant access returns 404
    const appB = getApp(tenantBPrincipal);
    const resB = await request(appB).get('/v1/audit-events/aud_single_01');
    expect(resB.status).toBe(404);
  });

  it('TEST-AUD-013 looks up linked MOD-BRE decision record with strict tenant isolation', async () => {
    store.auditEvents.push({
      id: 'aud_with_dr',
      tenant_id: tenantA,
      seq: 1,
      occurred_at: new Date('2026-10-14T11:00:00Z'),
      actor_type: 'USER',
      actor_id: 'usr_staff_01',
      action: 'application.evaluated',
      entity_type: 'application',
      entity_id: 'app_01',
      permission_used: 'application.evaluate',
      approval_ref: null,
      reason: null,
      decision_record_id: 'dr_eval_01',
      before: null,
      after: null,
      external_side_effect: false,
      correlation_id: 'req_dr_01',
      ip: null,
      user_agent: null,
      prev_hash: null,
      hash: null,
    });

    store.decisionRecords.push({
      id: 'dr_eval_01',
      tenant_id: tenantA,
      rule_id: 'rule_eligibility_v1',
      outcome: 'APPROVED',
      inputs: { credit_score: 750 },
    });

    const appA = getApp(auditorPrincipal);
    const res = await request(appA).get('/v1/audit-events/aud_with_dr/decision-record');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('dr_eval_01');
    expect(res.body.outcome).toBe('APPROVED');

    // Audit event without decision record returns 404
    store.auditEvents.push({
      id: 'aud_without_dr',
      tenant_id: tenantA,
      seq: 2,
      occurred_at: new Date('2026-10-14T11:05:00Z'),
      actor_type: 'USER',
      actor_id: 'usr_staff_01',
      action: 'lead.created',
      entity_type: 'lead',
      entity_id: 'lead_02',
      permission_used: 'lead.create',
      approval_ref: null,
      reason: null,
      decision_record_id: null,
      before: null,
      after: null,
      external_side_effect: false,
      correlation_id: 'req_lead_02',
      ip: null,
      user_agent: null,
      prev_hash: null,
      hash: null,
    });
    const noDrRes = await request(appA).get('/v1/audit-events/aud_without_dr/decision-record');
    expect(noDrRes.status).toBe(404);

    // Cross-tenant access returns 404
    const appB = getApp(tenantBPrincipal);
    const crossTenantRes = await request(appB).get('/v1/audit-events/aud_with_dr/decision-record');
    expect(crossTenantRes.status).toBe(404);
  });

  // ==========================================================================
  // Evidence Pack Download Authorization and State Enforcements
  // ==========================================================================
  it('TEST-AUD-014 enforces download authorization, lifecycle state, and records audit event on download', async () => {
    // Add completed pack
    store.evidencePacks.push({
      id: 'evp_ready_for_dl',
      tenant_id: tenantA,
      requested_by: 'usr_auditor_01',
      status: 'COMPLETED',
      filters: {},
      record_count: 10,
      checksum: 'sha256:downloadchecksum12345678',
      file_path: '/evidence/evp_ready_for_dl.json',
      error_message: null,
      created_at: new Date('2026-10-14T09:00:00Z'),
      completed_at: new Date('2026-10-14T09:01:00Z'),
      expires_at: new Date(Date.now() + 86400000), // expires tomorrow
    });

    // Add pending pack
    store.evidencePacks.push({
      id: 'evp_still_pending',
      tenant_id: tenantA,
      requested_by: 'usr_auditor_01',
      status: 'PENDING',
      filters: {},
      record_count: null,
      checksum: null,
      file_path: null,
      error_message: null,
      created_at: new Date('2026-10-14T09:00:00Z'),
      completed_at: null,
      expires_at: null,
    });

    // Add expired pack
    store.evidencePacks.push({
      id: 'evp_already_expired',
      tenant_id: tenantA,
      requested_by: 'usr_auditor_01',
      status: 'COMPLETED',
      filters: {},
      record_count: 5,
      checksum: 'sha256:expired123',
      file_path: '/evidence/expired.json',
      error_message: null,
      created_at: new Date('2026-10-01T09:00:00Z'),
      completed_at: new Date('2026-10-01T09:01:00Z'),
      expires_at: new Date(Date.now() - 3600000), // expired 1 hr ago
    });

    const appA = getApp(auditorPrincipal);

    // 1. Downloading pending pack returns 409/INVALID_STATE
    const pendingRes = await request(appA).get('/v1/evidence-packs/evp_still_pending/download');
    expect(pendingRes.status).toBe(409);
    expect(pendingRes.body.error.code).toBe('INVALID_STATE');

    // 2. Downloading expired pack returns 409/INVALID_STATE
    const expiredRes = await request(appA).get('/v1/evidence-packs/evp_already_expired/download');
    expect(expiredRes.status).toBe(409);
    expect(expiredRes.body.error.code).toBe('INVALID_STATE');

    // 3. User without audit.export_evidence gets 403
    const unauthorizedApp = getApp(unauthorizedPrincipal);
    const unauthRes = await request(unauthorizedApp).get('/v1/evidence-packs/evp_ready_for_dl/download');
    expect(unauthRes.status).toBe(403);

    // 4. Successful download returns 200, attachment headers, checksum header, and writes audit event
    const dlRes = await request(appA).get('/v1/evidence-packs/evp_ready_for_dl/download');
    expect(dlRes.status).toBe(200);
    expect(dlRes.headers['content-disposition']).toContain('attachment; filename="evidence-pack-evp_ready_for_dl.json"');
    expect(dlRes.headers['x-checksum']).toBe('sha256:downloadchecksum12345678');
    expect(dlRes.body.evidencePackId).toBe('evp_ready_for_dl');

    // Verify download audit event was captured in DB
    const dlEvent = store.auditEvents.find((e) => e.action === 'audit.evidence_downloaded');
    expect(dlEvent).toBeDefined();
    expect(dlEvent?.entity_id).toBe('evp_ready_for_dl');
    expect(dlEvent?.permission_used).toBe('audit.export_evidence');

    // 5. Cross-tenant download attempt returns 404
    const appB = getApp(tenantBPrincipal);
    const crossRes = await request(appB).get('/v1/evidence-packs/evp_ready_for_dl/download');
    expect(crossRes.status).toBe(404);
  });

  // ==========================================================================
  // Cursor Validation and Timestamp Tie-Breaking
  // ==========================================================================
  it('TEST-AUD-015 validates cursors, rejects malformed cursors, and breaks timestamp ties deterministically', async () => {
    const appA = getApp(auditorPrincipal);

    // Malformed cursor should return 422 VALIDATION_ERROR
    const malformedRes = await request(appA).get('/v1/audit-events?cursor=not-a-valid-base64-cursor!!!');
    expect(malformedRes.status).toBe(422);
    expect(malformedRes.body.error.code).toBe('VALIDATION_ERROR');

    // Seed events with identical timestamp but different IDs
    const sameTime = new Date('2026-10-14T12:00:00Z');
    store.auditEvents.push(
      {
        id: 'aud_tie_001',
        tenant_id: tenantA,
        seq: 10,
        occurred_at: sameTime,
        actor_type: 'USER',
        actor_id: 'usr_staff_01',
        action: 'task.created',
        entity_type: 'task',
        entity_id: 'task_01',
        permission_used: 'task.create',
        approval_ref: null,
        reason: null,
        decision_record_id: null,
        before: null,
        after: null,
        external_side_effect: false,
        correlation_id: 'req_tie_01',
        ip: null,
        user_agent: null,
        prev_hash: null,
        hash: null,
      },
      {
        id: 'aud_tie_002',
        tenant_id: tenantA,
        seq: 11,
        occurred_at: sameTime,
        actor_type: 'USER',
        actor_id: 'usr_staff_01',
        action: 'task.created',
        entity_type: 'task',
        entity_id: 'task_02',
        permission_used: 'task.create',
        approval_ref: null,
        reason: null,
        decision_record_id: null,
        before: null,
        after: null,
        external_side_effect: false,
        correlation_id: 'req_tie_02',
        ip: null,
        user_agent: null,
        prev_hash: null,
        hash: null,
      },
    );

    const tieRes = await request(appA).get('/v1/audit-events?limit=10');
    expect(tieRes.status).toBe(200);
    const tieIds = tieRes.body.data.map((e: { id: string }) => e.id);
    // Since ORDER BY occurred_at DESC, id DESC: aud_tie_002 must precede aud_tie_001
    const idx2 = tieIds.indexOf('aud_tie_002');
    const idx1 = tieIds.indexOf('aud_tie_001');
    expect(idx2).toBeLessThan(idx1);
  });
});
