// apps/api/src/modules/automation/engine.ts — owner: Dev 1 / Dev 6 (MOD-WFA)
import {
  AppError,
  type AutomationExecution,
  type AutomationStepExecution,
  type DeadLetterRecord,
  type RequestContext,
  type StepType,
  type Tx,
} from '@dsa/contracts';
import { assertValidTransition } from './lifecycle';
import { AutomationRepository } from './repository';
import { calculateRetryDelay, classifyError, DEFAULT_RETRY_CONFIG, sanitizeErrorDetails } from './retry-policy';
import { createDefaultStepHandlers } from './step-handlers';
import type {
  AutomationEngineDependencies,
  CreateExecutionParams,
  StepExecutionContext,
  StepHandler,
  WorkerLeaseConfig,
} from './types';

export const DEFAULT_WORKER_CONFIG: WorkerLeaseConfig = {
  workerId: `wfa_worker_${Math.random().toString(36).substring(2, 9)}`,
  leaseDurationMs: 60_000,
  heartbeatIntervalMs: 10_000,
  maxStepTimeoutMs: 30_000,
  maxExecutionLifetimeMs: 86_400_000,
};

export class AutomationEngine {
  private readonly repository = new AutomationRepository();
  private readonly workerConfig: WorkerLeaseConfig;
  private readonly handlers: Record<StepType, StepHandler>;

  constructor(private readonly deps: AutomationEngineDependencies) {
    this.workerConfig = { ...DEFAULT_WORKER_CONFIG, ...deps.workerConfig };
    this.handlers = {
      ...createDefaultStepHandlers({
        txRunner: deps.txRunner,
        decisionPort: deps.decisionPort,
        taskPort: deps.taskPort,
        userDirectoryPort: deps.userDirectoryPort,
        auditPort: deps.auditPort,
      }),
      ...(deps.handlers as Record<StepType, StepHandler>),
    };
  }

