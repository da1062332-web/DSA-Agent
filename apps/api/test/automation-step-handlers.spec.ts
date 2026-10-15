// apps/api/test/automation-step-handlers.spec.ts — owner: Dev 1 / Dev 6 (MOD-WFA Phase 5)
import { FakeDecisionPort, FakeTaskPort, FakeUserDirectoryPort } from '@dsa/contracts/fakes';
import type { RequestContext, StepDefinition } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';
import { createDefaultStepHandlers } from '../src/modules/automation/step-handlers';
import type { StepExecutionContext } from '../src/modules/automation/types';
import { testPrincipal } from './support/fake-auth';
import { createMockAutomationStore } from './support/mock-automation-db';

describe('Module 24: Workflow Automation (MOD-WFA) Step Handlers (Phase 5)', () => {
  const store = createMockAutomationStore();

  const testCtx: RequestContext = {
    principal: testPrincipal({
      id: 'usr_operator_01',
      tenantId: 'ten_01JTESTTENANT00000000000000',
      grants: [
        { code: 'automation.read', scope: 'TENANT', branchIds: [] },
        { code: 'automation.execute', scope: 'TENANT', branchIds: [] },
        { code: 'automation.operator', scope: 'TENANT', branchIds: [] },
      ],
    }),
    correlationId: 'corr_step_test_01',
    now: new Date('2026-10-14T12:00:00.000Z'),
  };

  function makeContext(
    step: StepDefinition,
    overrides: Partial<StepExecutionContext> = {},
  ): StepExecutionContext {
    return {
      tenantId: 'ten_01JTESTTENANT00000000000000',
      executionId: 'wfe_01JTESTEXEC00000000000001',
      stepIndex: 0,
      step,
      context: { score: 100, leadCategory: 'RETAIL' },
      subjectType: 'LEAD',
      subjectId: 'lead_01JTESTLEAD000000000001',
      dryRun: false,
      correlationId: 'corr_step_test_01',
      attempts: 1,
      requestCtx: testCtx,
      ...overrides,
    };
  }

  // ===========================================================================
  // 1. EVALUATE_DECISION
  // ===========================================================================
  describe('EVALUATE_DECISION Handler', () => {
    it('TEST-WFA-STP-001 invokes DecisionPort inside live tx, recording output snapshot and decision metadata', async () => {
      const decisionPort = new FakeDecisionPort();
      decisionPort.defaultOutputs = {
        'DK-lead.assignment': {
          pool: { queueId: 'queue_retail_intake' },
          strategy: 'ROUND_ROBIN',
          reasonText: 'Retail routing',
        },
      };

      const handlers = createDefaultStepHandlers({
        decisionPort,
        txRunner: store.runner,
      });

      const step: StepDefinition = {
        id: 'step_eval_routing',
        name: 'Evaluate Routing',
        type: 'EVALUATE_DECISION',
        isSkippable: false,
        config: {
          decisionKey: 'DK-lead.assignment',
          facts: { pincode: '400001', loanAmount: 500000 },
        },
      };

      const result = await handlers.EVALUATE_DECISION.execute(makeContext(step));

      expect(result.status).toBe('SUCCEEDED');
      expect(result.outputSnapshot).toBeDefined();
      expect(result.outputSnapshot?.decisionKey).toBe('DK-lead.assignment');
      expect(result.outputSnapshot?.status).toBe('OK');
      expect(result.outputSnapshot?.outputs).toEqual({
        pool: { queueId: 'queue_retail_intake' },
        strategy: 'ROUND_ROBIN',
        reasonText: 'Retail routing',
      });
      expect(decisionPort.decisions.length).toBe(1);
      expect(decisionPort.decisions[0]?.decisionKey).toBe('DK-lead.assignment');
      expect(decisionPort.decisions[0]?.idempotencyKey).toBe(
        'wfe_01JTESTEXEC00000000000001:step_eval_routing',
      );
    });

    it('TEST-WFA-STP-002 fails permanently with DECISION_KEY_MISSING when decisionKey is omitted', async () => {
      const handlers = createDefaultStepHandlers();
      const step: StepDefinition = {
        id: 'step_eval_empty',
        name: 'Evaluate Empty',
        type: 'EVALUATE_DECISION',
        isSkippable: false,
        config: {},
      };

      const result = await handlers.EVALUATE_DECISION.execute(makeContext(step));

      expect(result.status).toBe('FAILED');
      expect(result.error?.code).toBe('DECISION_KEY_MISSING');
      expect(result.error?.classification).toBe('PERMANENT');
    });

    it('TEST-WFA-STP-003 in dry-run mode, never calls DecisionPort and returns simulated outputs', async () => {
      const decisionPort = new FakeDecisionPort();
      const handlers = createDefaultStepHandlers({ decisionPort });

      const step: StepDefinition = {
        id: 'step_eval_sim',
        name: 'Simulated Eval',
        type: 'EVALUATE_DECISION',
        isSkippable: false,
        config: {
          decisionKey: 'DK-lead.duplicate',
          simulatedOutputs: { isDuplicate: false, candidateCount: 0 },
        },
      };

      const result = await handlers.EVALUATE_DECISION.execute(
        makeContext(step, { dryRun: true }),
      );

      expect(result.status).toBe('SUCCEEDED');
      expect(result.outputSnapshot?.dryRun).toBe(true);
      expect(result.outputSnapshot?.simulated).toBe(true);
      expect(result.outputSnapshot?.outputs).toEqual({ isDuplicate: false, candidateCount: 0 });
      // Invariant: DecisionPort was NEVER invoked
      expect(decisionPort.decisions.length).toBe(0);
    });
  });

  // ===========================================================================
  // 2. BRANCH
  // ===========================================================================
  describe('BRANCH Handler', () => {
    it('TEST-WFA-STP-004 routes execution to matched branch index when condition evaluates true', async () => {
      const handlers = createDefaultStepHandlers();
      const step: StepDefinition = {
        id: 'step_branch',
        name: 'Route by Score',
        type: 'BRANCH',
        isSkippable: false,
        config: {
          conditions: [
            { if: { field: 'score', op: 'EQ', value: 100 }, goToStepIndex: 3 },
            { if: { field: 'score', op: 'EQ', value: 50 }, goToStepIndex: 2 },
          ],
          defaultStepIndex: 1,
        },
      };

      const result = await handlers.BRANCH.execute(
        makeContext(step, { context: { score: 100 } }),
      );

      expect(result.status).toBe('SUCCEEDED');
      expect(result.nextStepIndex).toBe(3);
      expect(result.outputSnapshot?.matchedBranch).toBe(true);
    });

    it('TEST-WFA-STP-005 falls back to defaultStepIndex when no conditions match', async () => {
      const handlers = createDefaultStepHandlers();
      const step: StepDefinition = {
        id: 'step_branch_default',
        name: 'Route by Score',
        type: 'BRANCH',
        isSkippable: false,
        config: {
          conditions: [{ if: { field: 'score', op: 'EQ', value: 999 }, goToStepIndex: 4 }],
          defaultStepIndex: 1,
        },
      };

      const result = await handlers.BRANCH.execute(
        makeContext(step, { context: { score: 100 } }),
      );

      expect(result.status).toBe('SUCCEEDED');
      expect(result.nextStepIndex).toBe(1);
      expect(result.outputSnapshot?.matchedBranch).toBe(false);
    });

    it('TEST-WFA-STP-006 evaluates IN, NOT_IN, and nested object fields in conditions', async () => {
      const handlers = createDefaultStepHandlers();
      const step: StepDefinition = {
        id: 'step_branch_nested',
        name: 'Branch on Decision Output',
        type: 'BRANCH',
        isSkippable: false,
        config: {
          conditions: [
            {
              if: { field: 'decision.output.tier', op: 'IN', value: ['PLATINUM', 'GOLD'] },
              goToStepIndex: 5,
            },
          ],
          defaultStepIndex: 2,
        },
      };

      const result = await handlers.BRANCH.execute(
        makeContext(step, { context: { decision: { output: { tier: 'GOLD' } } } }),
      );

      expect(result.status).toBe('SUCCEEDED');
      expect(result.nextStepIndex).toBe(5);
    });
  });

  // ===========================================================================
  // 3. CREATE_TASK
  // ===========================================================================
  describe('CREATE_TASK Handler', () => {
    it('TEST-WFA-STP-007 dispatches task creation via TaskPort with idempotency key', async () => {
      const taskPort = new FakeTaskPort();
      const handlers = createDefaultStepHandlers({ taskPort, txRunner: store.runner });

      const step: StepDefinition = {
        id: 'step_create_kyc_task',
        name: 'Create KYC Task',
        type: 'CREATE_TASK',
        isSkippable: false,
        config: {
          title: 'Collect KYC Documents from applicant',
          taskType: 'DOCUMENT_COLLECTION',
          ownerUserId: 'usr_agent_01',
          priority: 'HIGH',
        },
      };

      const result = await handlers.CREATE_TASK.execute(makeContext(step));

      expect(result.status).toBe('SUCCEEDED');
      expect(result.outputSnapshot?.created).toBe(true);
      expect(taskPort.commands.length).toBe(1);

      const cmd = taskPort.commands[0]!;
      expect(cmd.title).toBe('Collect KYC Documents from applicant');
      expect(cmd.type).toBe('DOCUMENT_COLLECTION');
      expect(cmd.owner).toEqual({ userId: 'usr_agent_01' });
      expect(cmd.priority).toBe('HIGH');
      expect(cmd.idempotencyKey).toBe('wfe_01JTESTEXEC00000000000001:step_create_kyc_task');
    });

    it('TEST-WFA-STP-008 rejects missing or empty title with TASK_TITLE_MISSING', async () => {
      const handlers = createDefaultStepHandlers();
      const step: StepDefinition = {
        id: 'step_empty_task',
        name: 'Task without title',
        type: 'CREATE_TASK',
        isSkippable: false,
        config: { title: '' },
      };

      const result = await handlers.CREATE_TASK.execute(makeContext(step));

      expect(result.status).toBe('FAILED');
      expect(result.error?.code).toBe('TASK_TITLE_MISSING');
      expect(result.error?.classification).toBe('PERMANENT');
    });

    it('TEST-WFA-STP-009 rejects task titles containing sensitive PII (PAN, mobile, email)', async () => {
      const taskPort = new FakeTaskPort();
      const handlers = createDefaultStepHandlers({ taskPort });

      // 1. Mobile number
      const phoneStep: StepDefinition = {
        id: 'step_phone_task',
        name: 'Task with Phone',
        type: 'CREATE_TASK',
        isSkippable: false,
        config: { title: 'Call customer on 9876543210 immediately' },
      };
      const phoneRes = await handlers.CREATE_TASK.execute(makeContext(phoneStep));
      expect(phoneRes.status).toBe('FAILED');
      expect(phoneRes.error?.code).toBe('TASK_TITLE_SENSITIVE_DATA');

      // 2. Email
      const emailStep: StepDefinition = {
        id: 'step_email_task',
        name: 'Task with Email',
        type: 'CREATE_TASK',
        isSkippable: false,
        config: { title: 'Send documents to client@example.com' },
      };
      const emailRes = await handlers.CREATE_TASK.execute(makeContext(emailStep));
      expect(emailRes.status).toBe('FAILED');
      expect(emailRes.error?.code).toBe('TASK_TITLE_SENSITIVE_DATA');

      // 3. PAN
      const panStep: StepDefinition = {
        id: 'step_pan_task',
        name: 'Task with PAN',
        type: 'CREATE_TASK',
        isSkippable: false,
        config: { title: 'Verify card ABCDE1234F against records' },
      };
      const panRes = await handlers.CREATE_TASK.execute(makeContext(panStep));
      expect(panRes.status).toBe('FAILED');
      expect(panRes.error?.code).toBe('TASK_TITLE_SENSITIVE_DATA');

      // Invariant: Zero tasks created
      expect(taskPort.commands.length).toBe(0);
    });

    it('TEST-WFA-STP-010 in dry-run mode, never invokes TaskPort and returns simulated task', async () => {
      const taskPort = new FakeTaskPort();
      const handlers = createDefaultStepHandlers({ taskPort });

      const step: StepDefinition = {
        id: 'step_sim_task',
        name: 'Simulated Task',
        type: 'CREATE_TASK',
        isSkippable: false,
        config: { title: 'Follow up with lead on loan options' },
      };

      const result = await handlers.CREATE_TASK.execute(makeContext(step, { dryRun: true }));

      expect(result.status).toBe('SUCCEEDED');
      expect(result.outputSnapshot?.dryRun).toBe(true);
      expect(result.outputSnapshot?.created).toBe(false);
      expect(taskPort.commands.length).toBe(0);
    });
  });

  // ===========================================================================
  // 4. ASSIGN_OWNER
  // ===========================================================================
  describe('ASSIGN_OWNER Handler', () => {
    it('TEST-WFA-STP-011 assigns active owner user validated against UserDirectoryPort', async () => {
      const userDirectory = new FakeUserDirectoryPort();
      userDirectory.users.set('usr_active_agent', {
        userId: 'usr_active_agent',
        status: 'ACTIVE',
        availability: 'AVAILABLE',
        primaryBranchId: 'branch_01',
        branchIds: ['branch_01'],
      });

      const handlers = createDefaultStepHandlers({
        userDirectoryPort: userDirectory,
        txRunner: store.runner,
      });

      const step: StepDefinition = {
        id: 'step_assign_user',
        name: 'Assign to Agent',
        type: 'ASSIGN_OWNER',
        isSkippable: false,
        config: { ownerUserId: 'usr_active_agent' },
      };

      const result = await handlers.ASSIGN_OWNER.execute(makeContext(step));

      expect(result.status).toBe('SUCCEEDED');
      expect(result.outputSnapshot?.assignedOwnerUserId).toBe('usr_active_agent');
      expect(result.outputSnapshot?.updated).toBe(true);
    });

    it('TEST-WFA-STP-012 rejects suspended or nonexistent owner user with INVALID_OWNER', async () => {
      const userDirectory = new FakeUserDirectoryPort();
      userDirectory.users.set('usr_suspended', {
        userId: 'usr_suspended',
        status: 'SUSPENDED',
        availability: 'AVAILABLE',
        primaryBranchId: 'branch_01',
        branchIds: ['branch_01'],
      });

      const handlers = createDefaultStepHandlers({
        userDirectoryPort: userDirectory,
        txRunner: store.runner,
      });

      const step: StepDefinition = {
        id: 'step_assign_inactive',
        name: 'Assign Inactive User',
        type: 'ASSIGN_OWNER',
        isSkippable: false,
        config: { ownerUserId: 'usr_suspended' },
      };

      const result = await handlers.ASSIGN_OWNER.execute(makeContext(step));

      expect(result.status).toBe('FAILED');
      expect(result.error?.code).toBe('INVALID_OWNER');
      expect(result.error?.classification).toBe('PERMANENT');
    });

    it('TEST-WFA-STP-013 picks next round-robin member via UserDirectoryPort.pickRoundRobin', async () => {
      const userDirectory = new FakeUserDirectoryPort();
      userDirectory.roundRobinMembers.set('queue_intake', ['usr_rr_1', 'usr_rr_2']);

      const handlers = createDefaultStepHandlers({
        userDirectoryPort: userDirectory,
        txRunner: store.runner,
      });

      const step: StepDefinition = {
        id: 'step_assign_rr',
        name: 'Round Robin Assignment',
        type: 'ASSIGN_OWNER',
        isSkippable: false,
        config: { roundRobinQueueId: 'queue_intake' },
      };

      // 1st pick
      const res1 = await handlers.ASSIGN_OWNER.execute(makeContext(step));
      expect(res1.status).toBe('SUCCEEDED');
      expect(res1.outputSnapshot?.assignedOwnerUserId).toBe('usr_rr_1');

      // 2nd pick
      const res2 = await handlers.ASSIGN_OWNER.execute(makeContext(step));
      expect(res2.status).toBe('SUCCEEDED');
      expect(res2.outputSnapshot?.assignedOwnerUserId).toBe('usr_rr_2');
    });

    it('TEST-WFA-STP-014 rejects inactive queue with INVALID_QUEUE', async () => {
      const userDirectory = new FakeUserDirectoryPort();
      userDirectory.queues.set('queue_inactive', {
        queueId: 'queue_inactive',
        kind: 'INTAKE',
        branchId: 'branch_01',
        active: false,
        recordTypes: ['TASK'],
      });

      const handlers = createDefaultStepHandlers({
        userDirectoryPort: userDirectory,
        txRunner: store.runner,
      });

      const step: StepDefinition = {
        id: 'step_assign_dead_queue',
        name: 'Assign Inactive Queue',
        type: 'ASSIGN_OWNER',
        isSkippable: false,
        config: { ownerQueueId: 'queue_inactive' },
      };

      const result = await handlers.ASSIGN_OWNER.execute(makeContext(step));

      expect(result.status).toBe('FAILED');
      expect(result.error?.code).toBe('INVALID_QUEUE');
      expect(result.error?.classification).toBe('PERMANENT');
    });

    it('TEST-WFA-STP-015 in dry-run mode, never mutates database and returns simulated assignment', async () => {
      const handlers = createDefaultStepHandlers();
      const step: StepDefinition = {
        id: 'step_assign_dryrun',
        name: 'Dry-run assign',
        type: 'ASSIGN_OWNER',
        isSkippable: false,
        config: { ownerUserId: 'usr_dryrun_sim' },
      };

      const result = await handlers.ASSIGN_OWNER.execute(makeContext(step, { dryRun: true }));

      expect(result.status).toBe('SUCCEEDED');
      expect(result.outputSnapshot?.dryRun).toBe(true);
      expect(result.outputSnapshot?.updated).toBe(false);
      expect(result.outputSnapshot?.assignedOwnerUserId).toBe('usr_dryrun_sim');
    });
  });

  // ===========================================================================
  // 5. NOTIFY
  // ===========================================================================
  describe('NOTIFY Handler', () => {
    it('TEST-WFA-STP-016 dispatches in-app notification and returns notification ID', async () => {
      let dispatched = false;
      const fakeNotificationService = {
        async createNotification(_ctx: RequestContext, input: unknown) {
          dispatched = true;
          return { id: 'ntf_mock_created_01', ...(input as object) };
        },
      };

      const handlers = createDefaultStepHandlers({
        notificationService: fakeNotificationService as never,
      });

      const step: StepDefinition = {
        id: 'step_notify_sla',
        name: 'Notify SLA Breach',
        type: 'NOTIFY',
        isSkippable: false,
        config: {
          title: 'SLA Breach: Lead pending contact for > 2 hours',
          userId: 'usr_manager_01',
          deepLink: '/leads/lead_01JTESTLEAD000000000001',
        },
      };

      const result = await handlers.NOTIFY.execute(makeContext(step));

      expect(result.status).toBe('SUCCEEDED');
      expect(result.outputSnapshot?.notificationSent).toBe(true);
      expect(result.outputSnapshot?.notificationId).toBe('ntf_mock_created_01');
      expect(dispatched).toBe(true);
    });

    it('TEST-WFA-STP-017 handles user notification preference suppression correctly', async () => {
      const fakeNotificationService = {
        async createNotification() {
          // Null return indicates suppressed by user category preferences
          return null;
        },
      };

      const handlers = createDefaultStepHandlers({
        notificationService: fakeNotificationService as never,
      });

      const step: StepDefinition = {
        id: 'step_notify_muted',
        name: 'Notify Muted',
        type: 'NOTIFY',
        isSkippable: false,
        config: { title: 'Marketing campaign notification' },
      };

      const result = await handlers.NOTIFY.execute(makeContext(step));

      expect(result.status).toBe('SUCCEEDED');
      expect(result.outputSnapshot?.notificationSent).toBe(false);
      expect(result.outputSnapshot?.suppressedByPreferences).toBe(true);
    });

    it('TEST-WFA-STP-018 fails permanently when title is missing', async () => {
      const handlers = createDefaultStepHandlers();
      const step: StepDefinition = {
        id: 'step_notify_empty',
        name: 'Notify Empty',
        type: 'NOTIFY',
        isSkippable: false,
        config: { title: '' },
      };

      const result = await handlers.NOTIFY.execute(makeContext(step));

      expect(result.status).toBe('FAILED');
      expect(result.error?.code).toBe('NOTIFICATION_TITLE_MISSING');
      expect(result.error?.classification).toBe('PERMANENT');
    });

    it('TEST-WFA-STP-019 in dry-run mode, never dispatches real notifications', async () => {
      let dispatched = false;
      const fakeNotificationService = {
        async createNotification() {
          dispatched = true;
          return { id: 'ntf_live' };
        },
      };

      const handlers = createDefaultStepHandlers({
        notificationService: fakeNotificationService as never,
      });

      const step: StepDefinition = {
        id: 'step_notify_dry',
        name: 'Notify Dry Run',
        type: 'NOTIFY',
        isSkippable: false,
        config: { title: 'Important Alert' },
      };

      const result = await handlers.NOTIFY.execute(makeContext(step, { dryRun: true }));

      expect(result.status).toBe('SUCCEEDED');
      expect(result.outputSnapshot?.dryRun).toBe(true);
      expect(result.outputSnapshot?.notificationSent).toBe(false);
      expect(dispatched).toBe(false);
    });
  });

  // ===========================================================================
  // 6. END
  // ===========================================================================
  describe('END Handler', () => {
    it('TEST-WFA-STP-020 marks step terminal with configured outcomeStatus', async () => {
      const handlers = createDefaultStepHandlers();

      const stepSucceeded: StepDefinition = {
        id: 'step_finish_success',
        name: 'Finish Success',
        type: 'END',
        isSkippable: false,
        config: { outcomeStatus: 'SUCCEEDED' },
      };
      const resSuccess = await handlers.END.execute(makeContext(stepSucceeded));
      expect(resSuccess.status).toBe('SUCCEEDED');
      expect(resSuccess.outputSnapshot?.isTerminal).toBe(true);
      expect(resSuccess.outputSnapshot?.outcomeStatus).toBe('SUCCEEDED');

      const stepFailed: StepDefinition = {
        id: 'step_finish_failed',
        name: 'Finish Failed',
        type: 'END',
        isSkippable: false,
        config: { outcomeStatus: 'FAILED' },
      };
      const resFailed = await handlers.END.execute(makeContext(stepFailed));
      expect(resFailed.status).toBe('SUCCEEDED');
      expect(resFailed.outputSnapshot?.isTerminal).toBe(true);
      expect(resFailed.outputSnapshot?.outcomeStatus).toBe('FAILED');
    });
  });

  // ===========================================================================
  // 7. Safety Invariants & Later-Release Handlers
  // ===========================================================================
  describe('Safety Invariants & Allowlist Controls', () => {
    it('TEST-WFA-STP-021 UPDATE_FIELD strictly rejects prohibited fields to safeguard domain invariants', async () => {
      const handlers = createDefaultStepHandlers();

      const prohibited = ['state', 'status', 'payout', 'financial', 'pan', 'consent'];
      for (const field of prohibited) {
        const step: StepDefinition = {
          id: `step_update_${field}`,
          name: `Update ${field}`,
          type: 'UPDATE_FIELD',
          isSkippable: false,
          config: { field, value: 'DISBURSED' },
        };

        const result = await handlers.UPDATE_FIELD.execute(makeContext(step));
        expect(result.status).toBe('FAILED');
        expect(result.error?.code).toBe('PROHIBITED_FIELD_UPDATE');
        expect(result.error?.classification).toBe('PERMANENT');
      }
    });

    it('TEST-WFA-STP-022 UPDATE_FIELD accepts permitted safe fields (tags, notes, priority)', async () => {
      const handlers = createDefaultStepHandlers();

      const permitted = ['tags', 'notes', 'priority', 'custom_metadata', 'assigned_team'];
      for (const field of permitted) {
        const step: StepDefinition = {
          id: `step_update_safe_${field}`,
          name: `Update ${field}`,
          type: 'UPDATE_FIELD',
          isSkippable: false,
          config: { field, value: 'SAFE_VALUE' },
        };

        const result = await handlers.UPDATE_FIELD.execute(makeContext(step));
        expect(result.status).toBe('SUCCEEDED');
        expect(result.outputSnapshot?.updatedField).toBe(field);
      }
    });

    it('TEST-WFA-STP-023 CALL_WEBHOOK and SEND_TEMPLATE_MESSAGE produce zero external side effects in dry-run mode', async () => {
      const handlers = createDefaultStepHandlers();

      // Webhook dry run
      const webhookStep: StepDefinition = {
        id: 'step_webhook_dry',
        name: 'Webhook Dry',
        type: 'CALL_WEBHOOK',
        isSkippable: false,
        config: { url: 'https://thirdparty.partner.com/api' },
      };
      const webRes = await handlers.CALL_WEBHOOK.execute(makeContext(webhookStep, { dryRun: true }));
      expect(webRes.status).toBe('SUCCEEDED');
      expect(webRes.outputSnapshot?.webhookExecuted).toBe(false);
      expect(webRes.outputSnapshot?.dryRun).toBe(true);

      // Template message dry run
      const msgStep: StepDefinition = {
        id: 'step_msg_dry',
        name: 'Message Dry',
        type: 'SEND_TEMPLATE_MESSAGE',
        isSkippable: false,
        config: { templateCode: 'TPL_LEAD_WELCOME', channel: 'SMS' },
      };
      const msgRes = await handlers.SEND_TEMPLATE_MESSAGE.execute(makeContext(msgStep, { dryRun: true }));
      expect(msgRes.status).toBe('SUCCEEDED');
      expect(msgRes.outputSnapshot?.dispatched).toBe(false);
      expect(msgRes.outputSnapshot?.dryRun).toBe(true);
    });
  });
});
