// apps/api/src/modules/automation/types.ts — owner: Dev 1 / Dev 6 (MOD-WFA)
import type {
  AuditPort,
  AutomationExecution,
  AutomationStepExecution,
  DeadLetterRecord,
  DecisionPort,
  ErrorClassification,
  ExecutionStatus,
  IdGenerator,
  OutboxPort,
  RequestContext,
  StepDefinition,
  StepExecutionStatus,
  TaskPort,
  TriggerType,
  Tx,
  TxRunner,
  UserDirectoryPort,
  WfaEntityType,
} from '@dsa/contracts';

export interface WorkerLeaseConfig {
  workerId: string;
  leaseDurationMs: number; // default: 60,000ms (60s)
  heartbeatIntervalMs: number; // default: 10,000ms (10s)
  maxStepTimeoutMs: number; // default: 30,000ms (30s)
  maxExecutionLifetimeMs: number; // default: 86,400,000ms (24h)
}

export interface RetryPolicyConfig {
  delaysMs: readonly number[]; // default: [60_000, 300_000, 1_800_000, 7_200_000] (1m, 5m, 30m, 2h)
  maxAttempts: number; // default: 4
  jitterFraction: number; // default: 0.1 (+/- 10%)
}

export interface CreateExecutionParams {
  tenantId: string;
  definitionId: string;
  versionId: string;
  triggerType: TriggerType;
  triggerEventId?: string | null;
  subjectType: WfaEntityType;
  subjectId: string;
  context?: Record<string, unknown>;
  idempotencyKey?: string | null;
  correlationId: string;
  causationId?: string | null;
  chainDepth?: number;
  dryRun?: boolean;
}

export interface StepExecutionContext {
  tenantId: string;
  executionId: string;
  stepIndex: number;
  step: StepDefinition;
  context: Record<string, unknown>;
  subjectType: WfaEntityType;
  subjectId: string;
  dryRun: boolean;
  correlationId: string;
  attempts: number;
  requestCtx?: RequestContext;
  tx?: Tx;
}

export interface StepExecutionResult {
  status: StepExecutionStatus | 'WAITING';
  outputSnapshot?: Record<string, unknown>;
  nextStepIndex?: number;
  error?: {
    code: string;
    message: string;
    classification: ErrorClassification;
    retryAfterMs?: number;
  };
  waitConfig?: {
    untilIso?: string;
    durationMs?: number;
    reason?: string;
  };
}

export interface StepHandler {
  execute(ctx: StepExecutionContext): Promise<StepExecutionResult>;
}

export interface StepHandlerDependencies {
  txRunner?: TxRunner;
  decisionPort?: DecisionPort;
  taskPort?: TaskPort;
  userDirectoryPort?: UserDirectoryPort;
  auditPort?: AuditPort;
}

export interface AutomationEngineDependencies {
  txRunner: TxRunner;
  ids: IdGenerator;
  auditPort?: AuditPort;
  outboxPort?: OutboxPort;
  decisionPort?: DecisionPort;
  taskPort?: TaskPort;
  userDirectoryPort?: UserDirectoryPort;
  workerConfig?: Partial<WorkerLeaseConfig>;
  retryConfig?: Partial<RetryPolicyConfig>;
  handlers?: Partial<Record<string, StepHandler>>;
}

