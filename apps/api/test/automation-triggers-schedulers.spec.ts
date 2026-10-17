// apps/api/test/automation-triggers-schedulers.spec.ts — owner: Dev 1 / Dev 6 (MOD-WFA Phase 6)
import type { DomainEventEnvelope, RequestContext, StepDefinition } from '@dsa/contracts';
import { createIdGenerator } from '@dsa/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { AutomationEngine } from '../src/modules/automation/engine';
import { AutomationSchedulerService, computeNextCronRun } from '../src/modules/automation/scheduler';
import { AutomationTriggerService } from '../src/modules/automation/triggers';
import { testPrincipal } from './support/fake-auth';
import { createMockAutomationStore } from './support/mock-automation-db';

describe('Module 24: Workflow Automation (MOD-WFA) Triggers & Schedulers (Phase 6)', () => {
  const ids = createIdGenerator();
  let store: ReturnType<typeof createMockAutomationStore>;
  let engine: AutomationEngine;
  let triggerService: AutomationTriggerService;
  let schedulerService: AutomationSchedulerService;

  const tenantA = 'ten_01JTESTTENANT00000000000000';
  const tenantB = 'ten_01JTESTTENANT00000000000001';

  const testCtx: RequestContext = {
    principal: testPrincipal({
      id: 'usr_trigger_worker_01',
      tenantId: tenantA,
      grants: [
        { code: 'automation.read', scope: 'TENANT', branchIds: [] },
        { code: 'automation.execute', scope: 'TENANT', branchIds: [] },
        { code: 'automation.operator', scope: 'TENANT', branchIds: [] },
      ],
    }),
    correlationId: 'corr_trig_test_01',
    now: new Date('2026-10-14T12:00:00.000Z'),
  };

  beforeEach(() => {
    store = createMockAutomationStore();
    // Clear default definitions and versions so trigger tests have deterministic isolation
    store.definitions.length = 0;
    store.versions.length = 0;

    engine = new AutomationEngine({
      txRunner: store.runner,
      ids,
      auditPort: store.mockAuditPort,
      outboxPort: store.mockOutboxPort,
    });
    triggerService = new AutomationTriggerService({
      txRunner: store.runner,
      engine,
    });
    schedulerService = new AutomationSchedulerService({
      txRunner: store.runner,
      engine,
    });
  });

  // ===========================================================================
  // 1. CRON PARSING & TIMEZONE HANDLING
  // ===========================================================================
  describe('computeNextCronRun', () => {
    it('TEST-WFA-CRON-001 calculates next run for every-minute cron "* * * * *"', () => {
      const fromDate = new Date('2026-10-14T12:00:00.000Z');
      const nextRun = computeNextCronRun('* * * * *', fromDate, 'Asia/Kolkata');
      expect(nextRun).toBeDefined();
      expect(nextRun.getTime()).toBeGreaterThan(fromDate.getTime());
      expect(nextRun.toISOString()).toBe('2026-10-14T12:01:00.000Z');
    });

    it('TEST-WFA-CRON-002 calculates step cron "*/15 * * * *"', () => {
      const fromDate = new Date('2026-10-14T12:05:00.000Z');
      const nextRun = computeNextCronRun('*/15 * * * *', fromDate, 'Asia/Kolkata');
      expect(nextRun).toBeDefined();
      expect(nextRun.toISOString()).toBe('2026-10-14T12:15:00.000Z');
    });

    it('TEST-WFA-CRON-003 respects tenant timezone (Asia/Kolkata is UTC+5:30)', () => {
      // 09:00 IST is 03:30 UTC.
      // If current time is 02:00 UTC (07:30 IST), next 09:00 IST is 03:30 UTC same day.
      const fromDate = new Date('2026-10-14T02:00:00.000Z');
      const nextRun = computeNextCronRun('0 9 * * *', fromDate, 'Asia/Kolkata');
      expect(nextRun).toBeDefined();
      expect(nextRun.toISOString()).toBe('2026-10-14T03:30:00.000Z');
    });

    it('TEST-WFA-CRON-004 handles day-of-week ranges (e.g. 1-5 for Mon-Fri)', () => {
      // 2026-10-17 is Saturday (DOW = 6).
      // Next weekday 1-5 at 09:00 IST will be Monday 2026-10-19 03:30 UTC.
      const saturday = new Date('2026-10-17T05:00:00.000Z');
      const nextRun = computeNextCronRun('0 9 * * 1-5', saturday, 'Asia/Kolkata');
      expect(nextRun).toBeDefined();
      expect(nextRun.toISOString()).toBe('2026-10-19T03:30:00.000Z');
    });

    it('TEST-WFA-CRON-005 throws error for invalid cron pattern', () => {
      expect(() => computeNextCronRun('invalid cron format', new Date(), 'Asia/Kolkata')).toThrow(
        /Invalid cron expression/,
      );
    });
  });

  // ===========================================================================
  // 2. DOMAIN EVENT TRIGGER SUBSCRIPTION & DISPATCH
  // ===========================================================================
  describe('AutomationTriggerService.handleDomainEvent', () => {
    function setupActiveEventWorkflow(eventType: string, filters: any[] = []) {
      const defId = 'wfd_01JTESTEVENTDEF00000000001';
      const verId = 'wfv_01JTESTEVENTVER00000000001';

      store.definitions.push({
        id: defId,
        tenant_id: tenantA,
        code: 'lead_qualification_event_wf',
        name: 'Lead Qualification Event Workflow',
        description: 'Triggered on lead.created',
        trigger_type: 'EVENT',
        entity_type: 'LEAD',
        status: 'ACTIVE',
        is_system: false,
        pinned_version_id: verId,
        lock_version: 1,
        created_by: 'usr_maker_01',
        created_at: new Date('2026-10-14T10:00:00.000Z'),
        updated_by: 'usr_maker_01',
        updated_at: new Date('2026-10-14T10:00:00.000Z'),
      });

      const steps: StepDefinition[] = [
        {
          id: 'stp_log',
          name: 'Log Lead',
          type: 'NOTIFY',
          isSkippable: false,
          config: { title: 'Lead qualified' },
        },
      ];

      store.versions.push({
        id: verId,
        tenant_id: tenantA,
        definition_id: defId,
        version_no: 1,
        status: 'ACTIVE',
        trigger_config: {
          eventType,
          filters,
        },
        steps,
        content_hash: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        author_id: 'usr_maker_01',
        submitted_by: 'usr_maker_01',
        submitted_at: new Date('2026-10-14T10:00:00.000Z'),
        approved_by: 'usr_checker_01',
        approved_at: new Date('2026-10-14T10:00:00.000Z'),
        rejection_reason: null,
        lock_version: 1,
        created_at: new Date('2026-10-14T10:00:00.000Z'),
      });

      return { defId, verId };
    }

    it('TEST-WFA-TRG-001 dispatches workflow execution when event matches type and filters', async () => {
      setupActiveEventWorkflow('lead.created', [
        { field: 'loanType', op: 'EQ', value: 'HOME_LOAN' },
        { field: 'requestedAmount', op: 'IN', value: [500000, 1000000] },
      ]);

      const event: DomainEventEnvelope = {
        id: 'evt_01JTESTEVT0000000000000001',
        type: 'lead.created',
        version: 1,
        tenantId: tenantA,
        occurredAt: '2026-10-14T12:00:00.000Z',
        correlationId: 'corr_evt_01',
        causationId: null,
        chainDepth: 0,
        subject: { type: 'LEAD', id: 'lead_01JTESTLEAD000000000001' },
        data: {
          loanType: 'HOME_LOAN',
          requestedAmount: 1000000,
          customerName: 'Aarav Patel',
        },
      };

      const results = await triggerService.handleDomainEvent(testCtx, event);

      expect(results).toHaveLength(1);
      expect(results[0]!.definitionId).toBe('wfd_01JTESTEVENTDEF00000000001');
      expect(results[0]!.replayed).toBe(false);

      // Verify execution was created and run
      expect(store.executions).toHaveLength(1);
      expect(store.executions[0]!.trigger_type).toBe('EVENT');
      expect(store.executions[0]!.subject_id).toBe('lead_01JTESTLEAD000000000001');
      expect(store.executions[0]!.status).toBe('SUCCEEDED');
    });

    it('TEST-WFA-TRG-002 skips workflow when event payload does not satisfy filter', async () => {
      setupActiveEventWorkflow('lead.created', [{ field: 'loanType', op: 'EQ', value: 'PERSONAL_LOAN' }]);

      const event: DomainEventEnvelope = {
        id: 'evt_01JTESTEVT0000000000000002',
        type: 'lead.created',
        version: 1,
        tenantId: tenantA,
        occurredAt: '2026-10-14T12:00:00.000Z',
        correlationId: 'corr_evt_02',
        causationId: null,
        chainDepth: 0,
        subject: { type: 'LEAD', id: 'lead_01JTESTLEAD000000000002' },
        data: {
          loanType: 'HOME_LOAN', // Does not match PERSONAL_LOAN
        },
      };

      const results = await triggerService.handleDomainEvent(testCtx, event);

      expect(results).toHaveLength(0);
      expect(store.executions).toHaveLength(0);
    });

    it('TEST-WFA-TRG-003 deduplicates event redelivery with idempotent key', async () => {
      setupActiveEventWorkflow('lead.created');

      const event: DomainEventEnvelope = {
        id: 'evt_01JTESTEVT0000000000000003',
        type: 'lead.created',
        version: 1,
        tenantId: tenantA,
        occurredAt: '2026-10-14T12:00:00.000Z',
        correlationId: 'corr_evt_03',
        causationId: null,
        chainDepth: 0,
        subject: { type: 'LEAD', id: 'lead_01JTESTLEAD000000000003' },
        data: { loanType: 'HOME_LOAN' },
      };

      // First delivery: dispatches
      const firstResults = await triggerService.handleDomainEvent(testCtx, event);
      expect(firstResults).toHaveLength(1);
      expect(firstResults[0]!.replayed).toBe(false);

      // Second delivery: duplicate detected and marked replayed
      const secondResults = await triggerService.handleDomainEvent(testCtx, event);
      expect(secondResults).toHaveLength(1);
      expect(secondResults[0]!.replayed).toBe(true);

      expect(store.executions).toHaveLength(1); // Still only 1 execution in DB
    });

    it('TEST-WFA-TRG-004 prevents infinite recursion loops when chainDepth > 3', async () => {
      setupActiveEventWorkflow('lead.created');

      const loopingEvent: DomainEventEnvelope = {
        id: 'evt_01JTESTEVT0000000000000004',
        type: 'lead.created',
        version: 1,
        tenantId: tenantA,
        occurredAt: '2026-10-14T12:00:00.000Z',
        correlationId: 'corr_evt_loop',
        causationId: null,
        chainDepth: 4 as any, // Exceeds MAX_CHAIN_DEPTH = 3
        subject: { type: 'LEAD', id: 'lead_01JTESTLEAD000000000004' },
        data: { loanType: 'HOME_LOAN' },
      };

      await expect(triggerService.handleDomainEvent(testCtx, loopingEvent)).rejects.toThrow(
        /Loop prevention/,
      );

      expect(store.executions).toHaveLength(0);
    });

    it('TEST-WFA-TRG-005 enqueues execution as PENDING without running if tenant concurrency limit reached', async () => {
      const { defId, verId } = setupActiveEventWorkflow('lead.created');

      // Pre-fill tenant with 10 RUNNING executions (concurrency cap)
      for (let i = 0; i < 10; i++) {
        store.executions.push({
          id: `wfe_running_${i}`,
          tenant_id: tenantA,
          definition_id: defId,
          version_id: verId,
          trigger_type: 'EVENT',
          trigger_event_id: null,
          subject_type: 'LEAD',
          subject_id: `lead_${i}`,
          idempotency_key: `key_${i}`,
          status: 'RUNNING',
          current_step_index: 0,
          context: {},
          dry_run: false,
          correlation_id: `corr_${i}`,
          causation_id: null,
          chain_depth: 0,
          worker_id: 'worker-1',
          lease_expires_at: new Date(Date.now() + 60000),
          started_at: new Date(),
          completed_at: null,
          error_code: null,
          error_message: null,
          created_at: new Date(),
          updated_at: new Date(),
        });
      }

      const event: DomainEventEnvelope = {
        id: 'evt_01JTESTEVT0000000000000005',
        type: 'lead.created',
        version: 1,
        tenantId: tenantA,
        occurredAt: '2026-10-14T12:00:00.000Z',
        correlationId: 'corr_evt_05',
        causationId: null,
        chainDepth: 0,
        subject: { type: 'LEAD', id: 'lead_01JTESTLEAD000000000005' },
        data: { loanType: 'HOME_LOAN' },
      };

      const results = await triggerService.handleDomainEvent(testCtx, event);

      expect(results).toHaveLength(1);
      expect(results[0]!.immediate).toBe(false);

      const enqueuedExec = store.executions.find((e) => e.id === results[0]!.executionId);
      expect(enqueuedExec).toBeDefined();
      expect(enqueuedExec!.status).toBe('PENDING'); // Queued, not executed synchronously
    });

    it('TEST-WFA-TRG-006 enforces strict tenant isolation on event triggers', async () => {
      setupActiveEventWorkflow('lead.created');

      // Event arrives for Tenant B
      const eventTenantB: DomainEventEnvelope = {
        id: 'evt_01JTESTEVT0000000000000006',
        type: 'lead.created',
        version: 1,
        tenantId: tenantB,
        occurredAt: '2026-10-14T12:00:00.000Z',
        correlationId: 'corr_evt_06',
        causationId: null,
        chainDepth: 0,
        subject: { type: 'LEAD', id: 'lead_01JTESTLEAD000000000006' },
        data: { loanType: 'HOME_LOAN' },
      };

      const ctxTenantB: RequestContext = {
        ...testCtx,
        principal: testPrincipal({
          id: 'usr_tenant_b',
          tenantId: tenantB,
          grants: [{ code: 'automation.read', scope: 'TENANT', branchIds: [] }],
        }),
      };

      const results = await triggerService.handleDomainEvent(ctxTenantB, eventTenantB);

      // Should not find or trigger Tenant A's workflow
      expect(results).toHaveLength(0);
    });
  });

  // ===========================================================================
  // 3. SCHEDULED TRIGGERS & CRON POLLER
  // ===========================================================================
  describe('AutomationSchedulerService.pollDueSchedules', () => {
    function setupActiveScheduleWorkflow(cron: string, timezone: string = 'Asia/Kolkata') {
      const defId = 'wfd_01JTESTSCHEDDEF00000000001';
      const verId = 'wfv_01JTESTSCHEDVER00000000001';

      store.definitions.push({
        id: defId,
        tenant_id: tenantA,
        code: 'daily_sla_check',
        name: 'Daily SLA Check',
        description: 'Scheduled SLA verification',
        trigger_type: 'SCHEDULE',
        entity_type: 'SYSTEM',
        status: 'ACTIVE',
        is_system: false,
        pinned_version_id: verId,
        lock_version: 1,
        created_by: 'usr_maker_01',
        created_at: new Date('2026-10-14T10:00:00.000Z'),
        updated_by: 'usr_maker_01',
        updated_at: new Date('2026-10-14T10:00:00.000Z'),
      });

      const steps: StepDefinition[] = [
        {
          id: 'stp_sla',
          name: 'Audit SLA Check',
          type: 'NOTIFY',
          isSkippable: false,
          config: { title: 'SLA verified' },
        },
      ];

      store.versions.push({
        id: verId,
        tenant_id: tenantA,
        definition_id: defId,
        version_no: 1,
        status: 'ACTIVE',
        trigger_config: {
          cron,
          timezone,
        },
        steps,
        content_hash: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        author_id: 'usr_maker_01',
        submitted_by: 'usr_maker_01',
        submitted_at: new Date('2026-10-14T10:00:00.000Z'),
        approved_by: 'usr_checker_01',
        approved_at: new Date('2026-10-14T10:00:00.000Z'),
        rejection_reason: null,
        lock_version: 1,
        created_at: new Date('2026-10-14T10:00:00.000Z'),
      });

      return { defId, verId };
    }

    it('TEST-WFA-SCH-001 registers schedule trigger with calculated next_run_at', async () => {
      const { defId } = setupActiveScheduleWorkflow('*/15 * * * *');

      const scheduled = await schedulerService.registerSchedule(testCtx, {
        definitionId: defId,
        cronExpression: '*/15 * * * *',
        timezone: 'Asia/Kolkata',
      });

      expect(scheduled.id).toBeDefined();
      expect(scheduled.cronExpression).toBe('*/15 * * * *');
      expect(scheduled.status).toBe('ACTIVE');
      expect(new Date(scheduled.nextRunAt).getTime()).toBeGreaterThan(testCtx.now.getTime());
    });

    it('TEST-WFA-SCH-002 polls due scheduled triggers, dispatches execution, and advances next_run_at', async () => {
      const { defId, verId } = setupActiveScheduleWorkflow('* * * * *');

      // Insert due scheduled trigger
      const schedId = 'stg_01JTESTSCHED000000000001';
      store.scheduledTriggers.push({
        id: schedId,
        tenant_id: tenantA,
        definition_id: defId,
        version_id: verId,
        cron_expression: '* * * * *',
        status: 'ACTIVE',
        payload: {},
        next_run_at: new Date('2026-10-14T11:59:00.000Z'), // 1 min in past relative to testCtx.now (12:00:00)
        last_run_at: null,
        created_at: new Date('2026-10-14T11:00:00.000Z'),
      });

      const results = await schedulerService.pollDueSchedules(testCtx);

      expect(results).toHaveLength(1);
      expect(results[0]!.triggerId).toBe(schedId);

      // Verify execution was created with SCHEDULE trigger
      const exec = store.executions.find((e) => e.id === results[0]!.executionId);
      expect(exec).toBeDefined();
      expect(exec!.trigger_type).toBe('SCHEDULE');
      expect(exec!.status).toBe('SUCCEEDED');

      // Verify schedule was updated with new next_run_at in the future
      const updatedSched = store.scheduledTriggers.find((s) => s.id === schedId);
      expect(updatedSched!.last_run_at).toBeDefined();
      expect(new Date(updatedSched!.next_run_at).getTime()).toBeGreaterThan(testCtx.now.getTime());
    });
  });

  // ===========================================================================
  // 4. TIMER DURABLE RESUMPTION
  // ===========================================================================
  describe('AutomationSchedulerService.pollDueTimers', () => {
    it('TEST-WFA-TMR-001 resumes WAITING executions whose wait timer has expired', async () => {
      const defId = 'wfd_01JTESTTMRDEF000000000001';
      const verId = 'wfv_01JTESTTMRVER000000000001';
      const execId = 'wfe_01JTESTTMREXEC00000000001';

      store.definitions.push({
        id: defId,
        tenant_id: tenantA,
        code: 'followup_timer_wf',
        name: 'Followup Timer Workflow',
        description: 'Timer workflow',
        trigger_type: 'MANUAL',
        entity_type: 'LEAD',
        status: 'ACTIVE',
        is_system: false,
        pinned_version_id: verId,
        lock_version: 1,
        created_by: 'usr_maker_01',
        created_at: new Date('2026-10-14T10:00:00.000Z'),
        updated_by: 'usr_maker_01',
        updated_at: new Date('2026-10-14T10:00:00.000Z'),
      });

      const steps: StepDefinition[] = [
        {
          id: 'stp_wait',
          name: 'Wait 1 Hour',
          type: 'WAIT',
          isSkippable: false,
          config: { durationMs: 3600000 },
        },
        {
          id: 'stp_after_wait',
          name: 'Log Resumed',
          type: 'NOTIFY',
          isSkippable: false,
          config: { title: 'Resumed after timer' },
        },
      ];

      store.versions.push({
        id: verId,
        tenant_id: tenantA,
        definition_id: defId,
        version_no: 1,
        status: 'ACTIVE',
        trigger_config: {},
        steps,
        content_hash: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        author_id: 'usr_maker_01',
        submitted_by: 'usr_maker_01',
        submitted_at: new Date('2026-10-14T10:00:00.000Z'),
        approved_by: 'usr_checker_01',
        approved_at: new Date('2026-10-14T10:00:00.000Z'),
        rejection_reason: null,
        lock_version: 1,
        created_at: new Date('2026-10-14T10:00:00.000Z'),
      });

      // Execution is WAITING with waitConfig untilIso in past
      store.executions.push({
        id: execId,
        tenant_id: tenantA,
        definition_id: defId,
        version_id: verId,
        trigger_type: 'MANUAL',
        trigger_event_id: null,
        subject_type: 'LEAD',
        subject_id: 'lead_01JTESTLEAD000000000001',
        status: 'WAITING',
        current_step_index: 0,
        context: {
          waitConfig: {
            stepIndex: 0,
            untilIso: '2026-10-14T11:30:00.000Z', // Expired at 11:30 (now is 12:00)
            reason: 'Timer elapsed',
          },
        },
        dry_run: false,
        idempotency_key: null,
        correlation_id: 'corr_tmr_01',
        causation_id: null,
        chain_depth: 0,
        worker_id: null,
        lease_expires_at: null,
        started_at: new Date('2026-10-14T10:30:00.000Z'),
        completed_at: null,
        error_code: null,
        error_message: null,
        created_at: new Date('2026-10-14T10:30:00.000Z'),
        updated_at: new Date('2026-10-14T10:30:00.000Z'),
      });

      store.stepExecutions.push({
        id: 'wfse_01JTESTWAIT0000000000001',
        tenant_id: tenantA,
        execution_id: execId,
        step_index: 0,
        step_id: 'stp_wait',
        step_type: 'WAIT',
        status: 'RUNNING',
        input_snapshot: {},
        output_snapshot: null,
        error_code: null,
        error_message: null,
        error_classification: null,
        attempts: 1,
        idempotency_key: `${execId}:stp_wait:0`,
        skip_reason: null,
        skipped_by: null,
        started_at: new Date('2026-10-14T10:30:00.000Z'),
        completed_at: null,
        created_at: new Date('2026-10-14T10:30:00.000Z'),
      });

      const results = await schedulerService.pollDueTimers(testCtx);

      expect(results).toHaveLength(1);
      expect(results[0]!.executionId).toBe(execId);
      expect(results[0]!.status).toBe('SUCCEEDED');

      // Verify execution advanced to SUCCEEDED (it resumed from step 1)
      const resumedExec = store.executions.find((e) => e.id === execId);
      expect(resumedExec).toBeDefined();
      expect(resumedExec!.status).toBe('SUCCEEDED');
      expect(resumedExec!.current_step_index).toBe(2); // Passed step 0 and 1
    });
  });

  // ===========================================================================
  // 5. WORKER LEASE EXPIRY & RECOVERY
  // ===========================================================================
  describe('AutomationSchedulerService.reapStaleWorkers', () => {
    it('TEST-WFA-WKR-001 reaps stale worker leases and resets execution to PENDING', async () => {
      const staleExecId = 'wfe_01JTESTSTALEEXEC000000001';

      store.executions.push({
        id: staleExecId,
        tenant_id: tenantA,
        definition_id: 'wfd_01JTESTDEF000000000001',
        version_id: 'wfv_01JTESTVER000000000001',
        trigger_type: 'MANUAL',
        trigger_event_id: null,
        subject_type: 'LEAD',
        subject_id: 'lead_01JTESTLEAD000000000001',
        status: 'RUNNING',
        current_step_index: 0,
        worker_id: 'worker-crashed-node-42',
        lease_expires_at: new Date('2026-10-14T11:45:00.000Z'), // Expired 15 mins ago
        context: {},
        dry_run: false,
        idempotency_key: null,
        correlation_id: 'corr_stale_01',
        causation_id: null,
        chain_depth: 0,
        started_at: new Date('2026-10-14T11:00:00.000Z'),
        completed_at: null,
        error_code: null,
        error_message: null,
        created_at: new Date('2026-10-14T11:00:00.000Z'),
        updated_at: new Date('2026-10-14T11:00:00.000Z'),
      });

      const result = await schedulerService.reapStaleWorkers(testCtx);

      expect(result.reapedCount).toBe(1);

      const reapedExec = store.executions.find((e) => e.id === staleExecId);
      expect(reapedExec).toBeDefined();
      expect(reapedExec!.status).toBe('PENDING');
      expect(reapedExec!.worker_id).toBeNull();
      expect(reapedExec!.lease_expires_at).toBeNull();
    });
  });
});
