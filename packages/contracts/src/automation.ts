// packages/contracts/src/automation.ts — owner: Dev 1 / Dev 6 (Module 24: Workflow Automation MOD-WFA)
import { z } from 'zod';
import { IdSchema } from './ids';
import { DOMAIN_EVENT_TYPES } from './events';
import { MESSAGE_CHANNELS } from './messaging';

// ---------------------------------------------------------------------------
// Trigger Types & Entities
// ---------------------------------------------------------------------------
export const TRIGGER_TYPES = ['EVENT', 'SCHEDULE', 'TIMER', 'WATCH', 'MANUAL'] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];
export const TriggerTypeSchema = z.enum(TRIGGER_TYPES);

export const WFA_ENTITY_TYPES = [
  'LEAD',
  'CUSTOMER',
  'LOAN_APPLICATION',
  'LENDER_CASE',
  'TASK',
  'VERIFICATION',
  'SYSTEM',
] as const;
export type WfaEntityType = (typeof WFA_ENTITY_TYPES)[number];
export const WfaEntityTypeSchema = z.enum(WFA_ENTITY_TYPES);

// ---------------------------------------------------------------------------
// Trigger Filters (Simple Equality / In-List Model — No custom scripting)
// ---------------------------------------------------------------------------
export const FILTER_OPERATORS = ['EQ', 'NEQ', 'IN', 'NOT_IN'] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];
export const FilterOperatorSchema = z.enum(FILTER_OPERATORS);

export const TriggerFilterSchema = z.object({
  field: z.string().min(1).max(100),
  op: FilterOperatorSchema,
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]),
});
export type TriggerFilter = z.infer<typeof TriggerFilterSchema>;

export const TriggerConfigSchema = z.object({
  eventType: z.enum(DOMAIN_EVENT_TYPES).optional(),
  cronExpression: z
    .string()
    .regex(
      /^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/([1-9]|1[0-9]|2[0-9]|3[0-1])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))$/,
      'Invalid cron expression',
    )
    .optional(),
  delayMs: z.number().int().nonnegative().optional(),
  targetDateField: z.string().max(100).optional(),
  targetState: z.string().max(50).optional(),
  timeoutHours: z.number().int().positive().max(720).optional(),
  filters: z.array(TriggerFilterSchema).default([]),
});
export type TriggerConfig = z.infer<typeof TriggerConfigSchema>;

// ---------------------------------------------------------------------------
// Step Catalogue (R1 - R4)
// ---------------------------------------------------------------------------
export const STEP_TYPES = [
  // R1 Core
  'EVALUATE_DECISION',
  'BRANCH',
  'CREATE_TASK',
  'ASSIGN_OWNER',
  'NOTIFY',
  'END',
  // R2 Communication & Safe Field Updates
  'SEND_TEMPLATE_MESSAGE',
  'WAIT',
  'UPDATE_FIELD',
  // R3 Human Approval
  'REQUEST_APPROVAL',
  // R4 Webhooks
  'CALL_WEBHOOK',
] as const;
export type StepType = (typeof STEP_TYPES)[number];
export const StepTypeSchema = z.enum(STEP_TYPES);

// Strict allow-list of fields that WFA is permitted to update (rejects state, financial, consent, etc.)
export const ALLOWED_UPDATE_FIELDS = [
  'tags',
  'notes',
  'priority',
  'custom_metadata',
  'assigned_team',
] as const;
export type AllowedUpdateField = (typeof ALLOWED_UPDATE_FIELDS)[number];
export const AllowedUpdateFieldSchema = z.enum(ALLOWED_UPDATE_FIELDS);

// Prohibited fields for UPDATE_FIELD to safeguard domain invariants
export const PROHIBITED_UPDATE_FIELDS = [
  'state',
  'status',
  'lead_state',
  'application_state',
  'lender_case_state',
  'payout',
  'payout_amount',
  'financial',
  'consent',
  'pan',
  'aadhaar',
  'account_number',
] as const;

export const StepBranchConditionSchema = z.object({
  if: z.object({
    field: z.string().min(1).max(100),
    op: FilterOperatorSchema,
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]),
  }),
  goToStepIndex: z.number().int().nonnegative(),
});
export type StepBranchCondition = z.infer<typeof StepBranchConditionSchema>;

