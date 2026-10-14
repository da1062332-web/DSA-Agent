// apps/api/src/modules/automation/repository.ts — owner: Dev 1 / Dev 6 (MOD-WFA)
import {
  AppError,
  type AutomationDefinition,
  type AutomationExecution,
  type AutomationStepExecution,
  type AutomationVersion,
  type DeadLetterRecord,
  type ExecutionStatus,
  type StepDefinition,
  type Tx,
} from '@dsa/contracts';
import { sql } from 'kysely';

export interface RawExecutionRow {
  id: string;
  tenant_id: string;
  definition_id: string;
  version_id: string;
  trigger_type: string;
  trigger_event_id: string | null;
  subject_type: string;
  subject_id: string;
  status: string;
  current_step_index: number;
  context: unknown;
  dry_run: boolean;
  worker_id: string | null;
  lease_expires_at: string | Date | null;
  error_code: string | null;
  error_message: string | null;
  idempotency_key: string | null;
  correlation_id: string;
  causation_id: string | null;
  chain_depth: number;
  started_at: string | Date | null;
  completed_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface RawStepExecutionRow {
  id: string;
  tenant_id: string;
  execution_id: string;
  step_index: number;
  step_id: string;
  step_type: string;
  status: string;
  input_snapshot: unknown;
  output_snapshot: unknown;
  error_code: string | null;
  error_message: string | null;
  error_classification: string | null;
  attempts: number;
  idempotency_key: string;
  skip_reason: string | null;
  skipped_by: string | null;
  started_at: string | Date | null;
  completed_at: string | Date | null;
  created_at: string | Date;
}

export interface RawDeadLetterRow {
  id: string;
  tenant_id: string;
  execution_id: string;
  step_execution_id: string;
  reason: string;
  error_details: unknown;
  resolution_status: string;
  resolved_by: string | null;
  resolved_at: string | Date | null;
  resolution_action: string | null;
  created_at: string | Date;
}

export interface RawDefinitionRow {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  description: string | null;
  trigger_type: string;
  entity_type: string;
  status: string;
  is_system: boolean;
  pinned_version_id: string | null;
  lock_version: number;
  created_by: string;
  created_at: string | Date;
  updated_by: string;
  updated_at: string | Date;
}

export interface RawVersionRow {
  id: string;
  tenant_id: string;
  definition_id: string;
  version_no: number;
  status: string;
  trigger_config: unknown;
  steps: unknown;
  content_hash: string;
  author_id: string;
  submitted_by: string | null;
  submitted_at: string | Date | null;
  approved_by: string | null;
  approved_at: string | Date | null;
  rejection_reason: string | null;
  lock_version: number;
  created_at: string | Date;
}

export interface RawScheduledTriggerRow {
  id: string;
  tenant_id: string;
  definition_id: string;
  version_id: string;
  cron_expression: string | null;
  next_run_at: string | Date;
  last_run_at: string | Date | null;
  status: string;
  payload: unknown;
  created_at: string | Date;
}

export interface ScheduledTrigger {
  id: string;
  tenantId: string;
  definitionId: string;
  versionId: string;
  cronExpression: string | null;
  nextRunAt: string;
  lastRunAt: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'EXHAUSTED';
  payload: Record<string, unknown>;
  createdAt: string;
}

export function formatScheduledTrigger(row: RawScheduledTriggerRow): ScheduledTrigger {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    definitionId: row.definition_id,
    versionId: row.version_id,
    cronExpression: row.cron_expression ?? null,
    nextRunAt: row.next_run_at instanceof Date ? row.next_run_at.toISOString() : String(row.next_run_at),
    lastRunAt: row.last_run_at
      ? row.last_run_at instanceof Date
        ? row.last_run_at.toISOString()
        : String(row.last_run_at)
      : null,
    status: row.status as ScheduledTrigger['status'],
    payload: (typeof row.payload === 'object' && row.payload !== null
      ? row.payload
      : {}) as Record<string, unknown>,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export function formatDefinition(row: RawDefinitionRow): AutomationDefinition {
  return {
    id: row.id as AutomationDefinition['id'],
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    triggerType: row.trigger_type as AutomationDefinition['triggerType'],
    entityType: row.entity_type as AutomationDefinition['entityType'],
    status: row.status as AutomationDefinition['status'],
    isSystem: row.is_system,
    pinnedVersionId: (row.pinned_version_id as AutomationDefinition['pinnedVersionId']) ?? null,
    lockVersion: Number(row.lock_version ?? 0),
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
    updatedBy: row.updated_by,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function formatVersion(row: RawVersionRow): AutomationVersion {
  return {
    id: row.id as AutomationVersion['id'],
    tenantId: row.tenant_id,
    definitionId: row.definition_id as AutomationVersion['definitionId'],
    versionNo: Number(row.version_no),
    status: row.status as AutomationVersion['status'],
    triggerConfig: (typeof row.trigger_config === 'object' && row.trigger_config !== null
      ? row.trigger_config
      : {}) as AutomationVersion['triggerConfig'],
    steps: (Array.isArray(row.steps) ? row.steps : []) as StepDefinition[],
    contentHash: row.content_hash,
    authorId: row.author_id,
    submittedBy: row.submitted_by ?? null,
    submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    approvedBy: row.approved_by ?? null,
    approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
    rejectionReason: row.rejection_reason ?? null,
    lockVersion: Number(row.lock_version ?? 0),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export function formatExecution(row: RawExecutionRow): AutomationExecution {
  return {
    id: row.id as AutomationExecution['id'],
    tenantId: row.tenant_id,
    definitionId: row.definition_id as AutomationExecution['definitionId'],
    versionId: row.version_id as AutomationExecution['versionId'],
    triggerType: row.trigger_type as AutomationExecution['triggerType'],
    triggerEventId: row.trigger_event_id ?? null,
    subjectType: row.subject_type as AutomationExecution['subjectType'],
    subjectId: row.subject_id,
    status: row.status as AutomationExecution['status'],
    currentStepIndex: Number(row.current_step_index ?? 0),
    context: (typeof row.context === 'object' && row.context !== null ? row.context : {}) as Record<string, unknown>,
    dryRun: Boolean(row.dry_run),
    workerId: row.worker_id ?? null,
    leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at).toISOString() : null,
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    idempotencyKey: row.idempotency_key ?? null,
    correlationId: row.correlation_id,
    causationId: row.causation_id ?? null,
    chainDepth: Number(row.chain_depth ?? 0),
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function formatStepExecution(row: RawStepExecutionRow): AutomationStepExecution {
  return {
    id: row.id as AutomationStepExecution['id'],
    tenantId: row.tenant_id,
    executionId: row.execution_id as AutomationStepExecution['executionId'],
    stepIndex: Number(row.step_index),
    stepId: row.step_id,
    stepType: row.step_type as AutomationStepExecution['stepType'],
    status: row.status as AutomationStepExecution['status'],
    inputSnapshot: (row.input_snapshot as Record<string, unknown>) ?? null,
    outputSnapshot: (row.output_snapshot as Record<string, unknown>) ?? null,
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    errorClassification: (row.error_classification as AutomationStepExecution['errorClassification']) ?? null,
    attempts: Number(row.attempts ?? 0),
    idempotencyKey: row.idempotency_key,
    skipReason: row.skip_reason ?? null,
    skippedBy: row.skipped_by ?? null,
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export function formatDeadLetter(row: RawDeadLetterRow): DeadLetterRecord {
  return {
    id: row.id as DeadLetterRecord['id'],
    tenantId: row.tenant_id,
    executionId: row.execution_id as DeadLetterRecord['executionId'],
    stepExecutionId: row.step_execution_id as DeadLetterRecord['stepExecutionId'],
    reason: row.reason,
    errorDetails: (typeof row.error_details === 'object' && row.error_details !== null
      ? row.error_details
      : {}) as Record<string, unknown>,
    resolutionStatus: row.resolution_status as DeadLetterRecord['resolutionStatus'],
    resolvedBy: row.resolved_by ?? null,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
    resolutionAction: (row.resolution_action as DeadLetterRecord['resolutionAction']) ?? null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  };
}

export class AutomationRepository {
  /**
   * Retrieves definition and its pinned active version.
   * Scoped to caller tenantId OR system definitions (is_system = true).
   */
  async getDefinitionAndVersion(
    tx: Tx,
    tenantId: string,
    definitionId: string,
  ): Promise<{ definition: AutomationDefinition; version: AutomationVersion }> {
    const defRes = await sql<{
      id: string;
      tenant_id: string;
      code: string;
      name: string;
      description: string | null;
      trigger_type: string;
      entity_type: string;
      status: string;
      is_system: boolean;
      pinned_version_id: string | null;
      lock_version: number;
      created_by: string;
      created_at: string | Date;
      updated_by: string;
      updated_at: string | Date;
    }>`
      SELECT * FROM app.automation_definition
      WHERE id = ${definitionId}
        AND (tenant_id = ${tenantId} OR is_system = true)
    `.execute(tx);

    const defRow = defRes.rows[0];
    if (!defRow) {
      throw AppError.of('NOT_FOUND', `Automation definition '${definitionId}' not found.`);
    }

    const versionId = defRow.pinned_version_id;
    if (!versionId) {
      throw AppError.of(
        'INVALID_STATE',
        `Automation definition '${definitionId}' has no pinned active version.`,
      );
    }

    const verRes = await sql<{
      id: string;
      tenant_id: string;
      definition_id: string;
      version_no: number;
      status: string;
      trigger_config: unknown;
      steps: unknown;
      content_hash: string;
      author_id: string;
      submitted_by: string | null;
      submitted_at: string | Date | null;
      approved_by: string | null;
      approved_at: string | Date | null;
      rejection_reason: string | null;
      lock_version: number;
      created_at: string | Date;
    }>`
      SELECT * FROM app.automation_version
      WHERE id = ${versionId}
        AND (tenant_id = ${defRow.tenant_id} OR tenant_id = ${tenantId})
    `.execute(tx);

    const verRow = verRes.rows[0];
    if (!verRow) {
      throw AppError.of('NOT_FOUND', `Pinned automation version '${versionId}' not found.`);
    }

    return {
      definition: {
        id: defRow.id as AutomationDefinition['id'],
        tenantId: defRow.tenant_id,
        code: defRow.code,
        name: defRow.name,
        description: defRow.description ?? null,
        triggerType: defRow.trigger_type as AutomationDefinition['triggerType'],
        entityType: defRow.entity_type as AutomationDefinition['entityType'],
        status: defRow.status as AutomationDefinition['status'],
        isSystem: defRow.is_system,
        pinnedVersionId: (defRow.pinned_version_id as AutomationDefinition['pinnedVersionId']) ?? null,
        lockVersion: Number(defRow.lock_version ?? 0),
        createdBy: defRow.created_by,
        createdAt: new Date(defRow.created_at).toISOString(),
        updatedBy: defRow.updated_by,
        updatedAt: new Date(defRow.updated_at).toISOString(),
      },
      version: {
        id: verRow.id as AutomationVersion['id'],
        tenantId: verRow.tenant_id,
        definitionId: verRow.definition_id as AutomationVersion['definitionId'],
        versionNo: Number(verRow.version_no),
        status: verRow.status as AutomationVersion['status'],
        triggerConfig: verRow.trigger_config as AutomationVersion['triggerConfig'],
        steps: verRow.steps as StepDefinition[],
        contentHash: verRow.content_hash,
        authorId: verRow.author_id,
        submittedBy: verRow.submitted_by ?? null,
        submittedAt: verRow.submitted_at ? new Date(verRow.submitted_at).toISOString() : null,
        approvedBy: verRow.approved_by ?? null,
        approvedAt: verRow.approved_at ? new Date(verRow.approved_at).toISOString() : null,
        rejectionReason: verRow.rejection_reason ?? null,
        lockVersion: Number(verRow.lock_version ?? 0),
        createdAt: new Date(verRow.created_at).toISOString(),
      },
    };
  }

  /**
   * Finds execution by tenant and idempotency key for deduplication.
   */
  async findExecutionByIdempotencyKey(
    tx: Tx,
    tenantId: string,
    idempotencyKey: string,
  ): Promise<AutomationExecution | null> {
    const res = await sql<RawExecutionRow>`
      SELECT * FROM app.automation_execution
      WHERE tenant_id = ${tenantId}
        AND idempotency_key = ${idempotencyKey}
    `.execute(tx);

    const row = res.rows[0];
    return row ? formatExecution(row) : null;
  }

  /**
   * Inserts a new execution record.
   */
  async insertExecution(tx: Tx, exec: AutomationExecution): Promise<AutomationExecution> {
    const res = await sql<RawExecutionRow>`
      INSERT INTO app.automation_execution (
        id, tenant_id, definition_id, version_id, trigger_type, trigger_event_id,
        subject_type, subject_id, status, current_step_index, context, dry_run,
        worker_id, lease_expires_at, error_code, error_message, idempotency_key,
        correlation_id, causation_id, chain_depth, started_at, completed_at,
        created_at, updated_at
      ) VALUES (
        ${exec.id}, ${exec.tenantId}, ${exec.definitionId}, ${exec.versionId},
        ${exec.triggerType}, ${exec.triggerEventId ?? null}, ${exec.subjectType},
        ${exec.subjectId}, ${exec.status}, ${exec.currentStepIndex},
        ${JSON.stringify(exec.context)}::jsonb, ${exec.dryRun},
        ${exec.workerId ?? null}, ${exec.leaseExpiresAt ? new Date(exec.leaseExpiresAt) : null},
        ${exec.errorCode ?? null}, ${exec.errorMessage ?? null}, ${exec.idempotencyKey ?? null},
        ${exec.correlationId}, ${exec.causationId ?? null}, ${exec.chainDepth},
        ${exec.startedAt ? new Date(exec.startedAt) : null},
        ${exec.completedAt ? new Date(exec.completedAt) : null},
        ${new Date(exec.createdAt)}, ${new Date(exec.updatedAt)}
      )
      RETURNING *
    `.execute(tx);

    return formatExecution(res.rows[0]!);
  }

  /**
   * Retrieves an execution by id, strictly enforcing tenant isolation.
   */
  async getExecutionById(tx: Tx, tenantId: string, executionId: string): Promise<AutomationExecution> {
    const res = await sql<RawExecutionRow>`
      SELECT * FROM app.automation_execution
      WHERE id = ${executionId}
        AND tenant_id = ${tenantId}
    `.execute(tx);

    const row = res.rows[0];
    if (!row) {
      throw AppError.of('NOT_FOUND', `Automation execution '${executionId}' not found.`);
    }
    return formatExecution(row);
  }

  /**
   * Atomically claims or reclaims a worker lease on an execution.
   */
  async claimWorkerLease(
    tx: Tx,
    tenantId: string,
    executionId: string,
    workerId: string,
    leaseDurationMs: number,
  ): Promise<AutomationExecution | null> {
    const leaseExpires = new Date(Date.now() + leaseDurationMs);

    const res = await sql<RawExecutionRow>`
      UPDATE app.automation_execution
      SET status = 'RUNNING',
          worker_id = ${workerId},
          lease_expires_at = ${leaseExpires},
          started_at = COALESCE(started_at, now()),
          updated_at = now()
      WHERE id = ${executionId}
        AND tenant_id = ${tenantId}
        AND (
          status IN ('PENDING', 'RETRYING', 'WAITING')
          OR (status = 'RUNNING' AND (worker_id = ${workerId} OR lease_expires_at < now()))
        )
      RETURNING *
    `.execute(tx);

    const row = res.rows[0];
    return row ? formatExecution(row) : null;
  }

  /**
   * Heartbeat to extend active worker lease.
   */
  async extendWorkerLease(
    tx: Tx,
    tenantId: string,
    executionId: string,
    workerId: string,
    leaseDurationMs: number,
  ): Promise<boolean> {
    const newLeaseExpires = new Date(Date.now() + leaseDurationMs);

    const res = await sql<{ id: string }>`
      UPDATE app.automation_execution
      SET lease_expires_at = ${newLeaseExpires},
          updated_at = now()
      WHERE id = ${executionId}
        AND tenant_id = ${tenantId}
        AND worker_id = ${workerId}
        AND lease_expires_at >= now()
      RETURNING id
    `.execute(tx);

    return res.rows.length > 0;
  }

  /**
   * Updates execution state and progress, protecting against stale workers.
   */
  async updateExecutionProgress(
    tx: Tx,
    tenantId: string,
    executionId: string,
    workerId: string,
    update: {
      status: ExecutionStatus;
      currentStepIndex?: number;
      context?: Record<string, unknown>;
      errorCode?: string | null;
      errorMessage?: string | null;
      completedAt?: string | null;
    },
  ): Promise<AutomationExecution> {
    const completedAtDate = update.completedAt ? new Date(update.completedAt) : null;
    const contextJson = update.context !== undefined ? JSON.stringify(update.context) : null;

    const res = await sql<RawExecutionRow>`
      UPDATE app.automation_execution
      SET status = ${update.status},
          current_step_index = COALESCE(${update.currentStepIndex ?? null}, current_step_index),
          context = COALESCE(${contextJson}::jsonb, context),
          error_code = ${update.errorCode ?? null},
          error_message = ${update.errorMessage ?? null},
          completed_at = COALESCE(${completedAtDate}, completed_at),
          updated_at = now()
      WHERE id = ${executionId}
        AND tenant_id = ${tenantId}
        AND worker_id = ${workerId}
        AND (lease_expires_at >= now() OR ${update.status} IN ('SUCCEEDED', 'FAILED', 'DEAD_LETTERED', 'CANCELLED'))
      RETURNING *
    `.execute(tx);

    const row = res.rows[0];
    if (!row) {
      throw AppError.of(
        'VERSION_CONFLICT',
        `Worker '${workerId}' lost lease on execution '${executionId}' or lease expired. Progress update aborted.`,
      );
    }

    return formatExecution(row);
  }

  /**
   * Retrieves step execution record by execution id and step index.
   */
  async getStepExecution(
    tx: Tx,
    tenantId: string,
    executionId: string,
    stepIndex: number,
  ): Promise<AutomationStepExecution | null> {
    const res = await sql<RawStepExecutionRow>`
      SELECT * FROM app.automation_step_execution
      WHERE tenant_id = ${tenantId}
        AND execution_id = ${executionId}
        AND step_index = ${stepIndex}
    `.execute(tx);

    const row = res.rows[0];
    return row ? formatStepExecution(row) : null;
  }

  /**
   * Inserts a new step execution record.
   */
  async insertStepExecution(tx: Tx, step: AutomationStepExecution): Promise<AutomationStepExecution> {
    const res = await sql<RawStepExecutionRow>`
      INSERT INTO app.automation_step_execution (
        id, tenant_id, execution_id, step_index, step_id, step_type,
        status, input_snapshot, output_snapshot, error_code, error_message,
        error_classification, attempts, idempotency_key, skip_reason, skipped_by,
        started_at, completed_at, created_at
      ) VALUES (
        ${step.id}, ${step.tenantId}, ${step.executionId}, ${step.stepIndex},
        ${step.stepId}, ${step.stepType}, ${step.status},
        ${step.inputSnapshot ? JSON.stringify(step.inputSnapshot) : null}::jsonb,
        ${step.outputSnapshot ? JSON.stringify(step.outputSnapshot) : null}::jsonb,
        ${step.errorCode ?? null}, ${step.errorMessage ?? null},
        ${step.errorClassification ?? null}, ${step.attempts}, ${step.idempotencyKey},
        ${step.skipReason ?? null}, ${step.skippedBy ?? null},
        ${step.startedAt ? new Date(step.startedAt) : null},
        ${step.completedAt ? new Date(step.completedAt) : null},
        ${new Date(step.createdAt)}
      )
      RETURNING *
    `.execute(tx);

    return formatStepExecution(res.rows[0]!);
  }

  /**
   * Updates step execution record with attempt results.
   */
  async updateStepExecution(
    tx: Tx,
    tenantId: string,
    stepExecutionId: string,
    update: Partial<AutomationStepExecution>,
  ): Promise<AutomationStepExecution> {
    const res = await sql<RawStepExecutionRow>`
      UPDATE app.automation_step_execution
      SET status = COALESCE(${update.status ?? null}, status),
          output_snapshot = COALESCE(${update.outputSnapshot ? JSON.stringify(update.outputSnapshot) : null}::jsonb, output_snapshot),
          error_code = ${update.errorCode ?? null},
          error_message = ${update.errorMessage ?? null},
          error_classification = ${update.errorClassification ?? null},
          attempts = COALESCE(${update.attempts ?? null}, attempts),
          skip_reason = COALESCE(${update.skipReason ?? null}, skip_reason),
          skipped_by = COALESCE(${update.skippedBy ?? null}, skipped_by),
          started_at = COALESCE(${update.startedAt ? new Date(update.startedAt) : null}, started_at),
          completed_at = COALESCE(${update.completedAt ? new Date(update.completedAt) : null}, completed_at)
      WHERE id = ${stepExecutionId}
        AND tenant_id = ${tenantId}
      RETURNING *
    `.execute(tx);

    const row = res.rows[0];
    if (!row) {
      throw AppError.of('NOT_FOUND', `Step execution '${stepExecutionId}' not found.`);
    }
    return formatStepExecution(row);
  }

  /**
   * Records a dead letter entry.
   */
  async insertDeadLetter(tx: Tx, dl: DeadLetterRecord): Promise<DeadLetterRecord> {
    const res = await sql<RawDeadLetterRow>`
      INSERT INTO app.wfa_dead_letter (
        id, tenant_id, execution_id, step_execution_id, reason, error_details,
        resolution_status, resolved_by, resolved_at, resolution_action, created_at
      ) VALUES (
        ${dl.id}, ${dl.tenantId}, ${dl.executionId}, ${dl.stepExecutionId},
        ${dl.reason}, ${JSON.stringify(dl.errorDetails)}::jsonb,
        ${dl.resolutionStatus}, ${dl.resolvedBy ?? null},
        ${dl.resolvedAt ? new Date(dl.resolvedAt) : null},
        ${dl.resolutionAction ?? null}, ${new Date(dl.createdAt)}
      )
      RETURNING *
    `.execute(tx);

    return formatDeadLetter(res.rows[0]!);
  }

  /**
   * Retrieves dead letter record by id.
   */
  async getDeadLetterById(tx: Tx, tenantId: string, deadLetterId: string): Promise<DeadLetterRecord> {
    const res = await sql<RawDeadLetterRow>`
      SELECT * FROM app.wfa_dead_letter
      WHERE id = ${deadLetterId}
        AND tenant_id = ${tenantId}
    `.execute(tx);

    const row = res.rows[0];
    if (!row) {
      throw AppError.of('NOT_FOUND', `Dead letter record '${deadLetterId}' not found.`);
    }
    return formatDeadLetter(row);
  }

  /**
   * Resolves a dead letter record.
   */
  async resolveDeadLetter(
    tx: Tx,
    tenantId: string,
    deadLetterId: string,
    action: 'RETRY' | 'SKIP' | 'CANCEL',
    resolvedBy: string,
  ): Promise<DeadLetterRecord> {
    const res = await sql<RawDeadLetterRow>`
      UPDATE app.wfa_dead_letter
      SET resolution_status = 'RESOLVED',
          resolution_action = ${action},
          resolved_by = ${resolvedBy},
          resolved_at = now()
      WHERE id = ${deadLetterId}
        AND tenant_id = ${tenantId}
        AND resolution_status = 'OPEN'
      RETURNING *
    `.execute(tx);

    const row = res.rows[0];
    if (!row) {
      throw AppError.of(
        'INVALID_STATE',
        `Dead letter '${deadLetterId}' is already resolved or not found.`,
      );
    }
    return formatDeadLetter(row);
  }

  /**
   * Cancels an execution regardless of active worker lease.
   */
  async cancelExecution(
    tx: Tx,
    tenantId: string,
    executionId: string,
    reason?: string,
  ): Promise<AutomationExecution> {
    const res = await sql<RawExecutionRow>`
      UPDATE app.automation_execution
      SET status = 'CANCELLED',
          error_message = ${reason ?? 'Cancelled by operator'},
          completed_at = now(),
          updated_at = now()
      WHERE id = ${executionId}
        AND tenant_id = ${tenantId}
        AND status NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
      RETURNING *
    `.execute(tx);

    const row = res.rows[0];
    if (!row) {
      throw AppError.of(
        'INVALID_TRANSITION',
        `Execution '${executionId}' cannot be cancelled because it is in a terminal state or not found.`,
      );
    }
    return formatExecution(row);
  }

  /**
   * Applies operator state updates to dead-lettered or waiting executions.
   */
  async updateExecutionByOperator(
    tx: Tx,
    tenantId: string,
    executionId: string,
    update: {
      status: ExecutionStatus;
      currentStepIndex?: number;
      errorMessage?: string | null;
    },
  ): Promise<AutomationExecution> {
    const res = await sql<RawExecutionRow>`
      UPDATE app.automation_execution
      SET status = ${update.status},
          current_step_index = COALESCE(${update.currentStepIndex ?? null}, current_step_index),
          error_message = ${update.errorMessage ?? null},
          worker_id = NULL,
          lease_expires_at = NULL,
          updated_at = now()
      WHERE id = ${executionId}
        AND tenant_id = ${tenantId}
      RETURNING *
    `.execute(tx);

    const row = res.rows[0];
    if (!row) {
      throw AppError.of('NOT_FOUND', `Execution '${executionId}' not found.`);
    }
    return formatExecution(row);
  }

  /**
   * Lists automation definitions available to caller tenant (including system ones).
   */
  async listDefinitions(
    tx: Tx,
    tenantId: string,
    filter?: { status?: string; entityType?: string },
  ): Promise<AutomationDefinition[]> {
    let q = sql<RawDefinitionRow>`
      SELECT * FROM app.automation_definition
      WHERE (tenant_id = ${tenantId} OR is_system = true)
    `;
    if (filter?.status) {
      q = sql<RawDefinitionRow>`${q} AND status = ${filter.status}`;
    }
    if (filter?.entityType) {
      q = sql<RawDefinitionRow>`${q} AND entity_type = ${filter.entityType}`;
    }
    q = sql<RawDefinitionRow>`${q} ORDER BY created_at DESC`;
    const res = await q.execute(tx);
    return res.rows.map(formatDefinition);
  }

  /**
   * Retrieves an automation definition by id.
   */
  async getDefinitionById(
    tx: Tx,
    tenantId: string,
    definitionId: string,
  ): Promise<AutomationDefinition> {
    const res = await sql<RawDefinitionRow>`
      SELECT * FROM app.automation_definition
      WHERE id = ${definitionId}
        AND (tenant_id = ${tenantId} OR is_system = true)
    `.execute(tx);
    const row = res.rows[0];
    if (!row) {
      throw AppError.of('NOT_FOUND', `Automation definition '${definitionId}' not found.`);
    }
    return formatDefinition(row);
  }

  /**
   * Inserts a new automation definition.
   */
  async insertDefinition(tx: Tx, def: AutomationDefinition): Promise<AutomationDefinition> {
    const res = await sql<RawDefinitionRow>`
      INSERT INTO app.automation_definition (
        id, tenant_id, code, name, description, trigger_type, entity_type,
        status, is_system, pinned_version_id, lock_version, created_by,
        created_at, updated_by, updated_at
      ) VALUES (
        ${def.id}, ${def.tenantId}, ${def.code}, ${def.name},
        ${def.description ?? null}, ${def.triggerType}, ${def.entityType},
        ${def.status}, ${def.isSystem}, ${def.pinnedVersionId ?? null},
        ${def.lockVersion}, ${def.createdBy}, ${new Date(def.createdAt)},
        ${def.updatedBy}, ${new Date(def.updatedAt)}
      )
      RETURNING *
    `.execute(tx);
    return formatDefinition(res.rows[0]!);
  }

  /**
   * Updates an automation definition.
   */
  async updateDefinition(
    tx: Tx,
    tenantId: string,
    definitionId: string,
    update: {
      name?: string;
      description?: string | null;
      status?: AutomationDefinition['status'];
      pinnedVersionId?: string | null;
      updatedBy: string;
    },
  ): Promise<AutomationDefinition> {
    const res = await sql<RawDefinitionRow>`
      UPDATE app.automation_definition
      SET name = COALESCE(${update.name ?? null}, name),
          description = COALESCE(${update.description ?? null}, description),
          status = COALESCE(${update.status ?? null}, status),
          pinned_version_id = COALESCE(${update.pinnedVersionId ?? null}, pinned_version_id),
          updated_by = ${update.updatedBy},
          updated_at = now(),
          lock_version = lock_version + 1
      WHERE id = ${definitionId}
        AND tenant_id = ${tenantId}
      RETURNING *
    `.execute(tx);
    const row = res.rows[0];
    if (!row) {
      throw AppError.of('NOT_FOUND', `Automation definition '${definitionId}' not found.`);
    }
    return formatDefinition(row);
  }

  /**
   * Lists all versions of an automation definition.
   */
  async listVersions(
    tx: Tx,
    tenantId: string,
    definitionId: string,
  ): Promise<AutomationVersion[]> {
    const res = await sql<RawVersionRow>`
      SELECT * FROM app.automation_version
      WHERE definition_id = ${definitionId}
        AND (tenant_id = ${tenantId} OR tenant_id = 'ten_system')
      ORDER BY version_no DESC
    `.execute(tx);
    return res.rows.map(formatVersion);
  }

  /**
   * Retrieves a specific version by id.
   */
  async getVersionById(
    tx: Tx,
    tenantId: string,
    versionId: string,
  ): Promise<AutomationVersion> {
    const res = await sql<RawVersionRow>`
      SELECT * FROM app.automation_version
      WHERE id = ${versionId}
        AND (tenant_id = ${tenantId} OR tenant_id = 'ten_system')
    `.execute(tx);
    const row = res.rows[0];
    if (!row) {
      throw AppError.of('NOT_FOUND', `Automation version '${versionId}' not found.`);
    }
    return formatVersion(row);
  }

  /**
   * Inserts a new automation version.
   */
  async insertVersion(tx: Tx, version: AutomationVersion): Promise<AutomationVersion> {
    const res = await sql<RawVersionRow>`
      INSERT INTO app.automation_version (
        id, tenant_id, definition_id, version_no, status, trigger_config,
        steps, content_hash, author_id, submitted_by, submitted_at,
        approved_by, approved_at, rejection_reason, lock_version, created_at
      ) VALUES (
        ${version.id}, ${version.tenantId}, ${version.definitionId},
        ${version.versionNo}, ${version.status},
        ${JSON.stringify(version.triggerConfig)}::jsonb,
        ${JSON.stringify(version.steps)}::jsonb,
        ${version.contentHash}, ${version.authorId},
        ${version.submittedBy ?? null},
        ${version.submittedAt ? new Date(version.submittedAt) : null},
        ${version.approvedBy ?? null},
        ${version.approvedAt ? new Date(version.approvedAt) : null},
        ${version.rejectionReason ?? null},
        ${version.lockVersion},
        ${new Date(version.createdAt)}
      )
      RETURNING *
    `.execute(tx);
    return formatVersion(res.rows[0]!);
  }

  /**
   * Updates an automation version (e.g. approve, reject, supersede).
   */
  async updateVersion(
    tx: Tx,
    tenantId: string,
    versionId: string,
    update: {
      status?: AutomationVersion['status'];
      submittedBy?: string | null;
      submittedAt?: string | null;
      approvedBy?: string | null;
      approvedAt?: string | null;
      rejectionReason?: string | null;
    },
  ): Promise<AutomationVersion> {
    const res = await sql<RawVersionRow>`
      UPDATE app.automation_version
      SET status = COALESCE(${update.status ?? null}, status),
          submitted_by = COALESCE(${update.submittedBy ?? null}, submitted_by),
          submitted_at = COALESCE(${update.submittedAt ? new Date(update.submittedAt) : null}, submitted_at),
          approved_by = COALESCE(${update.approvedBy ?? null}, approved_by),
          approved_at = COALESCE(${update.approvedAt ? new Date(update.approvedAt) : null}, approved_at),
          rejection_reason = ${update.rejectionReason ?? null},
          lock_version = lock_version + 1
      WHERE id = ${versionId}
        AND tenant_id = ${tenantId}
      RETURNING *
    `.execute(tx);
    const row = res.rows[0];
    if (!row) {
      throw AppError.of('NOT_FOUND', `Automation version '${versionId}' not found.`);
    }
    return formatVersion(row);
  }

  /**
   * Lists executions with optional filtering.
   */
  async listExecutions(
    tx: Tx,
    tenantId: string,
    filter?: { definitionId?: string; status?: string; subjectId?: string; limit?: number },
  ): Promise<AutomationExecution[]> {
    let q = sql<RawExecutionRow>`
      SELECT * FROM app.automation_execution
      WHERE tenant_id = ${tenantId}
    `;
    if (filter?.definitionId) {
      q = sql<RawExecutionRow>`${q} AND definition_id = ${filter.definitionId}`;
    }
    if (filter?.status) {
      q = sql<RawExecutionRow>`${q} AND status = ${filter.status}`;
    }
    if (filter?.subjectId) {
      q = sql<RawExecutionRow>`${q} AND subject_id = ${filter.subjectId}`;
    }
    q = sql<RawExecutionRow>`${q} ORDER BY created_at DESC LIMIT ${filter?.limit ?? 50}`;
    const res = await q.execute(tx);
    return res.rows.map(formatExecution);
  }

  /**
   * Lists all step executions for an execution.
   */
  async listStepExecutions(
    tx: Tx,
    tenantId: string,
    executionId: string,
  ): Promise<AutomationStepExecution[]> {
    const res = await sql<RawStepExecutionRow>`
      SELECT * FROM app.automation_step_execution
      WHERE tenant_id = ${tenantId}
        AND execution_id = ${executionId}
      ORDER BY step_index ASC
    `.execute(tx);
    return res.rows.map(formatStepExecution);
  }

  /**
   * Lists dead-letter records.
   */
  async listDeadLetters(
    tx: Tx,
    tenantId: string,
    filter?: { status?: string; limit?: number },
  ): Promise<DeadLetterRecord[]> {
    let q = sql<RawDeadLetterRow>`
      SELECT * FROM app.wfa_dead_letter
      WHERE tenant_id = ${tenantId}
    `;
    if (filter?.status) {
      q = sql<RawDeadLetterRow>`${q} AND resolution_status = ${filter.status}`;
    }
    q = sql<RawDeadLetterRow>`${q} ORDER BY created_at DESC LIMIT ${filter?.limit ?? 50}`;
    const res = await q.execute(tx);
    return res.rows.map(formatDeadLetter);
  }

  /**
   * Inserts a scheduled trigger.
   */
  async insertScheduledTrigger(tx: Tx, trigger: ScheduledTrigger): Promise<ScheduledTrigger> {
    const res = await sql<RawScheduledTriggerRow>`
      INSERT INTO app.scheduled_trigger (
        id, tenant_id, definition_id, version_id, cron_expression,
        next_run_at, last_run_at, status, payload, created_at
      ) VALUES (
        ${trigger.id}, ${trigger.tenantId}, ${trigger.definitionId}, ${trigger.versionId},
        ${trigger.cronExpression ?? null}, ${new Date(trigger.nextRunAt)},
        ${trigger.lastRunAt ? new Date(trigger.lastRunAt) : null},
        ${trigger.status}, ${JSON.stringify(trigger.payload)}::jsonb,
        ${new Date(trigger.createdAt)}
      )
      RETURNING *
    `.execute(tx);
    return formatScheduledTrigger(res.rows[0]!);
  }

  /**
   * Finds due active scheduled triggers.
   */
  async findDueScheduledTriggers(
    tx: Tx,
    nowIso: string,
    limit: number = 20,
  ): Promise<ScheduledTrigger[]> {
    const res = await sql<RawScheduledTriggerRow>`
      SELECT * FROM app.scheduled_trigger
      WHERE status = 'ACTIVE'
        AND next_run_at <= ${new Date(nowIso)}
      ORDER BY next_run_at ASC
      LIMIT ${limit}
    `.execute(tx);
    return res.rows.map(formatScheduledTrigger);
  }

  /**
   * Updates scheduled trigger status or next run timestamp.
   */
  async updateScheduledTrigger(
    tx: Tx,
    id: string,
    update: {
      nextRunAt?: string;
      lastRunAt?: string;
      status?: ScheduledTrigger['status'];
    },
  ): Promise<ScheduledTrigger> {
    const res = await sql<RawScheduledTriggerRow>`
      UPDATE app.scheduled_trigger
      SET next_run_at = COALESCE(${update.nextRunAt ? new Date(update.nextRunAt) : null}, next_run_at),
          last_run_at = COALESCE(${update.lastRunAt ? new Date(update.lastRunAt) : null}, last_run_at),
          status = COALESCE(${update.status ?? null}, status)
      WHERE id = ${id}
      RETURNING *
    `.execute(tx);
    const row = res.rows[0];
    if (!row) {
      throw AppError.of('NOT_FOUND', `Scheduled trigger '${id}' not found.`);
    }
    return formatScheduledTrigger(row);
  }

  /**
   * Finds active event-driven automation definitions matching an event type.
   */
  async findActiveDefinitionsByEventType(
    tx: Tx,
    tenantId: string,
    eventType: string,
  ): Promise<Array<{ definition: AutomationDefinition; version: AutomationVersion }>> {
    const res = await sql<{
      def_id: string;
      def_tenant_id: string;
      def_code: string;
      def_name: string;
      def_description: string | null;
      def_trigger_type: string;
      def_entity_type: string;
      def_status: string;
      def_is_system: boolean;
      def_pinned_version_id: string | null;
      def_lock_version: number;
      def_created_by: string;
      def_created_at: Date;
      def_updated_by: string;
      def_updated_at: Date;
      ver_id: string;
      ver_tenant_id: string;
      ver_definition_id: string;
      ver_version_no: number;
      ver_status: string;
      ver_trigger_config: unknown;
      ver_steps: unknown;
      ver_content_hash: string;
      ver_author_id: string;
      ver_submitted_by: string | null;
      ver_submitted_at: Date | null;
      ver_approved_by: string | null;
      ver_approved_at: Date | null;
      ver_rejection_reason: string | null;
      ver_lock_version: number;
      ver_created_at: Date;
    }>`
      SELECT
        d.id as def_id, d.tenant_id as def_tenant_id, d.code as def_code, d.name as def_name,
        d.description as def_description, d.trigger_type as def_trigger_type, d.entity_type as def_entity_type,
        d.status as def_status, d.is_system as def_is_system, d.pinned_version_id as def_pinned_version_id,
        d.lock_version as def_lock_version, d.created_by as def_created_by, d.created_at as def_created_at,
        d.updated_by as def_updated_by, d.updated_at as def_updated_at,
        v.id as ver_id, v.tenant_id as ver_tenant_id, v.definition_id as ver_definition_id,
        v.version_no as ver_version_no, v.status as ver_status, v.trigger_config as ver_trigger_config,
        v.steps as ver_steps, v.content_hash as ver_content_hash, v.author_id as ver_author_id,
        v.submitted_by as ver_submitted_by, v.submitted_at as ver_submitted_at,
        v.approved_by as ver_approved_by, v.approved_at as ver_approved_at,
        v.rejection_reason as ver_rejection_reason, v.lock_version as ver_lock_version,
        v.created_at as ver_created_at
      FROM app.automation_definition d
      JOIN app.automation_version v ON v.id = d.pinned_version_id
      WHERE (d.tenant_id = ${tenantId} OR d.is_system = true)
        AND d.status = 'ACTIVE'
        AND v.status = 'ACTIVE'
        AND d.trigger_type = 'EVENT'
        AND (v.trigger_config->>'eventType' = ${eventType} OR v.trigger_config->>'eventType' IS NULL)
    `.execute(tx);

    return res.rows.map((row) => ({
      definition: formatDefinition({
        id: row.def_id,
        tenant_id: row.def_tenant_id,
        code: row.def_code,
        name: row.def_name,
        description: row.def_description,
        trigger_type: row.def_trigger_type,
        entity_type: row.def_entity_type,
        status: row.def_status,
        is_system: row.def_is_system,
        pinned_version_id: row.def_pinned_version_id,
        lock_version: row.def_lock_version,
        created_by: row.def_created_by,
        created_at: row.def_created_at,
        updated_by: row.def_updated_by,
        updated_at: row.def_updated_at,
      }),
      version: formatVersion({
        id: row.ver_id,
        tenant_id: row.ver_tenant_id,
        definition_id: row.ver_definition_id,
        version_no: row.ver_version_no,
        status: row.ver_status,
        trigger_config: row.ver_trigger_config,
        steps: row.ver_steps,
        content_hash: row.ver_content_hash,
        author_id: row.ver_author_id,
        submitted_by: row.ver_submitted_by,
        submitted_at: row.ver_submitted_at,
        approved_by: row.ver_approved_by,
        approved_at: row.ver_approved_at,
        rejection_reason: row.ver_rejection_reason,
        lock_version: row.ver_lock_version,
        created_at: row.ver_created_at,
      }),
    }));
  }

  /**
   * Finds executions in WAITING status that are ready to be resumed by timer.
   */
  async findWaitingExecutionsDue(
    tx: Tx,
    nowIso: string,
    limit: number = 20,
  ): Promise<AutomationExecution[]> {
    const res = await sql<RawExecutionRow>`
      SELECT * FROM app.automation_execution
      WHERE status = 'WAITING'
        AND (context->'waitConfig'->>'untilIso') IS NOT NULL
        AND (context->'waitConfig'->>'untilIso') <= ${nowIso}
      ORDER BY updated_at ASC
      LIMIT ${limit}
    `.execute(tx);
    return res.rows.map(formatExecution);
  }

  /**
   * Finds running or retrying executions with expired worker leases (stale worker detection).
   */
  async findStaleRunningExecutions(
    tx: Tx,
    nowIso: string,
    limit: number = 20,
  ): Promise<AutomationExecution[]> {
    const res = await sql<RawExecutionRow>`
      SELECT * FROM app.automation_execution
      WHERE status IN ('RUNNING', 'RETRYING')
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at < ${new Date(nowIso)}
      ORDER BY lease_expires_at ASC
      LIMIT ${limit}
    `.execute(tx);
    return res.rows.map(formatExecution);
  }

  /**
   * Counts active executions for a tenant to enforce concurrency limits.
   */
  async countActiveExecutionsForTenant(tx: Tx, tenantId: string): Promise<number> {
    const res = await sql<{ count: string | number }>`
      SELECT count(*) as count
      FROM app.automation_execution
      WHERE tenant_id = ${tenantId}
        AND status IN ('RUNNING', 'WAITING')
    `.execute(tx);
    return Number(res.rows[0]?.count ?? 0);
  }

  /**
   * Resets worker lease on an execution (used by lease recovery).
   */
  async resetExecutionWorkerLease(
    tx: Tx,
    tenantId: string,
    executionId: string,
  ): Promise<void> {
    await sql`
      UPDATE app.automation_execution
      SET worker_id = NULL,
          lease_expires_at = NULL,
          status = 'PENDING',
          updated_at = now()
      WHERE id = ${executionId}
        AND tenant_id = ${tenantId}
    `.execute(tx);
  }
}



