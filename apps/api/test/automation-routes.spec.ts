// apps/api/test/automation-routes.spec.ts — owner: Dev 1 / Dev 6 (MOD-WFA Phase 4)
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';
import { createMockAutomationStore } from './support/mock-automation-db';

describe('Module 24: Workflow Automation (MOD-WFA) Phase 4 HTTP APIs', () => {
  const authorPrincipal = testPrincipal({
    id: 'usr_author_01',
    tenantId: 'ten_01JTESTTENANT00000000000000',
    grants: [
      { code: 'automation.read', scope: 'TENANT', branchIds: [] },
      { code: 'automation.author', scope: 'TENANT', branchIds: [] },
    ],
  });

  const checkerPrincipal = testPrincipal({
    id: 'usr_checker_01',
    tenantId: 'ten_01JTESTTENANT00000000000000',
    grants: [
      { code: 'automation.read', scope: 'TENANT', branchIds: [] },
      { code: 'automation.approve', scope: 'TENANT', branchIds: [] },
    ],
  });

  const executorPrincipal = testPrincipal({
    id: 'usr_executor_01',
    tenantId: 'ten_01JTESTTENANT00000000000000',
    grants: [
      { code: 'automation.read', scope: 'TENANT', branchIds: [] },
      { code: 'automation.execute', scope: 'TENANT', branchIds: [] },
    ],
  });

  const operatorPrincipal = testPrincipal({
    id: 'usr_operator_01',
    tenantId: 'ten_01JTESTTENANT00000000000000',
    grants: [
      { code: 'automation.read', scope: 'TENANT', branchIds: [] },
      { code: 'automation.operator', scope: 'TENANT', branchIds: [] },
    ],
  });

  const staffWithoutWfaPerms = testPrincipal({
    id: 'usr_no_perms',
    tenantId: 'ten_01JTESTTENANT00000000000000',
    grants: [{ code: 'lead.read', scope: 'BRANCH', branchIds: ['br_01'] }],
  });

  const foreignTenantPrincipal = testPrincipal({
    id: 'usr_foreign_01',
    tenantId: 'ten_OTHER_000000000000000000',
    grants: [
      { code: 'automation.read', scope: 'TENANT', branchIds: [] },
      { code: 'automation.author', scope: 'TENANT', branchIds: [] },
      { code: 'automation.approve', scope: 'TENANT', branchIds: [] },
      { code: 'automation.execute', scope: 'TENANT', branchIds: [] },
      { code: 'automation.operator', scope: 'TENANT', branchIds: [] },
    ],
  });

  // 1. Authentication & Permission Checks
  it('TEST-WFA-API-001 rejects unauthenticated requests with 401 UNAUTHENTICATED', async () => {
    const store = createMockAutomationStore();
    const app = createTestApp({ deps: { txRunner: store.runner } });

    const res = await request(app).get('/v1/automations');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('TEST-WFA-API-002 rejects unauthorized requests with 403 FORBIDDEN when lacking automation.read', async () => {
    const store = createMockAutomationStore();
    const app = createTestApp({
      auth: fakeAuth(staffWithoutWfaPerms),
      deps: { txRunner: store.runner },
    });

    const res = await request(app).get('/v1/automations');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  // 2. Listing & Retrieving Definitions
  it('TEST-WFA-API-003 lists automation definitions scoped to tenant and system workflows', async () => {
    const store = createMockAutomationStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    const res = await request(app).get('/v1/automations');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);

    // Contains tenant workflow and global system workflow
    const codes = res.body.data.map((d: { code: string }) => d.code);
    expect(codes).toContain('lead_routing_pipeline');
    expect(codes).toContain('system_global_audit');
  });

  it('TEST-WFA-API-004 enforces strict tenant isolation on definition retrieval', async () => {
    const store = createMockAutomationStore();
    const app = createTestApp({
      auth: fakeAuth(foreignTenantPrincipal),
      deps: { txRunner: store.runner },
    });

    // Foreign tenant attempting to access ten_01JTESTTENANT's private definition
    const res = await request(app).get('/v1/automations/wfd_01JTESTWFD0000000000000001');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    // But CAN access system global definition
    const sysRes = await request(app).get('/v1/automations/wfd_01JTESTSYSTEM0000000000001');
    expect(sysRes.status).toBe(200);
    expect(sysRes.body.definition.code).toBe('system_global_audit');
  });

  // 3. Creating Definitions & Draft Versions
  it('TEST-WFA-API-005 creates new automation definition with draft version 1 and audits creation', async () => {
    const store = createMockAutomationStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner, auditPort: store.mockAuditPort, audit: store.mockAuditPort },
    });

    const payload = {
      code: 'customer_onboarding_flow',
      name: 'Customer Onboarding Flow',
      description: 'Automates customer welcome and document request tasks',
      triggerType: 'EVENT',
      entityType: 'CUSTOMER',
    };

    const res = await request(app).post('/v1/automations').send(payload);
    expect(res.status).toBe(201);
    expect(res.body.definition.id).toMatch(/^wfd_/);
    expect(res.body.definition.code).toBe('customer_onboarding_flow');
    expect(res.body.definition.status).toBe('DRAFT');
    expect(res.body.version.id).toMatch(/^wfv_/);
    expect(res.body.version.versionNo).toBe(1);
    expect(res.body.version.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    // Verify audit log recorded
    expect(store.auditEntries.some((e) => e.action === 'automation.definition_created')).toBe(true);
  });

  it('TEST-WFA-API-006 validates payload and rejects malformed definition input with 422', async () => {
    const store = createMockAutomationStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    // Malformed code (invalid characters) and missing name
    const invalidPayload = {
      code: 'INVALID CODE WITH SPACES',
      triggerType: 'UNKNOWN_TRIGGER',
      entityType: 'INVALID_ENTITY',
    };

    const res = await request(app).post('/v1/automations').send(invalidPayload);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // 4. Updating Definition Metadata
  it('TEST-WFA-API-007 updates definition metadata and prevents mutating system workflows', async () => {
    const store = createMockAutomationStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    const res = await request(app)
      .patch('/v1/automations/wfd_01JTESTWFD0000000000000001')
      .set('If-Match', '"1"')
      .send({ name: 'Updated Lead Pipeline Name', description: 'Updated description note' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Lead Pipeline Name');
    expect(res.headers.etag).toBe('"2"');

    // A stale version is refused, and a missing If-Match is a malformed request
    const stale = await request(app)
      .patch('/v1/automations/wfd_01JTESTWFD0000000000000001')
      .set('If-Match', '"1"')
      .send({ name: 'Stale edit' });
    expect(stale.status).toBe(409);
    const missing = await request(app)
      .patch('/v1/automations/wfd_01JTESTWFD0000000000000001')
      .send({ name: 'No header' });
    expect(missing.status).toBe(400);

    // Reject updating system workflow
    const sysUpdate = await request(app)
      .patch('/v1/automations/wfd_01JTESTSYSTEM0000000000001')
      .set('If-Match', '"0"')
      .send({ name: 'Hacked System Name' });

    expect(sysUpdate.status).toBe(403);
    expect(sysUpdate.body.error.code).toBe('FORBIDDEN');
  });

  // 5. Versioning & Immutability Rules
  it('TEST-WFA-API-008 creates new draft version for existing definition with incremented version number', async () => {
    const store = createMockAutomationStore();
    const app = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    const newVersionPayload = {
      triggerConfig: { eventType: 'lead.created' },
      steps: [
        {
          id: 'step_notify_v2',
          name: 'Notify Lead Rep',
          type: 'NOTIFY',
          isSkippable: false,
          config: { title: 'New lead arrived' },
        },
        {
          id: 'step_end_v2',
          name: 'Finish Flow',
          type: 'END',
          isSkippable: false,
          config: { outcomeStatus: 'SUCCEEDED' },
        },
      ],
      changeReason: 'Upgraded notification pipeline for faster triage',
    };

    const res = await request(app)
      .post('/v1/automations/wfd_01JTESTWFD0000000000000001/versions')
      .send(newVersionPayload);

    expect(res.status).toBe(201);
    expect(res.body.versionNo).toBe(2);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.authorId).toBe(authorPrincipal.id);
  });

  // 6. Maker-Checker Segregation of Duties (SOD)
  it('TEST-WFA-API-009 enforces Maker-Checker SOD: author cannot approve their own version', async () => {
    const store = createMockAutomationStore();

    // 1. Author usr_author_01 creates version 2
    const authorApp = createTestApp({
      auth: fakeAuth(authorPrincipal),
      deps: { txRunner: store.runner },
    });

    const createRes = await request(authorApp)
      .post('/v1/automations/wfd_01JTESTWFD0000000000000001/versions')
      .send({
        triggerConfig: {},
        steps: [
          {
            id: 'step_v2',
            name: 'V2 Step',
            type: 'END',
            isSkippable: false,
            config: { outcomeStatus: 'SUCCEEDED' },
          },
        ],
        changeReason: 'Self-approval test',
      });

    const versionId = createRes.body.id;

    // 2. Author attempts to self-approve with automation.approve grant
    const authorWithApproveGrant = testPrincipal({
      id: authorPrincipal.id,
      tenantId: authorPrincipal.tenantId,
      grants: [{ code: 'automation.approve', scope: 'TENANT', branchIds: [] }],
    });

    const selfApproveApp = createTestApp({
      auth: fakeAuth(authorWithApproveGrant),
      deps: { txRunner: store.runner },
    });

    const selfApproveRes = await request(selfApproveApp)
      .post(`/v1/automations/wfd_01JTESTWFD0000000000000001/versions/${versionId}/review`)
      .send({ action: 'APPROVE', reason: 'Self approving my changes' });

    expect(selfApproveRes.status).toBe(403);
    expect(selfApproveRes.body.error.code).toBe('SOD_VIOLATION');

    // 3. Independent checker approves successfully
    const checkerApp = createTestApp({
      auth: fakeAuth(checkerPrincipal),
      deps: { txRunner: store.runner },
    });

    const checkerRes = await request(checkerApp)
      .post(`/v1/automations/wfd_01JTESTWFD0000000000000001/versions/${versionId}/review`)
      .send({ action: 'APPROVE', reason: 'Reviewed and verified valid' });

    expect(checkerRes.status).toBe(200);
    expect(checkerRes.body.version.status).toBe('ACTIVE');
    expect(checkerRes.body.definition.pinnedVersionId).toBe(versionId);
  });

  // 7. Dry-Run Simulation Mode
  it('TEST-WFA-API-010 executes dry-run simulation without database writes or notifications', async () => {
    const store = createMockAutomationStore();
    const app = createTestApp({
      auth: fakeAuth(executorPrincipal),
      deps: { txRunner: store.runner },
    });

    const initialExecCount = store.executions.length;

    const res = await request(app)
      .post('/v1/automations/wfd_01JTESTWFD0000000000000001/execute')
      .send({
        subjectType: 'LEAD',
        subjectId: 'lead_dry_sim_01',
        triggerPayload: { score: 95 },
        dryRun: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.simulation).toBe(true);
    expect(res.body.execution.dryRun).toBe(true);
    expect(res.body.execution.status).toBe('SUCCEEDED');

    // No persistent executions or outbox records created
    expect(store.executions.length).toBe(initialExecCount);
    expect(store.outboxEntries.length).toBe(0);
  });

  // 8. Execution Triggering and Idempotency
  it('TEST-WFA-API-011 executes active automation and respects Idempotency-Key header', async () => {
    const store = createMockAutomationStore();
    const app = createTestApp({
      auth: fakeAuth(executorPrincipal),
      deps: { txRunner: store.runner },
    });

    const idemKey = 'idem-route-trigger-001';

    // First trigger
    const res1 = await request(app)
      .post('/v1/automations/wfd_01JTESTWFD0000000000000001/execute')
      .set('Idempotency-Key', idemKey)
      .send({
        subjectType: 'LEAD',
        subjectId: 'lead_route_01',
        triggerPayload: { score: 100 },
      });

    expect(res1.status).toBe(200);
    expect(res1.body.replayed).toBe(false);
    expect(res1.body.execution.id).toMatch(/^wfe_/);

    const execId = res1.body.execution.id;

    // Second trigger with duplicate idempotency key
    const res2 = await request(app)
      .post('/v1/automations/wfd_01JTESTWFD0000000000000001/execute')
      .set('Idempotency-Key', idemKey)
      .send({
        subjectType: 'LEAD',
        subjectId: 'lead_route_01',
        triggerPayload: { score: 100 },
      });

    expect(res2.status).toBe(200);
    expect(res2.header['idempotent-replayed']).toBe('true');
    expect(res2.body.replayed).toBe(true);
    expect(res2.body.execution.id).toBe(execId);
  });

  // 9. Execution History & Step Details
  it('TEST-WFA-API-012 retrieves execution history and step-level details', async () => {
    const store = createMockAutomationStore();
    const app = createTestApp({
      auth: fakeAuth(executorPrincipal),
      deps: { txRunner: store.runner },
    });

    // Execute flow
    const execRes = await request(app)
      .post('/v1/automations/wfd_01JTESTWFD0000000000000001/execute')
      .send({
        subjectType: 'LEAD',
        subjectId: 'lead_hist_01',
        triggerPayload: { score: 100 },
      });

    const execId = execRes.body.execution.id;

    // List executions
    const listRes = await request(app).get('/v1/automations/executions');
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.some((e: { id: string }) => e.id === execId)).toBe(true);

    // Get execution detail
    const detailRes = await request(app).get(`/v1/automations/executions/${execId}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.id).toBe(execId);

    // Get step executions
    const stepsRes = await request(app).get(`/v1/automations/executions/${execId}/steps`);
    expect(stepsRes.status).toBe(200);
    expect(Array.isArray(stepsRes.body.data)).toBe(true);
    expect(stepsRes.body.data.length).toBeGreaterThan(0);
  });

  // 10. Operator Cancellation
  it('TEST-WFA-API-013 allows operator to cancel execution and requires operator permission', async () => {
    const store = createMockAutomationStore();

    // Seed pending execution
    store.executions.push({
      id: 'wfe_cancel_route_01',
      tenant_id: authorPrincipal.tenantId,
      definition_id: 'wfd_01JTESTWFD0000000000000001',
      version_id: 'wfv_01JTESTWFV0000000000000001',
      trigger_type: 'EVENT',
      trigger_event_id: null,
      subject_type: 'LEAD',
      subject_id: 'lead_cancel_01',
      status: 'PENDING',
      current_step_index: 0,
      context: {},
      dry_run: false,
      worker_id: null,
      lease_expires_at: null,
      error_code: null,
      error_message: null,
      idempotency_key: null,
      correlation_id: 'corr_c1',
      causation_id: null,
      chain_depth: 0,
      started_at: null,
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Unauthorized staff cannot cancel
    const unauthApp = createTestApp({
      auth: fakeAuth(staffWithoutWfaPerms),
      deps: { txRunner: store.runner },
    });
    const unauthRes = await request(unauthApp)
      .post('/v1/automations/executions/wfe_cancel_route_01/cancel')
      .send({ reason: 'Unauthorized cancel attempt' });

    expect(unauthRes.status).toBe(403);

    // Authorized operator cancels successfully
    const operatorApp = createTestApp({
      auth: fakeAuth(operatorPrincipal),
      deps: { txRunner: store.runner },
    });
    const cancelRes = await request(operatorApp)
      .post('/v1/automations/executions/wfe_cancel_route_01/cancel')
      .send({ reason: 'Customer requested loan cancellation' });

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe('CANCELLED');
    expect(cancelRes.body.errorMessage).toBe('Customer requested loan cancellation');
  });

  // 11. Operator Step Skipping
  it('TEST-WFA-API-014 allows operator to skip a step with mandatory reason', async () => {
    const store = createMockAutomationStore();
    const app = createTestApp({
      auth: fakeAuth(operatorPrincipal),
      deps: { txRunner: store.runner },
    });

    const execId = 'wfe_skip_route_01';
    const stepId = 'wfse_skip_01';

    store.executions.push({
      id: execId,
      tenant_id: operatorPrincipal.tenantId,
      definition_id: 'wfd_01JTESTWFD0000000000000001',
      version_id: 'wfv_01JTESTWFV0000000000000001',
      trigger_type: 'EVENT',
      trigger_event_id: null,
      subject_type: 'LEAD',
      subject_id: 'lead_skip_01',
      status: 'RUNNING',
      current_step_index: 2,
      context: {},
      dry_run: false,
      worker_id: null,
      lease_expires_at: null,
      error_code: null,
      error_message: null,
      idempotency_key: null,
      correlation_id: 'corr_skip',
      causation_id: null,
      chain_depth: 0,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    store.stepExecutions.push({
      id: stepId,
      tenant_id: operatorPrincipal.tenantId,
      execution_id: execId,
      step_index: 2,
      step_id: 'step_create_followup',
      step_type: 'CREATE_TASK',
      status: 'RUNNING',
      input_snapshot: {},
      output_snapshot: null,
      error_code: null,
      error_message: null,
      error_classification: null,
      attempts: 1,
      idempotency_key: `${execId}:step_2:step_create_followup`,
      skip_reason: null,
      skipped_by: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
    });

    // Rejects empty or missing reason
    const noReasonRes = await request(app)
      .post(`/v1/automations/executions/${execId}/steps/2/skip`)
      .send({ reason: '' });

    expect(noReasonRes.status).toBe(422);

    // Valid skip with reason
    const skipRes = await request(app)
      .post(`/v1/automations/executions/${execId}/steps/2/skip`)
      .send({ reason: 'Task already completed out-of-band by manager' });

    expect(skipRes.status).toBe(200);
    expect(skipRes.body.stepExecution.status).toBe('SKIPPED');
    expect(skipRes.body.stepExecution.skipReason).toBe('Task already completed out-of-band by manager');
    expect(skipRes.body.execution.currentStepIndex).toBe(3);
  });

  // 12. Dead Letter Retrieval and Resolution
  it('TEST-WFA-API-015 lists dead-letter records and allows authorized operator to resolve them', async () => {
    const store = createMockAutomationStore();
    const app = createTestApp({
      auth: fakeAuth(operatorPrincipal),
      deps: { txRunner: store.runner },
    });

    const dlId = 'wfdl_route_001';
    const execId = 'wfe_dl_route_01';
    const stepId = 'wfse_dl_route_01';

    store.executions.push({
      id: execId,
      tenant_id: operatorPrincipal.tenantId,
      definition_id: 'wfd_01JTESTWFD0000000000000001',
      version_id: 'wfv_01JTESTWFV0000000000000001',
      trigger_type: 'EVENT',
      trigger_event_id: null,
      subject_type: 'LEAD',
      subject_id: 'lead_dl_01',
      status: 'DEAD_LETTERED',
      current_step_index: 2,
      context: {},
      dry_run: false,
      worker_id: null,
      lease_expires_at: null,
      error_code: 'TASK_CREATE_FAIL',
      error_message: 'Downstream queue offline',
      idempotency_key: null,
      correlation_id: 'corr_dl_01',
      causation_id: null,
      chain_depth: 0,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    store.stepExecutions.push({
      id: stepId,
      tenant_id: operatorPrincipal.tenantId,
      execution_id: execId,
      step_index: 2,
      step_id: 'step_create_followup',
      step_type: 'CREATE_TASK',
      status: 'FAILED',
      input_snapshot: {},
      output_snapshot: null,
      error_code: 'TASK_CREATE_FAIL',
      error_message: 'Downstream queue offline',
      error_classification: 'RETRYABLE',
      attempts: 4,
      idempotency_key: `${execId}:step_2:step_create_followup`,
      skip_reason: null,
      skipped_by: null,
      started_at: new Date(),
      completed_at: new Date(),
      created_at: new Date(),
    });

    store.deadLetters.push({
      id: dlId,
      tenant_id: operatorPrincipal.tenantId,
      execution_id: execId,
      step_execution_id: stepId,
      reason: 'MAX_RETRIES_EXCEEDED',
      error_details: { attempts: 4 },
      resolution_status: 'OPEN',
      resolved_by: null,
      resolved_at: null,
      resolution_action: null,
      created_at: new Date(),
    });

    // 1. List dead letters
    const listDl = await request(app).get('/v1/automations/dead-letters');
    expect(listDl.status).toBe(200);
    expect(listDl.body.data.some((d: { id: string }) => d.id === dlId)).toBe(true);

    // 2. Get dead letter detail
    const getDl = await request(app).get(`/v1/automations/dead-letters/${dlId}`);
    expect(getDl.status).toBe(200);
    expect(getDl.body.id).toBe(dlId);

    // 3. Resolve via RETRY
    const resolveRes = await request(app)
      .post(`/v1/automations/dead-letters/${dlId}/resolve`)
      .send({ action: 'RETRY', reason: 'Downstream outage resolved, retrying' });

    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.deadLetter.resolutionStatus).toBe('RESOLVED');
    expect(resolveRes.body.deadLetter.resolutionAction).toBe('RETRY');
    expect(resolveRes.body.execution.status).toBe('RETRYING');
  });

  // Spec paths (API-WFA-004..008), sharing the logic of the /automations routes.
  it('TEST-WFA-API-016 API-WFA-005 approval by version id keeps SOD; API-WFA-006 enables only the pinned version', async () => {
    const store = createMockAutomationStore();
    const authorApp = createTestApp({ auth: fakeAuth(authorPrincipal), deps: { txRunner: store.runner } });
    const created = await request(authorApp)
      .post('/v1/automations/wfd_01JTESTWFD0000000000000001/versions')
      .send({
        triggerConfig: {},
        steps: [
          {
            id: 'step_v2',
            name: 'V2 Step',
            type: 'END',
            isSkippable: false,
            config: { outcomeStatus: 'SUCCEEDED' },
          },
        ],
        changeReason: 'Spec path test',
      });
    const versionId = created.body.id;

    const selfApprove = await request(
      createTestApp({
        auth: fakeAuth(
          testPrincipal({
            id: authorPrincipal.id,
            tenantId: authorPrincipal.tenantId,
            grants: [{ code: 'automation.approve', scope: 'TENANT', branchIds: [] }],
          }),
        ),
        deps: { txRunner: store.runner },
      }),
    )
      .post(`/v1/automation-versions/${versionId}/approval`)
      .send({ action: 'APPROVE', reason: 'Self approving' });
    expect(selfApprove.status).toBe(403);

    const checkerApp = createTestApp({ auth: fakeAuth(checkerPrincipal), deps: { txRunner: store.runner } });
    const approved = await request(checkerApp)
      .post(`/v1/automation-versions/${versionId}/approval`)
      .send({ action: 'APPROVE', reason: 'Independent review' });
    expect(approved.status).toBe(200);
    expect(approved.body.definition.pinnedVersionId).toBe(versionId);

    const disabled = await request(authorApp)
      .post(`/v1/automation-versions/${versionId}/enable`)
      .send({ enabled: false, reason: 'Pause during audit' });
    expect(disabled.status).toBe(200);
    expect(disabled.body.status).toBe('INACTIVE');
  });

  it('TEST-WFA-API-017 API-WFA-004 dry-run lists the steps without side effects; API-WFA-007 lists executions', async () => {
    const store = createMockAutomationStore();
    const app = createTestApp({ auth: fakeAuth(authorPrincipal), deps: { txRunner: store.runner } });
    const before = store.executions.length;
    const dry = await request(app)
      .post('/v1/automation-versions/wfv_01JTESTWFV0000000000000001/dry-runs')
      .send({ subjectType: 'LEAD', subjectId: 'lead_dry_01' });
    expect(dry.status).toBe(200);
    expect(dry.body.simulation).toBe(true);
    expect(store.executions.length).toBe(before);
    const list = await request(app).get('/v1/automation-executions');
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);
  });

  it('TEST-WFA-API-018 API-WFA-008 cancels through interventions with a reason and Idempotency-Key', async () => {
    const store = createMockAutomationStore();
    store.executions.push({
      id: 'wfe_intervene_01',
      tenant_id: authorPrincipal.tenantId,
      definition_id: 'wfd_01JTESTWFD0000000000000001',
      version_id: 'wfv_01JTESTWFV0000000000000001',
      trigger_type: 'EVENT',
      trigger_event_id: null,
      subject_type: 'LEAD',
      subject_id: 'lead_intervene_01',
      status: 'PENDING',
      current_step_index: 0,
      context: {},
      dry_run: false,
      worker_id: null,
      lease_expires_at: null,
      error_code: null,
      error_message: null,
      idempotency_key: null,
      correlation_id: 'corr_i1',
      causation_id: null,
      chain_depth: 0,
      started_at: null,
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    });
    const app = createTestApp({ auth: fakeAuth(operatorPrincipal), deps: { txRunner: store.runner } });
    const noKey = await request(app)
      .post('/v1/automation-executions/wfe_intervene_01/interventions')
      .send({ action: 'CANCEL', reason: 'Customer withdrew' });
    expect(noKey.status).toBe(400);
    const res = await request(app)
      .post('/v1/automation-executions/wfe_intervene_01/interventions')
      .set('Idempotency-Key', 'wfa_intervene_key_01')
      .send({ action: 'CANCEL', reason: 'Customer withdrew' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
  });
});