export const StepDefinitionSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9_-]+$/, 'Step ID must be alphanumeric with _ or -'),
    name: z.string().min(1).max(200),
    type: StepTypeSchema,
    isSkippable: z.boolean().default(false),
    config: z.record(z.unknown()),
  })
  .superRefine((step, ctx) => {
    // Validate step-specific configuration rules
    if (step.type === 'EVALUATE_DECISION') {
      if (!step.config.decisionKey || typeof step.config.decisionKey !== 'string') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['config', 'decisionKey'],
          message: 'EVALUATE_DECISION step requires a valid decisionKey',
        });
      }
    } else if (step.type === 'BRANCH') {
      if (!Array.isArray(step.config.conditions) || typeof step.config.defaultStepIndex !== 'number') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['config'],
          message: 'BRANCH step requires conditions array and defaultStepIndex',
        });
      }
    } else if (step.type === 'CREATE_TASK') {
      if (!step.config.title || typeof step.config.title !== 'string') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['config', 'title'],
          message: 'CREATE_TASK step requires title',
        });
      }
    } else if (step.type === 'UPDATE_FIELD') {
      const field = String(step.config.field || '');
      if (!field || !(ALLOWED_UPDATE_FIELDS as readonly string[]).includes(field)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['config', 'field'],
          message: `UPDATE_FIELD step field '${field}' is not in the allowed list: ${ALLOWED_UPDATE_FIELDS.join(', ')}`,
        });
      }
      if ((PROHIBITED_UPDATE_FIELDS as readonly string[]).includes(field.toLowerCase())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['config', 'field'],
          message: `Field '${field}' is strictly prohibited from direct automation mutation`,
        });
      }
    } else if (step.type === 'SEND_TEMPLATE_MESSAGE') {
      if (!step.config.templateCode || typeof step.config.templateCode !== 'string') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['config', 'templateCode'],
          message: 'SEND_TEMPLATE_MESSAGE step requires templateCode',
        });
      }
      if (
        !step.config.channel ||
        !(MESSAGE_CHANNELS as readonly string[]).includes(String(step.config.channel))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['config', 'channel'],
          message: `SEND_TEMPLATE_MESSAGE step requires valid channel (${MESSAGE_CHANNELS.join(', ')})`,
        });
      }
    }
  });
export type StepDefinition = z.infer<typeof StepDefinitionSchema>;

// ---------------------------------------------------------------------------
// Execution Statuses & Error Classifications
// ---------------------------------------------------------------------------
export const EXECUTION_STATUSES = [
  'PENDING',
  'RUNNING',
  'WAITING',
  'RETRYING',
  'SUCCEEDED',
  'FAILED',
  'DEAD_LETTERED',
  'CANCELLED',
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];
export const ExecutionStatusSchema = z.enum(EXECUTION_STATUSES);

export const STEP_EXECUTION_STATUSES = ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED'] as const;
export type StepExecutionStatus = (typeof STEP_EXECUTION_STATUSES)[number];
export const StepExecutionStatusSchema = z.enum(STEP_EXECUTION_STATUSES);

export const ERROR_CLASSIFICATIONS = ['RETRYABLE', 'PERMANENT', 'AMBIGUOUS'] as const;
export type ErrorClassification = (typeof ERROR_CLASSIFICATIONS)[number];
export const ErrorClassificationSchema = z.enum(ERROR_CLASSIFICATIONS);

export const DEFINITION_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
export type DefinitionStatus = (typeof DEFINITION_STATUSES)[number];
export const DefinitionStatusSchema = z.enum(DEFINITION_STATUSES);

export const VERSION_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'ACTIVE',
  'SUPERSEDED',
  'REJECTED',
  'RETIRED',
] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];
export const VersionStatusSchema = z.enum(VERSION_STATUSES);

// ---------------------------------------------------------------------------
// Entity DTO Schemas
// ---------------------------------------------------------------------------
export const AutomationDefinitionSchema = z.object({
  id: IdSchema('wfd'),
  tenantId: z.string(),
  code: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9_-]+$/),
  name: z.string().min(3).max(200),
  description: z.string().nullable().optional(),
  triggerType: TriggerTypeSchema,
  entityType: WfaEntityTypeSchema,
  status: DefinitionStatusSchema,
  isSystem: z.boolean().default(false),
  pinnedVersionId: IdSchema('wfv').nullable().optional(),
  lockVersion: z.number().int().nonnegative(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedBy: z.string(),
  updatedAt: z.string(),
});
export type AutomationDefinition = z.infer<typeof AutomationDefinitionSchema>;