  /**
   * Creates an execution for an accepted trigger occurrence with deduplication.
   */
  async createExecution(
    ctx: RequestContext,
    params: CreateExecutionParams,
  ): Promise<{ execution: AutomationExecution; replayed: boolean }> {
    const tenantId = ctx.principal.tenantId;
    if (!tenantId || tenantId !== params.tenantId) {
      throw AppError.of('FORBIDDEN', 'Caller tenant context does not match execution tenant.');
    }

    const chainDepth = params.chainDepth ?? 0;
    if (chainDepth > 3) {
      throw AppError.of(
        'VALIDATION_ERROR',
        `Workflow chain depth '${chainDepth}' exceeds maximum allowed depth of 3.`,
      );
    }

    return this.deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
      // 1. Deduplication check by idempotency key
      if (params.idempotencyKey) {
        const existing = await this.repository.findExecutionByIdempotencyKey(tx, tenantId, params.idempotencyKey);
        if (existing) {
          return { execution: existing, replayed: true };
        }
      }

      // 2. Fetch definition and pinned version
      const { definition, version } = await this.repository.getDefinitionAndVersion(
        tx,
        tenantId,
        params.definitionId,
      );

      if (definition.status === 'ARCHIVED' || definition.status === 'INACTIVE') {
        throw AppError.of(
          'INVALID_STATE',
          `Cannot trigger automation '${definition.id}' because it is in '${definition.status}' status.`,
        );
      }

      const executionId = this.deps.ids.next('wfe') as AutomationExecution['id'];
      const now = new Date().toISOString();

      const newExecution: AutomationExecution = {
        id: executionId,
        tenantId,
        definitionId: definition.id,
        versionId: version.id,
        triggerType: params.triggerType,
        triggerEventId: params.triggerEventId ?? null,
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        status: 'PENDING',
        currentStepIndex: 0,
        context: params.context ?? {},
        dryRun: params.dryRun ?? false,
        workerId: null,
        leaseExpiresAt: null,
        errorCode: null,
        errorMessage: null,
        idempotencyKey: params.idempotencyKey ?? null,
        correlationId: params.correlationId || ctx.correlationId,
        causationId: params.causationId ?? null,
        chainDepth,
        startedAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      try {
        const created = await this.repository.insertExecution(tx, newExecution);

        if (this.deps.auditPort) {
          await this.deps.auditPort.record(tx, ctx, {
            action: 'automation.execution_created',
            entityType: 'AUTOMATION_EXECUTION',
            entityId: created.id,
            after: {
              definitionId: created.definitionId,
              versionId: created.versionId,
              subjectType: created.subjectType,
              subjectId: created.subjectId,
            },
          });
        }

        return { execution: created, replayed: false };
      } catch (err: unknown) {
        // Handle concurrent conflict on idempotency key
        if (params.idempotencyKey) {
          const conflictExisting = await this.repository.findExecutionByIdempotencyKey(
            tx,
            tenantId,
            params.idempotencyKey,
          );
          if (conflictExisting) {
            return { execution: conflictExisting, replayed: true };
          }
        }
        throw err;
      }
    });
  }

  /**
   * Worker entrypoint: Claims lease and runs an execution step by step.
   */
  async claimAndRun(
    ctx: RequestContext,
    executionId: string,
    workerIdOverride?: string,
  ): Promise<AutomationExecution | null> {
    const tenantId = ctx.principal.tenantId;
    const workerId = workerIdOverride || this.workerConfig.workerId;

    // 1. Claim worker lease atomically
    const claimed = await this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      return this.repository.claimWorkerLease(
        tx,
        tenantId,
        executionId,
        workerId,
        this.workerConfig.leaseDurationMs,
      );
    });

    if (!claimed) {
      // Lease not acquired (already running or leased)
      return null;
    }

    return this.runExecutionLoop(ctx, claimed, workerId);
  }

  /**
   * Heartbeat to extend active worker lease on a running execution.
   */
  async heartbeat(
    ctx: RequestContext,
    executionId: string,
    workerIdOverride?: string,
  ): Promise<boolean> {
    const tenantId = ctx.principal.tenantId;
    const workerId = workerIdOverride || this.workerConfig.workerId;

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      return this.repository.extendWorkerLease(
        tx,
        tenantId,
        executionId,
        workerId,
        this.workerConfig.leaseDurationMs,
      );
    });
  }

  /**
   * Internal execution loop processing ordered steps from the pinned automation version.
   */
  private async runExecutionLoop(
    ctx: RequestContext,
    initialExecution: AutomationExecution,
    workerId: string,
  ): Promise<AutomationExecution> {
    const tenantId = ctx.principal.tenantId;
    let currentExec = initialExecution;

    // Fetch version steps
    const { version } = await this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      return this.repository.getDefinitionAndVersion(tx, tenantId, currentExec.definitionId);
    });

    const steps = version.steps;

    // Step processing loop
    while (currentExec.currentStepIndex < steps.length && currentExec.status === 'RUNNING') {
      const stepIndex = currentExec.currentStepIndex;
      const step = steps[stepIndex]!;

      // 1. Execution lifetime check
      if (currentExec.startedAt) {
        const elapsed = Date.now() - new Date(currentExec.startedAt).getTime();
        if (elapsed > this.workerConfig.maxExecutionLifetimeMs) {
          return this.transitionExecution(ctx, currentExec, workerId, {
            status: 'FAILED',
            errorCode: 'EXECUTION_LIFETIME_EXCEEDED',
            errorMessage: `Execution exceeded maximum lifetime of ${this.workerConfig.maxExecutionLifetimeMs} ms`,
            completedAt: new Date().toISOString(),
          });
        }
      }

      // 2. Prepare or retrieve step execution record
      const stepResult = await this.deps.txRunner.withTenantTx(ctx, async (tx) => {
        // Enforce lease freshness before step execution
        let stepExec = await this.repository.getStepExecution(tx, tenantId, currentExec.id, stepIndex);

        if (stepExec && (stepExec.status === 'SUCCEEDED' || stepExec.status === 'SKIPPED')) {
          // Step already completed by prior attempt; advance without re-execution
          return { alreadyCompleted: true, stepExec };
        }

        const stepIdemKey = `${currentExec.id}:step_${stepIndex}:${step.id}`;
        if (!stepExec) {
          const stepExecId = this.deps.ids.next('wfse') as AutomationStepExecution['id'];
          stepExec = await this.repository.insertStepExecution(tx, {
            id: stepExecId,
            tenantId,
            executionId: currentExec.id,
            stepIndex,
            stepId: step.id,
            stepType: step.type,
            status: 'RUNNING',
            inputSnapshot: currentExec.context,
            outputSnapshot: null,
            errorCode: null,
            errorMessage: null,
            errorClassification: null,
            attempts: 1,
            idempotencyKey: stepIdemKey,
            skipReason: null,
            skippedBy: null,
            startedAt: new Date().toISOString(),
            completedAt: null,
            createdAt: new Date().toISOString(),
          });
        } else {
          // Increment attempts for retry
          stepExec = await this.repository.updateStepExecution(tx, tenantId, stepExec.id, {
            status: 'RUNNING',
            attempts: stepExec.attempts + 1,
            startedAt: new Date().toISOString(),
          });
        }

        return { alreadyCompleted: false, stepExec };
      });

      if (stepResult.alreadyCompleted) {
        // Advance step index
        currentExec = await this.deps.txRunner.withTenantTx(ctx, async (tx) => {
          return this.repository.updateExecutionProgress(tx, tenantId, currentExec.id, workerId, {
            status: 'RUNNING',
            currentStepIndex: stepIndex + 1,
          });
        });
        continue;
      }

      const activeStepExec = stepResult.stepExec;

      // 3. Execute step handler
      const handler = this.handlers[step.type];
      if (!handler) {
        // Permanent failure: step type handler missing
        return this.handleStepFailure(ctx, currentExec, activeStepExec, workerId, {
          code: 'UNKNOWN_STEP_HANDLER',
          message: `No step handler registered for step type '${step.type}'.`,
          classification: 'PERMANENT',
        });
      }

      const stepCtx: StepExecutionContext = {
        tenantId,
        executionId: currentExec.id,
        stepIndex,
        step,
        context: currentExec.context,
        subjectType: currentExec.subjectType,
        subjectId: currentExec.subjectId,
        dryRun: currentExec.dryRun,
        correlationId: currentExec.correlationId,
        attempts: activeStepExec.attempts,
        requestCtx: ctx,
      };

      let executionResult;
      try {
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            const err = Object.assign(
              new Error(`Step execution timed out after ${this.workerConfig.maxStepTimeoutMs} ms`),
              {
                code: 'STEP_TIMEOUT',
                classification: 'AMBIGUOUS' as const,
              },
            );
            reject(err);
          }, this.workerConfig.maxStepTimeoutMs);
        });

        try {
          executionResult = await Promise.race([handler.execute(stepCtx), timeoutPromise]);
        } finally {
          if (timeoutHandle) clearTimeout(timeoutHandle);
        }
      } catch (err: unknown) {
        const classified = classifyError(err);
        const errMsg = err instanceof Error ? err.message : String(err);
        const errCode =
          err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string'
            ? String((err as { code: unknown }).code)
            : 'STEP_EXECUTION_THREW';
        return this.handleStepFailure(ctx, currentExec, activeStepExec, workerId, {
          code: errCode,
          message: errMsg,
          classification: classified,
        });
      }

      // 4. Handle step outcome
      if (executionResult.status === 'SUCCEEDED') {
        const nextIdx = executionResult.nextStepIndex ?? stepIndex + 1;
        const mergedContext = {
          ...currentExec.context,
          ...(executionResult.outputSnapshot || {}),
        };

        // Persist step completion and advance progress
        currentExec = await this.deps.txRunner.withTenantTx(ctx, async (tx) => {
          await this.repository.updateStepExecution(tx, tenantId, activeStepExec.id, {
            status: 'SUCCEEDED',
            outputSnapshot: executionResult.outputSnapshot ?? null,
            completedAt: new Date().toISOString(),
          });

          return this.repository.updateExecutionProgress(tx, tenantId, currentExec.id, workerId, {
            status: 'RUNNING',
            currentStepIndex: nextIdx,
            context: mergedContext,
          });
        });

        // If step indicated END or terminal outcome
        if (step.type === 'END' || nextIdx >= steps.length) {
          return this.transitionExecution(ctx, currentExec, workerId, {
            status: 'SUCCEEDED',
            completedAt: new Date().toISOString(),
          });
        }
      } else if (executionResult.status === 'WAITING') {
        // Step requested wait state
        return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
          await this.repository.updateStepExecution(tx, tenantId, activeStepExec.id, {
            status: 'RUNNING', // step remains open awaiting resumption
            outputSnapshot: executionResult.waitConfig ?? null,
          });

          return this.transitionExecution(ctx, currentExec, workerId, {
            status: 'WAITING',
            context: currentExec.context,
          });
        });
      } else if (executionResult.status === 'FAILED') {
        return this.handleStepFailure(
          ctx,
          currentExec,
          activeStepExec,
          workerId,
          executionResult.error || {
            code: 'STEP_FAILED',
            message: 'Step returned failure status',
            classification: 'PERMANENT',
          },
        );
      }
    }

    if (currentExec.status === 'RUNNING' && currentExec.currentStepIndex >= steps.length) {
      return this.transitionExecution(ctx, currentExec, workerId, {
        status: 'SUCCEEDED',
        completedAt: new Date().toISOString(),
      });
    }

    return currentExec;
  }

  /**
   * Handles step failure, applying retry, dead-letter, or failure transitions.
   */
  private async handleStepFailure(
    ctx: RequestContext,
    execution: AutomationExecution,
    stepExec: AutomationStepExecution,
    workerId: string,
    error: { code: string; message: string; classification: string; retryAfterMs?: number },
  ): Promise<AutomationExecution> {
    const tenantId = ctx.principal.tenantId;
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.deps.retryConfig };
    const classification = error.classification as 'RETRYABLE' | 'PERMANENT' | 'AMBIGUOUS';
    const sanitizedDetails = sanitizeErrorDetails(error);

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      // 1. Update step execution record
      await this.repository.updateStepExecution(tx, tenantId, stepExec.id, {
        status: 'FAILED',
        errorCode: error.code,
        errorMessage: error.message,
        errorClassification: classification,
        completedAt: new Date().toISOString(),
      });

      // 2. Classify and route execution state
      if (classification === 'PERMANENT') {
        return this.transitionExecution(ctx, execution, workerId, {
          status: 'FAILED',
          errorCode: error.code,
          errorMessage: error.message,
          completedAt: new Date().toISOString(),
        });
      }

      if (classification === 'AMBIGUOUS') {
        // Dead-letter immediately without blind retry
        const dlId = this.deps.ids.next('wfdl') as DeadLetterRecord['id'];
        await this.repository.insertDeadLetter(tx, {
          id: dlId,
          tenantId,
          executionId: execution.id,
          stepExecutionId: stepExec.id,
          reason: 'AMBIGUOUS_EXTERNAL_OUTCOME',
          errorDetails: sanitizedDetails,
          resolutionStatus: 'OPEN',
          resolvedBy: null,
          resolvedAt: null,
          resolutionAction: null,
          createdAt: new Date().toISOString(),
        });

        return this.transitionExecution(ctx, execution, workerId, {
          status: 'DEAD_LETTERED',
          errorCode: error.code,
          errorMessage: `Execution dead-lettered due to ambiguous outcome: ${error.message}`,
        });
      }

      // RETRYABLE
      if (stepExec.attempts < retryConfig.maxAttempts) {
        const delayMs = error.retryAfterMs ?? calculateRetryDelay(stepExec.attempts, retryConfig);
        const nextRetryIso = new Date(Date.now() + delayMs).toISOString();

        return this.transitionExecution(ctx, execution, workerId, {
          status: 'RETRYING',
          errorCode: error.code,
          errorMessage: `Step '${stepExec.stepId}' failed (attempt ${stepExec.attempts}/${retryConfig.maxAttempts}). Retrying after ${delayMs}ms at ${nextRetryIso}. Error: ${error.message}`,
        });
      }

      // Attempts exhausted -> Dead Letter
      const dlId = this.deps.ids.next('wfdl') as DeadLetterRecord['id'];
      await this.repository.insertDeadLetter(tx, {
        id: dlId,
        tenantId,
        executionId: execution.id,
        stepExecutionId: stepExec.id,
        reason: 'MAX_RETRIES_EXCEEDED',
        errorDetails: {
          ...sanitizedDetails,
          attemptsExhausted: stepExec.attempts,
          maxAttempts: retryConfig.maxAttempts,
        },
        resolutionStatus: 'OPEN',
        resolvedBy: null,
        resolvedAt: null,
        resolutionAction: null,
        createdAt: new Date().toISOString(),
      });

      return this.transitionExecution(ctx, execution, workerId, {
        status: 'DEAD_LETTERED',
        errorCode: error.code,
        errorMessage: `Execution dead-lettered after ${stepExec.attempts} failed retry attempts: ${error.message}`,
      });
    });
  }

  /**
   * Safely transitions execution status and updates progress.
   */
  private async transitionExecution(
    ctx: RequestContext,
    execution: AutomationExecution,
    workerId: string,
    update: {
      status: AutomationExecution['status'];
      currentStepIndex?: number;
      context?: Record<string, unknown>;
      errorCode?: string | null;
      errorMessage?: string | null;
      completedAt?: string | null;
    },
  ): Promise<AutomationExecution> {
    assertValidTransition(execution.status, update.status, execution.id);

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const updated = await this.repository.updateExecutionProgress(
        tx,
        ctx.principal.tenantId,
        execution.id,
        workerId,
        update,
      );

      if (this.deps.auditPort) {
        await this.deps.auditPort.record(tx, ctx, {
          action: `automation.execution_${update.status.toLowerCase()}`,
          entityType: 'AUTOMATION_EXECUTION',
          entityId: updated.id,
          before: { status: execution.status },
          after: { status: updated.status, errorCode: updated.errorCode },
        });
      }

      if (this.deps.outboxPort && ['SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTERED'].includes(update.status)) {
        await this.deps.outboxPort.emit(tx, ctx, {
          type: `automation.execution_${update.status.toLowerCase()}`,
          subject: { type: 'AUTOMATION_EXECUTION', id: updated.id },
          data: {
            definitionId: updated.definitionId,
            versionId: updated.versionId,
            status: updated.status,
            errorCode: updated.errorCode,
            subjectType: updated.subjectType,
            subjectId: updated.subjectId,
          },
          causationId: updated.causationId ?? undefined,
        });
      }

      return updated;
    });
  }

  /**
   * Resumes a WAITING execution and advances beyond the wait step.
   */
  async resumeExecution(
    ctx: RequestContext,
    executionId: string,
    resumePayload?: Record<string, unknown>,
  ): Promise<AutomationExecution> {
    const tenantId = ctx.principal.tenantId;

    const updated = await this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const exec = await this.repository.getExecutionById(tx, tenantId, executionId);
      assertValidTransition(exec.status, 'RUNNING', executionId);

      // Complete the waiting step
      const stepExec = await this.repository.getStepExecution(tx, tenantId, executionId, exec.currentStepIndex);
      if (stepExec && stepExec.status !== 'SUCCEEDED') {
        await this.repository.updateStepExecution(tx, tenantId, stepExec.id, {
          status: 'SUCCEEDED',
          outputSnapshot: resumePayload ?? null,
          completedAt: new Date().toISOString(),
        });
      }

      const mergedContext = {
        ...exec.context,
        ...(resumePayload || {}),
      };

      // Claim worker lease atomically before updating execution progress
      await this.repository.claimWorkerLease(
        tx,
        tenantId,
        executionId,
        this.workerConfig.workerId,
        this.workerConfig.leaseDurationMs,
      );

      return this.repository.updateExecutionProgress(tx, tenantId, executionId, this.workerConfig.workerId, {
        status: 'RUNNING',
        currentStepIndex: exec.currentStepIndex + 1,
        context: mergedContext,
      });
    });

    return updated;
  }

  /**
   * Cancels an active or waiting execution.
   */
  async cancelExecution(
    ctx: RequestContext,
    executionId: string,
    reason?: string,
  ): Promise<AutomationExecution> {
    const tenantId = ctx.principal.tenantId;

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const exec = await this.repository.getExecutionById(tx, tenantId, executionId);
      assertValidTransition(exec.status, 'CANCELLED', executionId);

      const updated = await this.repository.cancelExecution(tx, tenantId, executionId, reason);

      if (this.deps.auditPort) {
        await this.deps.auditPort.record(tx, ctx, {
          action: 'automation.execution_cancelled',
          entityType: 'AUTOMATION_EXECUTION',
          entityId: executionId,
          reason,
        });
      }

      return updated;
    });
  }

  /**
   * Operator resolution on dead-lettered executions.
   */
  async resolveDeadLetter(
    ctx: RequestContext,
    deadLetterId: string,
    action: 'RETRY' | 'SKIP' | 'CANCEL',
    reason?: string,
  ): Promise<{ deadLetter: DeadLetterRecord; execution: AutomationExecution }> {
    const tenantId = ctx.principal.tenantId;

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const dl = await this.repository.getDeadLetterById(tx, tenantId, deadLetterId);
      const exec = await this.repository.getExecutionById(tx, tenantId, dl.executionId);

      const resolvedDl = await this.repository.resolveDeadLetter(
        tx,
        tenantId,
        deadLetterId,
        action,
        ctx.principal.id,
      );

      let updatedExec: AutomationExecution;

      if (action === 'RETRY') {
        // Reset step attempts and allow worker to retry
        assertValidTransition(exec.status, 'RETRYING', exec.id);
        updatedExec = await this.repository.updateExecutionByOperator(
          tx,
          tenantId,
          exec.id,
          {
            status: 'RETRYING',
            errorMessage: `Dead letter resolved: retry approved by operator (${reason || 'no note'})`,
          },
        );
      } else if (action === 'SKIP') {
        // Mark step SKIPPED and advance current_step_index
        await this.repository.updateStepExecution(tx, tenantId, dl.stepExecutionId, {
          status: 'SKIPPED',
          skipReason: reason || 'Operator skipped step via dead letter resolution',
          skippedBy: ctx.principal.id,
          completedAt: new Date().toISOString(),
        });

        assertValidTransition(exec.status, 'RUNNING', exec.id);
        updatedExec = await this.repository.updateExecutionByOperator(
          tx,
          tenantId,
          exec.id,
          {
            status: 'RUNNING',
            currentStepIndex: exec.currentStepIndex + 1,
            errorMessage: null,
          },
        );
      } else {
        // CANCEL
        assertValidTransition(exec.status, 'CANCELLED', exec.id);
        updatedExec = await this.repository.cancelExecution(
          tx,
          tenantId,
          exec.id,
          reason || 'Operator cancelled execution via dead letter resolution',
        );
      }

      if (this.deps.auditPort) {
        await this.deps.auditPort.record(tx, ctx, {
          action: 'automation.dead_letter_resolved',
          entityType: 'AUTOMATION_DEAD_LETTER',
          entityId: deadLetterId,
          after: { action, executionId: exec.id },
          reason,
        });
      }

      return { deadLetter: resolvedDl, execution: updatedExec };
    });
  }
}
