// packages/contracts/src/automation.spec.ts — owner: Dev 1 / Dev 6
import { describe, expect, it } from 'vitest';
import {
  IdSchema,
  ID_PREFIXES,
  PERMISSION_CODES,
  TriggerConfigSchema,
  StepDefinitionSchema,
  CreateAutomationDefinitionSchema,
  CreateAutomationVersionSchema,
  ALLOWED_UPDATE_FIELDS,
  PROHIBITED_UPDATE_FIELDS,
  AutomationExecutionSchema,
  AutomationStepExecutionSchema,
  DeadLetterRecordSchema,
  ScheduledTriggerSchema,
  SkipStepSchema,
  ReviewVersionActionSchema,
  ExecuteAutomationSchema,
} from './index';

describe('Module 24: Workflow Automation (MOD-WFA) Contracts & Schemas', () => {
  it('TEST-WFA-CTR-001 includes all WFA ID prefixes in ID_PREFIXES and validates format', () => {
    const requiredPrefixes = ['wfd', 'wfv', 'wfe', 'wfse', 'wft', 'wfdl'] as const;
    for (const prefix of requiredPrefixes) {
      expect(ID_PREFIXES).toContain(prefix);
      const schema = IdSchema(prefix);
      // Valid ULID format with prefix (Crockford Base32 without I, L, O, U)
      const validId = `${prefix}_01ARZ3NDEKTSV4RRFFQ69G5FAV`;
      expect(schema.safeParse(validId).success).toBe(true);

      // Invalid prefix
      expect(schema.safeParse(`wrong_${validId.substring(4)}`).success).toBe(false);
      // Malformed ULID
      expect(schema.safeParse(`${prefix}_invalid-ulid-too-short`).success).toBe(false);
    }
  });

  it('TEST-WFA-CTR-002 includes all required automation permission codes', () => {
    const expectedPermissions = [
      'automation.read',
      'automation.author',
      'automation.approve',
      'automation.execute',
      'automation.operator',
    ] as const;

    for (const perm of expectedPermissions) {
      expect(PERMISSION_CODES).toContain(perm);
    }
  });

  it('TEST-WFA-CTR-003 validates event and schedule trigger configurations', () => {
    // Valid Event trigger
    const validEventTrigger = {
      eventType: 'lead.created',
      filters: [
        { field: 'source', op: 'EQ', value: 'WEBSITE' },
        { field: 'channel', op: 'IN', value: ['DIRECT', 'PARTNER'] },
      ],
    };
    expect(TriggerConfigSchema.safeParse(validEventTrigger).success).toBe(true);

    // Valid Schedule trigger
    const validScheduleTrigger = {
      cronExpression: '0 9 * * 1', // At 09:00 on Monday
      filters: [],
    };
    expect(TriggerConfigSchema.safeParse(validScheduleTrigger).success).toBe(true);

    // Invalid cron
    const invalidSchedule = {
      cronExpression: 'not-a-cron',
    };
    expect(TriggerConfigSchema.safeParse(invalidSchedule).success).toBe(false);
  });

  it('TEST-WFA-CTR-004 validates R1 step definitions', () => {
    // EVALUATE_DECISION
    const decisionStep = {
      id: 'step_eval_1',
      name: 'Evaluate Eligibility',
      type: 'EVALUATE_DECISION',
      isSkippable: false,
      config: {
        decisionKey: 'DK-lead.duplicate',
        factsMapping: { leadId: 'subject.id' },
      },
    };
    expect(StepDefinitionSchema.safeParse(decisionStep).success).toBe(true);

    // BRANCH
    const branchStep = {
      id: 'step_branch_1',
      name: 'Route by Score',
      type: 'BRANCH',
      isSkippable: false,
      config: {
        conditions: [
          { if: { field: 'score', op: 'EQ', value: 100 }, goToStepIndex: 3 },
        ],
        defaultStepIndex: 2,
      },
    };
    expect(StepDefinitionSchema.safeParse(branchStep).success).toBe(true);

    // CREATE_TASK
    const taskStep = {
      id: 'step_task_1',
      name: 'Create First Contact Task',
      type: 'CREATE_TASK',
      isSkippable: false,
      config: {
        title: 'Initial Lead Follow-up',
        ownerType: 'QUEUE',
      },
    };
    expect(StepDefinitionSchema.safeParse(taskStep).success).toBe(true);

    // END
    const endStep = {
      id: 'step_end_1',
      name: 'Finish Flow',
      type: 'END',
      isSkippable: false,
      config: {
        outcomeStatus: 'SUCCEEDED',
      },
    };
    expect(StepDefinitionSchema.safeParse(endStep).success).toBe(true);
  });

  it('TEST-WFA-CTR-005 enforces UPDATE_FIELD allow-list and rejects prohibited domain fields', () => {
    // Allowed fields
    for (const allowedField of ALLOWED_UPDATE_FIELDS) {
      const validUpdate = {
        id: 'step_update_ok',
        name: `Update ${allowedField}`,
        type: 'UPDATE_FIELD',
        isSkippable: false,
        config: {
          field: allowedField,
          value: 'VIP_CUSTOMER',
        },
      };
      expect(StepDefinitionSchema.safeParse(validUpdate).success).toBe(true);
    }

    // Prohibited fields (e.g. state transitions, financials, payout, consent)
    for (const prohibited of PROHIBITED_UPDATE_FIELDS) {
      const invalidUpdate = {
        id: 'step_update_prohibited',
        name: `Illegal Update ${prohibited}`,
        type: 'UPDATE_FIELD',
        isSkippable: false,
        config: {
          field: prohibited,
          value: 'SANCTIONED',
        },
      };
      const parsed = StepDefinitionSchema.safeParse(invalidUpdate);
      expect(parsed.success).toBe(false);
    }
  });

  it('TEST-WFA-CTR-006 validates SEND_TEMPLATE_MESSAGE step requirements', () => {
    const validMsg = {
      id: 'step_msg_1',
      name: 'Send Welcome WhatsApp',
      type: 'SEND_TEMPLATE_MESSAGE',
      isSkippable: true,
      config: {
        channel: 'WHATSAPP',
        templateCode: 'lead_welcome_v1',
      },
    };
    expect(StepDefinitionSchema.safeParse(validMsg).success).toBe(true);

    // Missing templateCode
    const missingTemplate = {
      id: 'step_msg_invalid',
      name: 'Send Missing Template',
      type: 'SEND_TEMPLATE_MESSAGE',
      isSkippable: true,
      config: {
        channel: 'EMAIL',
      },
    };
    expect(StepDefinitionSchema.safeParse(missingTemplate).success).toBe(false);
  });

  it('TEST-WFA-CTR-007 validates automation definition and version schemas', () => {
    const validDef = {
      code: 'lead_routing_v1',
      name: 'Lead Routing Pipeline',
      description: 'Automatically assigns incoming leads and triggers first contact',
      triggerType: 'EVENT',
      entityType: 'LEAD',
    };
    expect(CreateAutomationDefinitionSchema.safeParse(validDef).success).toBe(true);

    const validVersion = {
      triggerConfig: {
        eventType: 'lead.created',
      },
      steps: [
        {
          id: 'step_1',
          name: 'First step',
          type: 'NOTIFY',
          isSkippable: false,
          config: { title: 'Welcome', deepLink: '/leads' },
        },
      ],
      changeReason: 'Initial implementation of automated lead intake',
    };
    expect(CreateAutomationVersionSchema.safeParse(validVersion).success).toBe(true);
  });

  it('TEST-WFA-CTR-008 validates execution and step execution schemas', () => {
    const validExecution = {
      id: 'wfe_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      tenantId: 'tenant_test',
      definitionId: 'wfd_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      versionId: 'wfv_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      triggerType: 'EVENT',
      subjectType: 'LEAD',
      subjectId: 'lead_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      status: 'RUNNING',
      currentStepIndex: 1,
      context: { foo: 'bar' },
      dryRun: false,
      correlationId: 'corr_12345',
      chainDepth: 2,
      idempotencyKey: 'idem-exec-01ARZ3NDEK',
      createdAt: '2026-10-14T00:00:00.000Z',
      updatedAt: '2026-10-14T00:00:00.000Z',
    };
    expect(AutomationExecutionSchema.safeParse(validExecution).success).toBe(true);

    // Reject chain depth > 3
    expect(
      AutomationExecutionSchema.safeParse({
        ...validExecution,
        chainDepth: 4,
      }).success,
    ).toBe(false);

    // Step Execution
    const validStepExec = {
      id: 'wfse_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      tenantId: 'tenant_test',
      executionId: 'wfe_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      stepIndex: 0,
      stepId: 'step_1',
      stepType: 'NOTIFY',
      status: 'SUCCEEDED',
      attempts: 1,
      idempotencyKey: 'idem-step-01ARZ3NDEK',
      createdAt: '2026-10-14T00:00:00.000Z',
    };
    expect(AutomationStepExecutionSchema.safeParse(validStepExec).success).toBe(true);
  });

  it('TEST-WFA-CTR-009 validates scheduled triggers and dead-letter records', () => {
    const validTrigger = {
      id: 'wft_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      tenantId: 'tenant_test',
      definitionId: 'wfd_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      versionId: 'wfv_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      cronExpression: '0 0 * * *',
      nextRunAt: '2026-10-15T00:00:00.000Z',
      status: 'ACTIVE',
      payload: {},
      createdAt: '2026-10-14T00:00:00.000Z',
    };
    expect(ScheduledTriggerSchema.safeParse(validTrigger).success).toBe(true);

    const validDeadLetter = {
      id: 'wfdl_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      tenantId: 'tenant_test',
      executionId: 'wfe_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      stepExecutionId: 'wfse_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      reason: 'Max retries exhausted for webhook endpoint',
      errorDetails: { httpStatus: 504 },
      resolutionStatus: 'OPEN',
      createdAt: '2026-10-14T00:00:00.000Z',
    };
    expect(DeadLetterRecordSchema.safeParse(validDeadLetter).success).toBe(true);
  });

  it('TEST-WFA-CTR-010 validates API inputs for review, execution, and step skips', () => {
    // Review Version
    expect(
      ReviewVersionActionSchema.safeParse({ action: 'APPROVE', reason: 'Reviewed and safe' }).success,
    ).toBe(true);
    expect(ReviewVersionActionSchema.safeParse({ action: 'INVALID_ACTION' }).success).toBe(false);

    // Execute Automation
    expect(
      ExecuteAutomationSchema.safeParse({
        subjectType: 'LEAD',
        subjectId: 'lead_123',
        dryRun: true,
      }).success,
    ).toBe(true);

    // Skip Step requires a meaningful audit reason (>= 5 chars)
    expect(SkipStepSchema.safeParse({ reason: 'Approved by risk ops' }).success).toBe(true);
    expect(SkipStepSchema.safeParse({ reason: 'no' }).success).toBe(false);
  });
});