export const AutomationVersionSchema = z.object({
  id: IdSchema('wfv'),
  tenantId: z.string(),
  definitionId: IdSchema('wfd'),
  versionNo: z.number().int().positive(),
  status: VersionStatusSchema,
  triggerConfig: TriggerConfigSchema,
  steps: z.array(StepDefinitionSchema).min(1, 'At least one step is required'),
  contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  authorId: z.string(),
  submittedBy: z.string().nullable().optional(),
  submittedAt: z.string().nullable().optional(),
  approvedBy: z.string().nullable().optional(),
  approvedAt: z.string().nullable().optional(),
  rejectionReason: z.string().nullable().optional(),
  lockVersion: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type AutomationVersion = z.infer<typeof AutomationVersionSchema>;

export const AutomationExecutionSchema = z.object({
  id: IdSchema('wfe'),
  tenantId: z.string(),
  definitionId: IdSchema('wfd'),
  versionId: IdSchema('wfv'),
  triggerType: TriggerTypeSchema,
  triggerEventId: z.string().nullable().optional(),
  subjectType: WfaEntityTypeSchema,
  subjectId: z.string(),
  status: ExecutionStatusSchema,
  currentStepIndex: z.number().int().nonnegative(),
  context: z.record(z.unknown()),
  dryRun: z.boolean().default(false),
  workerId: z.string().nullable().optional(),
  leaseExpiresAt: z.string().nullable().optional(),
  errorCode: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  idempotencyKey: z
    .string()
    .regex(/^[A-Za-z0-9_:-]{8,256}$/)
    .nullable()
    .optional(),
  correlationId: z.string(),
  causationId: z.string().nullable().optional(),
  chainDepth: z.number().int().min(0).max(3),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AutomationExecution = z.infer<typeof AutomationExecutionSchema>;

export const AutomationStepExecutionSchema = z.object({
  id: IdSchema('wfse'),
  tenantId: z.string(),
  executionId: IdSchema('wfe'),
  stepIndex: z.number().int().nonnegative(),
  stepId: z.string(),
  stepType: StepTypeSchema,
  status: StepExecutionStatusSchema,
  inputSnapshot: z.record(z.unknown()).nullable().optional(),
  outputSnapshot: z.record(z.unknown()).nullable().optional(),
  errorCode: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  errorClassification: ErrorClassificationSchema.nullable().optional(),
  attempts: z.number().int().nonnegative(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_:-]{8,256}$/),
  skipReason: z.string().nullable().optional(),
  skippedBy: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type AutomationStepExecution = z.infer<typeof AutomationStepExecutionSchema>;

export const ScheduledTriggerSchema = z.object({
  id: IdSchema('wft'),
  tenantId: z.string(),
  definitionId: IdSchema('wfd'),
  versionId: IdSchema('wfv'),
  cronExpression: z.string().nullable().optional(),
  nextRunAt: z.string(),
  lastRunAt: z.string().nullable().optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'EXHAUSTED']),
  payload: z.record(z.unknown()),
  createdAt: z.string(),
});
export type ScheduledTrigger = z.infer<typeof ScheduledTriggerSchema>;

export const DeadLetterRecordSchema = z.object({
  id: IdSchema('wfdl'),
  tenantId: z.string(),
  executionId: IdSchema('wfe'),
  stepExecutionId: IdSchema('wfse'),
  reason: z.string(),
  errorDetails: z.record(z.unknown()),
  resolutionStatus: z.enum(['OPEN', 'RESOLVED', 'IGNORED']),
  resolvedBy: z.string().nullable().optional(),
  resolvedAt: z.string().nullable().optional(),
  resolutionAction: z.enum(['RETRY', 'SKIP', 'CANCEL']).nullable().optional(),
  createdAt: z.string(),
});
export type DeadLetterRecord = z.infer<typeof DeadLetterRecordSchema>;

// ---------------------------------------------------------------------------
// API Request & Response Schemas
// ---------------------------------------------------------------------------
export const CreateAutomationDefinitionSchema = z.object({
  code: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9_-]+$/),
  name: z.string().min(3).max(200),
  description: z.string().max(1000).optional(),
  triggerType: TriggerTypeSchema,
  entityType: WfaEntityTypeSchema,
});
export type CreateAutomationDefinitionInput = z.infer<typeof CreateAutomationDefinitionSchema>;

export const CreateAutomationVersionSchema = z.object({
  triggerConfig: TriggerConfigSchema,
  steps: z.array(StepDefinitionSchema).min(1),
  changeReason: z.string().max(500).optional(),
});
export type CreateAutomationVersionInput = z.infer<typeof CreateAutomationVersionSchema>;

export const ReviewVersionActionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().max(500).optional(),
});
export type ReviewVersionActionInput = z.infer<typeof ReviewVersionActionSchema>;

export const ExecuteAutomationSchema = z.object({
  subjectType: WfaEntityTypeSchema,
  subjectId: z.string().min(1),
  triggerPayload: z.record(z.unknown()).default({}),
  dryRun: z.boolean().default(false),
});
export type ExecuteAutomationInput = z.infer<typeof ExecuteAutomationSchema>;

export const SkipStepSchema = z.object({
  reason: z.string().min(5).max(500, 'A non-empty audit reason is mandatory to skip a step'),
});
export type SkipStepInput = z.infer<typeof SkipStepSchema>;
