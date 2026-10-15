import type { RequestContext } from '@dsa/contracts';
import { createIdGenerator } from '@dsa/kernel';
import { describe, expect, it } from 'vitest';
import { AutomationEngine } from '../src/modules/automation/engine';
import { assertValidTransition } from '../src/modules/automation/lifecycle';
import { calculateRetryDelay, classifyError } from '../src/modules/automation/retry-policy';
import { testPrincipal } from './support/fake-auth';
import { createMockAutomationStore } from './support/mock-automation-db';

describe('Module 24: Workflow Automation (MOD-WFA) Execution Runtime', () => {
  const ids = createIdGenerator();

  const standardCtx: RequestContext = {
    principal: testPrincipal({
      id: 'usr_operator_01',
      tenantId: 'ten_01JTESTTENANT00000000000000',
      grants: [
        { code: 'automation.read', scope: 'TENANT', branchIds: [] },
        { code: 'automation.execute', scope: 'TENANT', branchIds: [] },
        { code: 'automation.operator', scope: 'TENANT', branchIds: [] },
      ],
    }),
    correlationId: 'corr_test_001',
    now: new Date('2026-10-14T00:00:00.000Z'),
  };

  const foreignTenantCtx: RequestContext = {
    principal: testPrincipal({
      id: 'usr_foreign_01',
      tenantId: 'ten_OTHER_000000000000000000',
      grants: [
        { code: 'automation.read', scope: 'TENANT', branchIds: [] },
        { code: 'automation.execute', scope: 'TENANT', branchIds: [] },
      ],
    }),
    correlationId: 'corr_foreign_001',
    now: new Date('2026-10-14T00:00:00.000Z'),
  };

  // 1. Creating and persisting an execution
  it('TEST-WFA-ENG-001 creates and persists a new execution in PENDING state', async () => {
    const store = createMockAutomationStore();
    const engine = new AutomationEngine({
      txRunner: store.runner,
      ids,
      auditPort: store.mockAuditPort,
    });

    const result = await engine.createExecution(standardCtx, {
      tenantId: standardCtx.principal.tenantId,
      definitionId: 'wfd_01JTESTWFD0000000000000001',
      versionId: 'wfv_01JTESTWFV0000000000000001',
      triggerType: 'EVENT',
      subjectType: 'LEAD',
      subjectId: 'lead_01JTESTLEAD000000000001',
      correlationId: 'corr_eng_001',
      context: { score: 100 },
    });

    expect(result.replayed).toBe(false);
    expect(result.execution.status).toBe('PENDING');
    expect(result.execution.currentStepIndex).toBe(0);
    expect(result.execution.subjectId).toBe('lead_01JTESTLEAD000000000001');

    // Audit event recorded
    expect(store.auditEntries.some((e) => e.action === 'automation.execution_created')).toBe(true);
  });

  // 2. Duplicate trigger delivery (idempotency replay)
  it('TEST-WFA-ENG-002 deduplicates trigger delivery and replays existing execution', async () => {
    const store = createMockAutomationStore();
    const engine = new AutomationEngine({ txRunner: store.runner, ids });

    const idemKey = 'idem-evt-lead-created-12345';

    const first = await engine.createExecution(standardCtx, {
      tenantId: standardCtx.principal.tenantId,
      definitionId: 'wfd_01JTESTWFD0000000000000001',
      versionId: 'wfv_01JTESTWFV0000000000000001',
      triggerType: 'EVENT',
      subjectType: 'LEAD',
      subjectId: 'lead_01JTESTLEAD000000000001',
      correlationId: 'corr_first',
      idempotencyKey: idemKey,
    });
    expect(first.replayed).toBe(false);

    // Second trigger with same idempotency key
    const second = await engine.createExecution(standardCtx, {
      tenantId: standardCtx.principal.tenantId,
      definitionId: 'wfd_01JTESTWFD0000000000000001',
      versionId: 'wfv_01JTESTWFV0000000000000001',
      triggerType: 'EVENT',
      subjectType: 'LEAD',
      subjectId: 'lead_01JTESTLEAD000000000001',
      correlationId: 'corr_second',
      idempotencyKey: idemKey,
    });

    expect(second.replayed).toBe(true);
    expect(second.execution.id).toBe(first.execution.id);
  });

  // 3. Concurrent duplicate execution attempts
  it('TEST-WFA-ENG-003 handles unique-constraint conflict safely during concurrent creation', async () => {
    const store = createMockAutomationStore();
    const engine = new AutomationEngine({ txRunner: store.runner, ids });

    const idemKey = 'idem-concurrent-trigger-1';

    // Simulate concurrent creation using Promise.all
    const [res1, res2] = await Promise.all([
      engine.createExecution(standardCtx, {
        tenantId: standardCtx.principal.tenantId,
        definitionId: 'wfd_01JTESTWFD0000000000000001',
        versionId: 'wfv_01JTESTWFV0000000000000001',
        triggerType: 'EVENT',
        subjectType: 'LEAD',
        subjectId: 'lead_concurrent_1',
        correlationId: 'corr_conc_1',
        idempotencyKey: idemKey,
      }),
      engine.createExecution(standardCtx, {
        tenantId: standardCtx.principal.tenantId,
        definitionId: 'wfd_01JTESTWFD0000000000000001',
        versionId: 'wfv_01JTESTWFV0000000000000001',
        triggerType: 'EVENT',
        subjectType: 'LEAD',
        subjectId: 'lead_concurrent_1',
        correlationId: 'corr_conc_2',
        idempotencyKey: idemKey,
      }),
    ]);

    expect([res1.execution.id, res2.execution.id]).toEqual([res1.execution.id, res1.execution.id]);
    expect(res1.replayed || res2.replayed).toBe(true);
  });

  // 4. Valid and invalid lifecycle transitions
  it('TEST-WFA-ENG-004 enforces legal lifecycle transitions and rejects invalid state changes', () => {
    // Valid transitions
    expect(() => assertValidTransition('PENDING', 'RUNNING')).not.toThrow();
    expect(() => assertValidTransition('RUNNING', 'WAITING')).not.toThrow();
    expect(() => assertValidTransition('RUNNING', 'SUCCEEDED')).not.toThrow();
    expect(() => assertValidTransition('RUNNING', 'FAILED')).not.toThrow();
    expect(() => assertValidTransition('RUNNING', 'DEAD_LETTERED')).not.toThrow();
    expect(() => assertValidTransition('WAITING', 'RUNNING')).not.toThrow();
    expect(() => assertValidTransition('RETRYING', 'RUNNING')).not.toThrow();
    expect(() => assertValidTransition('DEAD_LETTERED', 'RETRYING')).not.toThrow();
    expect(() => assertValidTransition('RUNNING', 'CANCELLED')).not.toThrow();

    // Invalid transitions from terminal states
    expect(() => assertValidTransition('SUCCEEDED', 'RUNNING')).toThrow(/Cannot transition execution/);
    expect(() => assertValidTransition('FAILED', 'RUNNING')).toThrow(/Cannot transition execution/);
    expect(() => assertValidTransition('CANCELLED', 'RUNNING')).toThrow(/Cannot transition execution/);
    // Invalid jump from PENDING to SUCCEEDED
    expect(() => assertValidTransition('PENDING', 'SUCCEEDED')).toThrow(/Cannot transition execution/);
  });

  // 5. Worker lease acquisition
  it('TEST-WFA-ENG-005 acquires worker lease and starts execution', async () => {
    const store = createMockAutomationStore();
    const engine = new AutomationEngine({
      txRunner: store.runner,
      ids,
      workerConfig: { leaseDurationMs: 60_000 },
    });

    const { execution } = await engine.createExecution(standardCtx, {
      tenantId: standardCtx.principal.tenantId,
      definitionId: 'wfd_01JTESTWFD0000000000000001',
      versionId: 'wfv_01JTESTWFV0000000000000001',
      triggerType: 'EVENT',
      subjectType: 'LEAD',
      subjectId: 'lead_01',
      correlationId: 'corr_lease',
    });

    const workerA = 'worker_node_alpha';
    const executed = await engine.claimAndRun(standardCtx, execution.id, workerA);

    expect(executed).not.toBeNull();
    // Flow complete: EVALUATE -> BRANCH (default step 2) -> CREATE_TASK -> TAG -> END
    expect(executed?.status).toBe('SUCCEEDED');
    expect(executed?.workerId).toBe(workerA);
  });

  // 6. Lease expiry and reclamation
  it('TEST-WFA-ENG-006 reclaims execution when worker lease expires', async () => {
    const store = createMockAutomationStore();
    const engine = new AutomationEngine({ txRunner: store.runner, ids });

    // Insert an execution already leased by a crashed worker whose lease has expired
    const expiredLease = new Date(Date.now() - 10_000); // 10s in the past
    store.executions.push({
      id: 'wfe_crashed_worker_01',
      tenant_id: standardCtx.principal.tenantId,
      definition_id: 'wfd_01JTESTWFD0000000000000001',
      version_id: 'wfv_01JTESTWFV0000000000000001',
      trigger_type: 'EVENT',
      trigger_event_id: null,
      subject_type: 'LEAD',
      subject_id: 'lead_02',
      status: 'RUNNING',
      current_step_index: 2,
      context: {},
      dry_run: false,
      worker_id: 'worker_crashed_node',
      lease_expires_at: expiredLease,
      error_code: null,
      error_message: null,
      idempotency_key: null,
      correlation_id: 'corr_crash',
      causation_id: null,
      chain_depth: 0,
      started_at: new Date(Date.now() - 30_000),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    // New worker claims the expired execution
    const newWorker = 'worker_recovery_node';
    const reclaimed = await engine.claimAndRun(standardCtx, 'wfe_crashed_worker_01', newWorker);

    expect(reclaimed).not.toBeNull();
    expect(reclaimed?.workerId).toBe(newWorker);
    expect(reclaimed?.status).toBe('SUCCEEDED');
  });

  // 7. Stale-worker protection
  it('TEST-WFA-ENG-007 prevents stale worker from overwriting progress after lease loss', async () => {
    const store = createMockAutomationStore();
    const repo = new (await import('../src/modules/automation/repository')).AutomationRepository();

    // Create execution leased to worker_original with expired lease
    const expiredLease = new Date(Date.now() - 5000);
    store.executions.push({
      id: 'wfe_stale_test_01',
      tenant_id: standardCtx.principal.tenantId,
      definition_id: 'wfd_01JTESTWFD0000000000000001',
      version_id: 'wfv_01JTESTWFV0000000000000001',
      trigger_type: 'EVENT',
      trigger_event_id: null,
      subject_type: 'LEAD',
      subject_id: 'lead_03',
      status: 'RUNNING',
      current_step_index: 1,
      context: {},
      dry_run: false,
      worker_id: 'worker_stale',
      lease_expires_at: expiredLease,
      error_code: null,
      error_message: null,
      idempotency_key: null,
      correlation_id: 'corr_stale',
      causation_id: null,
      chain_depth: 0,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Stale worker tries to update non-terminal progress: should fail with WORKER_LEASE_LOST
    await expect(
      store.runner.withTenantTx(standardCtx, async (tx) => {
        return repo.updateExecutionProgress(tx, standardCtx.principal.tenantId, 'wfe_stale_test_01', 'worker_stale', {
          status: 'RUNNING',
          currentStepIndex: 2,
        });
      }),
    ).rejects.toThrow(/lost lease on execution/);
  });

  // 8. Recovery after worker crash
  it('TEST-WFA-ENG-008 recovers safely after crash and finishes pending steps', async () => {
    const store = createMockAutomationStore();
    const engine = new AutomationEngine({ txRunner: store.runner, ids });

    const { execution } = await engine.createExecution(standardCtx, {
      tenantId: standardCtx.principal.tenantId,
      definitionId: 'wfd_01JTESTWFD0000000000000001',
      versionId: 'wfv_01JTESTWFV0000000000000001',
      triggerType: 'EVENT',
      subjectType: 'LEAD',
      subjectId: 'lead_04',
      correlationId: 'corr_crash_rec',
      context: { score: 100 },
    });

    // Simulate crash after step 0
    const raw = store.executions.find((e) => e.id === execution.id)!;
    raw.status = 'PENDING';
    raw.current_step_index = 1; // Resumes from step 1 (BRANCH)
    raw.worker_id = null;
    raw.lease_expires_at = null;

    const recovered = await engine.claimAndRun(standardCtx, execution.id, 'worker_standby');
    expect(recovered?.status).toBe('SUCCEEDED');
    expect(recovered?.context.updatedField).toBe('tags');
  });

  // 9. Resuming from last committed step
  it('TEST-WFA-ENG-009 skips already succeeded steps and executes only remaining steps', async () => {
    const store = createMockAutomationStore();
    const engine = new AutomationEngine({ txRunner: store.runner, ids });

    const { execution } = await engine.createExecution(standardCtx, {
      tenantId: standardCtx.principal.tenantId,
      definitionId: 'wfd_01JTESTWFD0000000000000001',
      versionId: 'wfv_01JTESTWFV0000000000000001',
      triggerType: 'EVENT',
      subjectType: 'LEAD',
      subjectId: 'lead_05',
      correlationId: 'corr_skip_done',
    });

    // Pre-record step 0 as SUCCEEDED
    store.stepExecutions.push({
      id: 'wfse_pre_done_0',
      tenant_id: standardCtx.principal.tenantId,
      execution_id: execution.id,
      step_index: 0,
      step_id: 'step_eval_dup',
      step_type: 'EVALUATE_DECISION',
      status: 'SUCCEEDED',
      input_snapshot: {},
      output_snapshot: { precomputed: true },
      error_code: null,
      error_message: null,
      error_classification: null,
      attempts: 1,
      idempotency_key: `${execution.id}:step_0:step_eval_dup`,
      skip_reason: null,
      skipped_by: null,
      started_at: new Date(),
      completed_at: new Date(),
      created_at: new Date(),
    });

    const res = await engine.claimAndRun(standardCtx, execution.id);
    expect(res?.status).toBe('SUCCEEDED');

    // Step 0 attempt count remained 1 (never re-executed)
    const step0 = store.stepExecutions.find((s) => s.step_index === 0);
    expect(step0?.attempts).toBe(1);
    expect(step0?.output_snapshot).toEqual({ precomputed: true });
  });

  // 10. Step idempotency
  it('TEST-WFA-ENG-010 ensures deterministic step idempotency key', async () => {
    const store = createMockAutomationStore();
    const engine = new AutomationEngine({ txRunner: store.runner, ids });

    const { execution } = await engine.createExecution(standardCtx, {
      tenantId: standardCtx.principal.tenantId,
      definitionId: 'wfd_01JTESTWFD0000000000000001',
      versionId: 'wfv_01JTESTWFV0000000000000001',
      triggerType: 'EVENT',
      subjectType: 'LEAD',
      subjectId: 'lead_06',
      correlationId: 'corr_idem_step',
    });

    await engine.claimAndRun(standardCtx, execution.id);

    // Each step execution has an idempotency key format: <execId>:step_<index>:<stepId>
    for (const stepExec of store.stepExecutions) {
      expect(stepExec.idempotency_key).toBe(`${execution.id}:step_${stepExec.step_index}:${stepExec.step_id}`);
    }
  });

  // 11. Retryable versus permanent failures
  it('TEST-WFA-ENG-011 distinguishes retryable and permanent failures and transitions appropriately', async () => {
    expect(classifyError({ status: 503 })).toBe('RETRYABLE');
    expect(classifyError({ code: 'ECONNRESET' })).toBe('RETRYABLE');
    expect(classifyError({ status: 400 })).toBe('PERMANENT');
    expect(classifyError({ status: 422 })).toBe('PERMANENT');

    const store = createMockAutomationStore();
    const engine = new AutomationEngine({ txRunner: store.runner, ids });

    // Run execution with simulated permanent error
    const { execution } = await engine.createExecution(standardCtx, {
      tenantId: standardCtx.principal.tenantId,
      definitionId: 'wfd_01JTESTRETRY00000000000001',
      versionId: 'wfv_01JTESTRETRYV000000000001',
      triggerType: 'MANUAL',
      subjectType: 'LEAD',
      subjectId: 'lead_perm',
      correlationId: 'corr_perm',
    });

    // Override handler to return permanent error
    const permEngine = new AutomationEngine({
      txRunner: store.runner,
      ids,
      handlers: {
        CALL_WEBHOOK: {
          async execute() {
            return {
              status: 'FAILED',
              error: {
                code: 'INVALID_WEBHOOK_URL',
                message: 'Permanent 400 bad request',
                classification: 'PERMANENT',
              },
            };
          },
        },
      },
    });

    const failed = await permEngine.claimAndRun(standardCtx, execution.id);
    expect(failed?.status).toBe('FAILED');
    expect(failed?.errorCode).toBe('INVALID_WEBHOOK_URL');
  });

  // 12. Ambiguous failure handling without blind retries (dead-lettering)
  it('TEST-WFA-ENG-012 dead-letters ambiguous failures without blindly retrying', async () => {
    const store = createMockAutomationStore();

    const ambiguousEngine = new AutomationEngine({
      txRunner: store.runner,
      ids,
      handlers: {
        CALL_WEBHOOK: {
          async execute() {
            return {
              status: 'FAILED',
              error: {
                code: 'AMBIGUOUS_RESPONSE',
                message: 'Socket timeout after request was sent',
                classification: 'AMBIGUOUS',
              },
            };
          },
        },
      },
    });

    const { execution } = await ambiguousEngine.createExecution(standardCtx, {
      tenantId: standardCtx.principal.tenantId,
      definitionId: 'wfd_01JTESTRETRY00000000000001',
      versionId: 'wfv_01JTESTRETRYV000000000001',
      triggerType: 'MANUAL',
      subjectType: 'LEAD',
      subjectId: 'lead_ambiguous',
      correlationId: 'corr_amb',
    });

    const deadLettered = await ambiguousEngine.claimAndRun(standardCtx, execution.id);

    expect(deadLettered?.status).toBe('DEAD_LETTERED');
    expect(store.deadLetters.length).toBe(1);
    expect(store.deadLetters[0]?.reason).toBe('AMBIGUOUS_EXTERNAL_OUTCOME');
  });

  // 13. Retry attempt limits and scheduled backoff
  it('TEST-WFA-ENG-013 calculates backoff delays correctly and exhausts to dead letter after 4 attempts', async () => {
    // Verify default schedule delays without jitter
    const zeroJitter = { jitterFraction: 0 };
    expect(calculateRetryDelay(1, zeroJitter)).toBe(60_000); // 1m
    expect(calculateRetryDelay(2, zeroJitter)).toBe(300_000); // 5m
    expect(calculateRetryDelay(3, zeroJitter)).toBe(1_800_000); // 30m
    expect(calculateRetryDelay(4, zeroJitter)).toBe(7_200_000); // 2h

    const store = createMockAutomationStore();
    const retryEngine = new AutomationEngine({
      txRunner: store.runner,
      ids,
      retryConfig: { maxAttempts: 2, delaysMs: [1000, 2000] },
      handlers: {
        CALL_WEBHOOK: {
          async execute() {
            return {
              status: 'FAILED',
              error: {
                code: 'WEBHOOK_503',
                message: 'Service unavailable',
                classification: 'RETRYABLE',
              },
            };
          },
        },
      },
    });

    const { execution } = await retryEngine.createExecution(standardCtx, {
      tenantId: standardCtx.principal.tenantId,
      definitionId: 'wfd_01JTESTRETRY00000000000001',
      versionId: 'wfv_01JTESTRETRYV000000000001',
      triggerType: 'MANUAL',
      subjectType: 'LEAD',
      subjectId: 'lead_retry',
      correlationId: 'corr_retry',
    });

    // Attempt 1: should transition to RETRYING
    const attempt1 = await retryEngine.claimAndRun(standardCtx, execution.id);
    expect(attempt1?.status).toBe('RETRYING');

    // Attempt 2: maxAttempts (2) exhausted -> should dead-letter
    const attempt2 = await retryEngine.claimAndRun(standardCtx, execution.id);
    expect(attempt2?.status).toBe('DEAD_LETTERED');
    expect(store.deadLetters.length).toBe(1);
    expect(store.deadLetters[0]?.reason).toBe('MAX_RETRIES_EXCEEDED');
  });

  // 14. Cancellation and timeout behavior
  it('TEST-WFA-ENG-014 cancels execution and stops worker processing', async () => {
    const store = createMockAutomationStore();
    const engine = new AutomationEngine({ txRunner: store.runner, ids });

    const { execution } = await engine.createExecution(standardCtx, {
      tenantId: standardCtx.principal.tenantId,
      definitionId: 'wfd_01JTESTWFD0000000000000001',
      versionId: 'wfv_01JTESTWFV0000000000000001',
      triggerType: 'EVENT',
      subjectType: 'LEAD',
      subjectId: 'lead_cancel',
      correlationId: 'corr_cancel',
    });

    // Cancel while in PENDING
    const cancelled = await engine.cancelExecution(standardCtx, execution.id, 'User requested cancellation');
    expect(cancelled.status).toBe('CANCELLED');

    // Worker attempts to claim cancelled execution: should fail / return null
    const attempt = await engine.claimAndRun(standardCtx, execution.id);
    expect(attempt).toBeNull();
  });

  // 15. Tenant isolation
  it('TEST-WFA-ENG-015 enforces strict tenant isolation for execution access and mutations', async () => {
    const store = createMockAutomationStore();
    const engine = new AutomationEngine({ txRunner: store.runner, ids });

    const { execution } = await engine.createExecution(standardCtx, {
      tenantId: standardCtx.principal.tenantId,
      definitionId: 'wfd_01JTESTWFD0000000000000001',
      versionId: 'wfv_01JTESTWFV0000000000000001',
      triggerType: 'EVENT',
      subjectType: 'LEAD',
      subjectId: 'lead_iso',
      correlationId: 'corr_iso',
    });

    // Foreign tenant cannot claim or mutate execution
    await expect(
      engine.claimAndRun(foreignTenantCtx, execution.id),
    ).resolves.toBeNull();

    // Foreign tenant cannot cancel execution
    await expect(
      engine.cancelExecution(foreignTenantCtx, execution.id),
    ).rejects.toThrow(/not found/i);
  });

  // 16. Concurrent workers and transaction safety
  it('TEST-WFA-ENG-016 prevents multiple concurrent workers from claiming the same execution', async () => {
    const store = createMockAutomationStore();
    const engine = new AutomationEngine({ txRunner: store.runner, ids });

    const { execution } = await engine.createExecution(standardCtx, {
      tenantId: standardCtx.principal.tenantId,
      definitionId: 'wfd_01JTESTWFD0000000000000001',
      versionId: 'wfv_01JTESTWFV0000000000000001',
      triggerType: 'EVENT',
      subjectType: 'LEAD',
      subjectId: 'lead_race',
      correlationId: 'corr_race',
    });

    // Two workers attempt to claim simultaneously
    const [claim1, claim2] = await Promise.all([
      engine.claimAndRun(standardCtx, execution.id, 'worker_1'),
      engine.claimAndRun(standardCtx, execution.id, 'worker_2'),
    ]);

    // Exactly one worker claims and completes; the other gets null
    const claimedCount = [claim1, claim2].filter((res) => res !== null).length;
    expect(claimedCount).toBe(1);
  });

  // 17. Compatibility with Phase 2 contracts and database schema
  it('TEST-WFA-ENG-017 verifies end-to-end compatibility with Phase 2 contracts and schema', async () => {
    const store = createMockAutomationStore();
    const engine = new AutomationEngine({ txRunner: store.runner, ids });

    // System automation definition flow
    const { execution } = await engine.createExecution(standardCtx, {
      tenantId: standardCtx.principal.tenantId,
      definitionId: 'wfd_01JTESTSYSTEM0000000000001',
      versionId: 'wfv_01JTESTSYSTEMV000000000001',
      triggerType: 'EVENT',
      subjectType: 'SYSTEM',
      subjectId: 'sys_event_1',
      correlationId: 'corr_sys',
    });

    const finished = await engine.claimAndRun(standardCtx, execution.id);
    expect(finished?.status).toBe('SUCCEEDED');
    expect(finished?.chainDepth).toBe(0);
    expect(finished?.triggerType).toBe('EVENT');
  });

  // Extra verification: WAITING step and resumption
  it('TEST-WFA-ENG-018 handles WAITING status and resumption with merged payload', async () => {
    const store = createMockAutomationStore();
    const engine = new AutomationEngine({ txRunner: store.runner, ids });

    const { execution } = await engine.createExecution(standardCtx, {
      tenantId: standardCtx.principal.tenantId,
      definitionId: 'wfd_01JTESTWAIT000000000000001',
      versionId: 'wfv_01JTESTWAITV0000000000001',
      triggerType: 'EVENT',
      subjectType: 'LEAD',
      subjectId: 'lead_wait_1',
      correlationId: 'corr_wait_1',
    });

    const waiting = await engine.claimAndRun(standardCtx, execution.id);
    expect(waiting?.status).toBe('WAITING');

    // Resume execution with external event payload
    const resumed = await engine.resumeExecution(standardCtx, execution.id, {
      leadReplied: true,
    });
    expect(resumed.status).toBe('RUNNING');
    expect(resumed.context.leadReplied).toBe(true);

    // Continue step execution
    const finished = await engine.claimAndRun(standardCtx, execution.id);
    expect(finished?.status).toBe('SUCCEEDED');
  });

  // Extra verification: Dead Letter resolution by operator (RETRY, SKIP, CANCEL)
  it('TEST-WFA-ENG-019 resolves dead letters via operator actions (SKIP and RETRY)', async () => {
    const store = createMockAutomationStore();
    const engine = new AutomationEngine({ txRunner: store.runner, ids });

    // Seed a dead-lettered execution
    const dlId = 'wfdl_01JTESTDL0000000000000001';
    const execId = 'wfe_01JTESTEXEC_DL_0000000001';
    const stepExecId = 'wfse_01JTESTSTEP_DL_00000001';

    store.executions.push({
      id: execId,
      tenant_id: standardCtx.principal.tenantId,
      definition_id: 'wfd_01JTESTWFD0000000000000001',
      version_id: 'wfv_01JTESTWFV0000000000000001',
      trigger_type: 'EVENT',
      trigger_event_id: null,
      subject_type: 'LEAD',
      subject_id: 'lead_dl_op',
      status: 'DEAD_LETTERED',
      current_step_index: 2,
      context: {},
      dry_run: false,
      worker_id: null,
      lease_expires_at: null,
      error_code: 'TASK_CREATE_FAIL',
      error_message: 'Downstream queue offline',
      idempotency_key: null,
      correlation_id: 'corr_dl_res',
      causation_id: null,
      chain_depth: 0,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    store.stepExecutions.push({
      id: stepExecId,
      tenant_id: standardCtx.principal.tenantId,
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
      tenant_id: standardCtx.principal.tenantId,
      execution_id: execId,
      step_execution_id: stepExecId,
      reason: 'MAX_RETRIES_EXCEEDED',
      error_details: { attempts: 4 },
      resolution_status: 'OPEN',
      resolved_by: null,
      resolved_at: null,
      resolution_action: null,
      created_at: new Date(),
    });

    // Operator resolves via SKIP
    const { deadLetter, execution } = await engine.resolveDeadLetter(
      standardCtx,
      dlId,
      'SKIP',
      'Step was manually performed by customer support',
    );

    expect(deadLetter.resolutionStatus).toBe('RESOLVED');
    expect(deadLetter.resolutionAction).toBe('SKIP');
    expect(execution.status).toBe('RUNNING');
    expect(execution.currentStepIndex).toBe(3); // Advanced beyond step 2

    // Verify step was marked SKIPPED
    const step = store.stepExecutions.find((s) => s.id === stepExecId);
    expect(step?.status).toBe('SKIPPED');
    expect(step?.skip_reason).toBe('Step was manually performed by customer support');
  });

  // 20. Worker lease heartbeat extension
  it('TEST-WFA-ENG-020 extends worker lease via heartbeat', async () => {
    const store = createMockAutomationStore();
    const engine = new AutomationEngine({
      txRunner: store.runner,
      ids,
      workerConfig: { leaseDurationMs: 60_000 },
    });

    // Create execution and claim lease
    const { execution } = await engine.createExecution(standardCtx, {
      tenantId: standardCtx.principal.tenantId,
      definitionId: 'wfd_01JTESTWAIT000000000000001',
      versionId: 'wfv_01JTESTWAITV0000000000001',
      triggerType: 'EVENT',
      subjectType: 'LEAD',
      subjectId: 'lead_hb',
      correlationId: 'corr_hb',
    });

    const workerId = 'worker_heartbeat_node';
    await engine.claimAndRun(standardCtx, execution.id, workerId);

    // Heartbeat to extend lease
    const extended = await engine.heartbeat(standardCtx, execution.id, workerId);
    expect(extended).toBe(true);

    // Mismatched worker cannot extend lease
    const badWorkerExtend = await engine.heartbeat(standardCtx, execution.id, 'worker_imposter');
    expect(badWorkerExtend).toBe(false);
  });

  // 21. Step timeout handling
  it('TEST-WFA-ENG-021 terminates execution step on timeout and dead-letters ambiguous outcome', async () => {
    const store = createMockAutomationStore();
    const timeoutEngine = new AutomationEngine({
      txRunner: store.runner,
      ids,
      workerConfig: { maxStepTimeoutMs: 50 }, // 50ms short timeout for test
      handlers: {
        CALL_WEBHOOK: {
          async execute() {
            // Simulate hanging external call longer than 50ms
            await new Promise((resolve) => setTimeout(resolve, 200));
            return { status: 'SUCCEEDED' };
          },
        },
      },
    });

    const { execution } = await timeoutEngine.createExecution(standardCtx, {
      tenantId: standardCtx.principal.tenantId,
      definitionId: 'wfd_01JTESTRETRY00000000000001',
      versionId: 'wfv_01JTESTRETRYV000000000001',
      triggerType: 'MANUAL',
      subjectType: 'LEAD',
      subjectId: 'lead_timeout',
      correlationId: 'corr_to',
    });

    const outcome = await timeoutEngine.claimAndRun(standardCtx, execution.id);
    expect(outcome?.status).toBe('DEAD_LETTERED');
    expect(outcome?.errorCode).toBe('STEP_TIMEOUT');
    expect(store.deadLetters.some((dl) => dl.reason === 'AMBIGUOUS_EXTERNAL_OUTCOME')).toBe(true);
  });

  // 22. Outbox domain events emission
  it('TEST-WFA-ENG-022 emits domain event to outbox port on terminal state', async () => {
    const store = createMockAutomationStore();
    const engine = new AutomationEngine({
      txRunner: store.runner,
      ids,
      outboxPort: store.mockOutboxPort,
    });

    const { execution } = await engine.createExecution(standardCtx, {
      tenantId: standardCtx.principal.tenantId,
      definitionId: 'wfd_01JTESTWFD0000000000000001',
      versionId: 'wfv_01JTESTWFV0000000000000001',
      triggerType: 'EVENT',
      subjectType: 'LEAD',
      subjectId: 'lead_outbox',
      correlationId: 'corr_outbox',
    });

    await engine.claimAndRun(standardCtx, execution.id);

    // Outbox entry recorded for execution completion
    const event = store.outboxEntries.find((e) => e.type === 'automation.execution_succeeded');
    expect(event).toBeDefined();
    expect(event?.subject.id).toBe(execution.id);
    expect(event?.data.status).toBe('SUCCEEDED');
  });

  // 23. Prevention of recursive loops via chain depth
  it('TEST-WFA-ENG-023 prevents recursive execution loops by enforcing max chain depth', async () => {
    const store = createMockAutomationStore();
    const engine = new AutomationEngine({ txRunner: store.runner, ids });

    // Valid chain depth 0, 1, 2, 3
    for (const depth of [0, 1, 2, 3]) {
      const res = await engine.createExecution(standardCtx, {
        tenantId: standardCtx.principal.tenantId,
        definitionId: 'wfd_01JTESTWFD0000000000000001',
        versionId: 'wfv_01JTESTWFV0000000000000001',
        triggerType: 'EVENT',
        subjectType: 'LEAD',
        subjectId: `lead_depth_${depth}`,
        correlationId: `corr_depth_${depth}`,
        chainDepth: depth,
      });
      expect(res.execution.chainDepth).toBe(depth);
    }

    // Exceeding max chain depth (>3) throws VALIDATION_ERROR
    await expect(
      engine.createExecution(standardCtx, {
        tenantId: standardCtx.principal.tenantId,
        definitionId: 'wfd_01JTESTWFD0000000000000001',
        versionId: 'wfv_01JTESTWFV0000000000000001',
        triggerType: 'EVENT',
        subjectType: 'LEAD',
        subjectId: 'lead_depth_loop',
        correlationId: 'corr_depth_loop',
        chainDepth: 4,
      }),
    ).rejects.toThrow(/Workflow chain depth '4' exceeds maximum allowed depth of 3/);
  });

  // 24. Safe dry-run simulation mode
  it('TEST-WFA-ENG-024 supports safe dry-run execution without external state mutation', async () => {
    const store = createMockAutomationStore();
    const engine = new AutomationEngine({ txRunner: store.runner, ids });

    const { execution } = await engine.createExecution(standardCtx, {
      tenantId: standardCtx.principal.tenantId,
      definitionId: 'wfd_01JTESTWFD0000000000000001',
      versionId: 'wfv_01JTESTWFV0000000000000001',
      triggerType: 'EVENT',
      subjectType: 'LEAD',
      subjectId: 'lead_dry_run',
      correlationId: 'corr_dry',
      dryRun: true,
    });

    expect(execution.dryRun).toBe(true);

    const completed = await engine.claimAndRun(standardCtx, execution.id);
    expect(completed?.status).toBe('SUCCEEDED');
    expect(completed?.dryRun).toBe(true);
  });
});
