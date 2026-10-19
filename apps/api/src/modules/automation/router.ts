// apps/api/src/modules/automation/router.ts — owner: Dev 1 / Dev 6 (Module 24: Workflow Automation MOD-WFA)
import crypto from 'node:crypto';
import {
  AppError,
  CreateAutomationDefinitionSchema,
  CreateAutomationVersionSchema,
  ExecuteAutomationSchema,
  ReviewVersionActionSchema,
  SkipStepSchema,
  type AutomationDefinition,
  type AutomationExecution,
  type AutomationVersion,
  type PermissionCode,
  type RequestContext,
  type StepDefinition,
  type Tx,
} from '@dsa/contracts';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ifMatchVersion } from '../../http/request';
import type { ApiDeps } from '../types';
import { AutomationEngine } from './engine';
import { AutomationRepository } from './repository';

function getContext(req: Request): RequestContext {
  if (!req.ctx || !req.ctx.principal) {
    throw AppError.of('UNAUTHENTICATED', 'Missing or invalid access token.');
  }
  return req.ctx;
}

function requirePermission(ctx: RequestContext, code: PermissionCode): void {
  const { principal } = ctx;
  if (principal.kind === 'SERVICE') return;
  const hasGrant = principal.grants.some((g) => g.code === code);
  if (!hasGrant) {
    throw AppError.of('FORBIDDEN', `Permission denied: ${code} required.`);
  }
}

function extractIdempotencyKey(req: Request): string | undefined {
  const raw = req.header('Idempotency-Key');
  if (!raw) return undefined;
  if (!/^[A-Za-z0-9_:-]{8,256}$/.test(raw)) {
    throw AppError.of('VALIDATION_ERROR', 'Invalid Idempotency-Key header format.');
  }
  return raw;
}

function paramStr(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val[0] ?? '';
  return val ?? '';
}

export function computeStepsHash(steps: unknown[]): string {
  const digest = crypto.createHash('sha256').update(JSON.stringify(steps)).digest('hex');
  return `sha256:${digest}`;
}

const UpdateDefinitionBodySchema = z.object({
  name: z.string().min(3).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
});

const ResolveDeadLetterBodySchema = z.object({
  action: z.enum(['RETRY', 'SKIP', 'CANCEL']),
  reason: z.string().max(500).optional(),
});

export function createRouter(deps: ApiDeps): Router {
  const router = Router();
  const repository = new AutomationRepository();
  const engine = new AutomationEngine({
    txRunner: deps.txRunner,
    ids: deps.ids || deps.idGenerator!,
    auditPort: deps.auditPort || deps.audit,
    decisionPort: deps.decisionPort,
    taskPort: deps.taskPort,
    userDirectoryPort: deps.userDirectoryPort || deps.userDirectory,
    outboxPort: deps.outboxPort,
  });

  // ---------------------------------------------------------------------------
  // 1. Definition Endpoints
  // ---------------------------------------------------------------------------

  /**
   * GET /automations — List automation definitions for tenant (and system definitions)
   */
  router.get('/automations', async (req: Request, res: Response) => {
    const ctx = getContext(req);
    requirePermission(ctx, 'automation.read');

    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const entityType = typeof req.query.entityType === 'string' ? req.query.entityType : undefined;

    const data = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return repository.listDefinitions(tx, ctx.principal.tenantId, { status, entityType });
    });

    res.json({ data });
  });

  /**
   * POST /automations — Create automation definition with initial draft version
   */
  router.post('/automations', async (req: Request, res: Response) => {
    const ctx = getContext(req);
    requirePermission(ctx, 'automation.author');

    const parseResult = CreateAutomationDefinitionSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw AppError.of('VALIDATION_ERROR', 'Invalid automation definition input.', [
        ...parseResult.error.issues.map((i) => ({ field: i.path.join('.'), issue: i.message })),
      ]);
    }

    const input = parseResult.data;
    const ids = deps.ids || deps.idGenerator!;
    const now = new Date().toISOString();

    const defId = ids.next('wfd') as AutomationDefinition['id'];
    const verId = ids.next('wfv') as AutomationVersion['id'];

    const initialSteps: StepDefinition[] = (req.body.initialSteps as StepDefinition[]) || [
      {
        id: 'step_end_init',
        name: 'Initial Step',
        type: 'END',
        isSkippable: false,
        config: { outcomeStatus: 'SUCCEEDED' },
      },
    ];

    const contentHash = computeStepsHash(initialSteps);

    const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const def: AutomationDefinition = {
        id: defId,
        tenantId: ctx.principal.tenantId,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        triggerType: input.triggerType,
        entityType: input.entityType,
        status: 'DRAFT',
        isSystem: false,
        pinnedVersionId: verId,
        lockVersion: 0,
        createdBy: ctx.principal.id,
        createdAt: now,
        updatedBy: ctx.principal.id,
        updatedAt: now,
      };

      const ver: AutomationVersion = {
        id: verId,
        tenantId: ctx.principal.tenantId,
        definitionId: defId,
        versionNo: 1,
        status: 'DRAFT',
        triggerConfig: (req.body.triggerConfig as AutomationVersion['triggerConfig']) || { filters: [] },
        steps: initialSteps,
        contentHash,
        authorId: ctx.principal.id,
        submittedBy: null,
        submittedAt: null,
        approvedBy: null,
        approvedAt: null,
        rejectionReason: null,
        lockVersion: 0,
        createdAt: now,
      };

      const createdDef = await repository.insertDefinition(tx, def);
      const createdVer = await repository.insertVersion(tx, ver);

      const audit = deps.auditPort || deps.audit;
      if (audit) {
        await audit.record(tx, ctx, {
          action: 'automation.definition_created',
          entityType: 'AUTOMATION_DEFINITION',
          entityId: createdDef.id,
          after: { code: createdDef.code, name: createdDef.name, versionId: createdVer.id },
        });
      }

      return { definition: createdDef, version: createdVer };
    });

    res.status(201).json(result);
  });

  /**
   * GET /automations/executions — List executions with filtering
   * (Declared before /automations/:id to avoid route shadowing)
   */
  router.get('/automations/executions', async (req: Request, res: Response) => {
    const ctx = getContext(req);
    requirePermission(ctx, 'automation.read');

    const definitionId = typeof req.query.definitionId === 'string' ? req.query.definitionId : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const subjectId = typeof req.query.subjectId === 'string' ? req.query.subjectId : undefined;
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;

    const data = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return repository.listExecutions(tx, ctx.principal.tenantId, {
        definitionId,
        status,
        subjectId,
        limit,
      });
    });

    res.json({ data });
  });

  /**
   * GET /automations/executions/:executionId — Get execution details
   */
  router.get('/automations/executions/:executionId', async (req: Request, res: Response) => {
    const ctx = getContext(req);
    requirePermission(ctx, 'automation.read');

    const executionId = paramStr(req.params.executionId);
    const execution = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return repository.getExecutionById(tx, ctx.principal.tenantId, executionId);
    });

    res.json(execution);
  });

  /**
   * GET /automations/executions/:executionId/steps — Get step executions
   */
  router.get('/automations/executions/:executionId/steps', async (req: Request, res: Response) => {
    const ctx = getContext(req);
    requirePermission(ctx, 'automation.read');

    const executionId = paramStr(req.params.executionId);
    const data = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      // Verify parent execution is accessible
      await repository.getExecutionById(tx, ctx.principal.tenantId, executionId);
      return repository.listStepExecutions(tx, ctx.principal.tenantId, executionId);
    });

    res.json({ data });
  });

  /**
   * POST /automations/executions/:executionId/cancel — Operator cancellation
   */
  router.post('/automations/executions/:executionId/cancel', async (req: Request, res: Response) => {
    const ctx = getContext(req);
    requirePermission(ctx, 'automation.operator');

    const executionId = paramStr(req.params.executionId);
    const reason = typeof req.body.reason === 'string' ? req.body.reason : 'Cancelled by operator';

    const cancelled = await engine.cancelExecution(ctx, executionId, reason);
    res.json(cancelled);
  });

  /**
   * POST /automations/executions/:executionId/resume — Resume waiting execution
   */
  router.post('/automations/executions/:executionId/resume', async (req: Request, res: Response) => {
    const ctx = getContext(req);
    requirePermission(ctx, 'automation.operator');

    const executionId = paramStr(req.params.executionId);
    const payload = typeof req.body.payload === 'object' && req.body.payload !== null ? req.body.payload : {};

    const resumed = await engine.resumeExecution(ctx, executionId, payload);
    res.json(resumed);
  });

  /**
   * POST /automations/executions/:executionId/steps/:stepIndex/skip — Operator step skipping
   */
  router.post(
    '/automations/executions/:executionId/steps/:stepIndex/skip',
    async (req: Request, res: Response) => {
      const ctx = getContext(req);
      requirePermission(ctx, 'automation.operator');

      const executionId = paramStr(req.params.executionId);
      const stepIndex = parseInt(paramStr(req.params.stepIndex), 10);
      if (isNaN(stepIndex) || stepIndex < 0) {
        throw AppError.of('VALIDATION_ERROR', 'Invalid stepIndex parameter.');
      }

      const parseResult = SkipStepSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw AppError.of('VALIDATION_ERROR', 'A mandatory reason is required to skip a step.', [
          ...parseResult.error.issues.map((i) => ({ field: i.path.join('.'), issue: i.message })),
        ]);
      }

      const { reason } = parseResult.data;

      const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        const exec = await repository.getExecutionById(tx, ctx.principal.tenantId, executionId);
        const step = await repository.getStepExecution(tx, ctx.principal.tenantId, executionId, stepIndex);

        if (!step) {
          throw AppError.of('NOT_FOUND', `Step execution at index ${stepIndex} not found.`);
        }

        const updatedStep = await repository.updateStepExecution(tx, ctx.principal.tenantId, step.id, {
          status: 'SKIPPED',
          skipReason: reason,
          skippedBy: ctx.principal.id,
          completedAt: new Date().toISOString(),
        });

        const nextStepIdx = Math.max(exec.currentStepIndex, stepIndex + 1);
        const updatedExec = await repository.updateExecutionByOperator(tx, ctx.principal.tenantId, exec.id, {
          status: exec.status === 'DEAD_LETTERED' ? 'RUNNING' : exec.status,
          currentStepIndex: nextStepIdx,
        });

        const audit = deps.auditPort || deps.audit;
        if (audit) {
          await audit.record(tx, ctx, {
            action: 'automation.step_skipped',
            entityType: 'AUTOMATION_STEP_EXECUTION',
            entityId: step.id,
            reason,
            after: { executionId, stepIndex, status: 'SKIPPED' },
          });
        }

        return { stepExecution: updatedStep, execution: updatedExec };
      });

      res.json(result);
    },
  );

  /**
   * GET /automations/dead-letters — List dead letter records
   */
  router.get('/automations/dead-letters', async (req: Request, res: Response) => {
    const ctx = getContext(req);
    requirePermission(ctx, 'automation.read');

    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;

    const data = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return repository.listDeadLetters(tx, ctx.principal.tenantId, { status, limit });
    });

    res.json({ data });
  });

  /**
   * GET /automations/dead-letters/:id — Get dead letter record by id
   */
  router.get('/automations/dead-letters/:id', async (req: Request, res: Response) => {
    const ctx = getContext(req);
    requirePermission(ctx, 'automation.read');

    const id = paramStr(req.params.id);
    const deadLetter = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return repository.getDeadLetterById(tx, ctx.principal.tenantId, id);
    });

    res.json(deadLetter);
  });

  /**
   * POST /automations/dead-letters/:id/resolve — Operator dead letter resolution
   */
  router.post('/automations/dead-letters/:id/resolve', async (req: Request, res: Response) => {
    const ctx = getContext(req);
    requirePermission(ctx, 'automation.operator');

    const id = paramStr(req.params.id);
    const parseResult = ResolveDeadLetterBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      throw AppError.of('VALIDATION_ERROR', 'Invalid dead letter resolution body.', [
        ...parseResult.error.issues.map((i) => ({ field: i.path.join('.'), issue: i.message })),
      ]);
    }

    const { action, reason } = parseResult.data;
    const result = await engine.resolveDeadLetter(ctx, id, action, reason);
    res.json(result);
  });

  /**
   * GET /automations/:id — Get automation definition and pinned version
   */
  router.get('/automations/:id', async (req: Request, res: Response) => {
    const ctx = getContext(req);
    requirePermission(ctx, 'automation.read');

    const definitionId = paramStr(req.params.id);
    const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return repository.getDefinitionAndVersion(tx, ctx.principal.tenantId, definitionId);
    });

    res.setHeader('ETag', `"${result.definition.lockVersion}"`);
    res.json(result);
  });

  /**
   * PATCH /automations/:id — Update definition metadata
   */
  router.patch('/automations/:id', async (req: Request, res: Response) => {
    const ctx = getContext(req);
    requirePermission(ctx, 'automation.author');

    const definitionId = paramStr(req.params.id);
    const parseResult = UpdateDefinitionBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      throw AppError.of('VALIDATION_ERROR', 'Invalid automation definition update.', [
        ...parseResult.error.issues.map((i) => ({ field: i.path.join('.'), issue: i.message })),
      ]);
    }

    const update = parseResult.data;
    const expectedVersion = ifMatchVersion(req);
    const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const existing = await repository.getDefinitionById(tx, ctx.principal.tenantId, definitionId);
      if (existing.isSystem) {
        throw AppError.of('FORBIDDEN', 'System automation definitions cannot be updated.');
      }
      if (existing.lockVersion !== expectedVersion) {
        throw AppError.of('VERSION_CONFLICT', 'The automation was changed by someone else. Reload and try again.', [
          { field: 'If-Match', issue: 'STALE', meta: { currentVersion: existing.lockVersion } },
        ]);
      }

      const updated = await repository.updateDefinition(tx, ctx.principal.tenantId, definitionId, {
        name: update.name,
        description: update.description,
        status: update.status,
        updatedBy: ctx.principal.id,
        expectedLockVersion: expectedVersion,
      });

      const audit = deps.auditPort || deps.audit;
      if (audit) {
        await audit.record(tx, ctx, {
          action: 'automation.definition_updated',
          entityType: 'AUTOMATION_DEFINITION',
          entityId: definitionId,
          before: { name: existing.name, status: existing.status },
          after: { name: updated.name, status: updated.status },
        });
      }

      return updated;
    });

    res.setHeader('ETag', `"${result.lockVersion}"`);
    res.json(result);
  });

  /**
   * GET /automations/:id/versions — List all versions of a definition
   */
  router.get('/automations/:id/versions', async (req: Request, res: Response) => {
    const ctx = getContext(req);
    requirePermission(ctx, 'automation.read');

    const definitionId = paramStr(req.params.id);
    const versions = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      // Verify definition access
      await repository.getDefinitionById(tx, ctx.principal.tenantId, definitionId);
      return repository.listVersions(tx, ctx.principal.tenantId, definitionId);
    });

    res.json({ data: versions });
  });

  /**
   * POST /automations/:id/versions — Create a new draft version (approved versioning rule)
   */
  router.post('/automations/:id/versions', async (req: Request, res: Response) => {
    const ctx = getContext(req);
    requirePermission(ctx, 'automation.author');

    const definitionId = paramStr(req.params.id);
    const parseResult = CreateAutomationVersionSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw AppError.of('VALIDATION_ERROR', 'Invalid automation version input.', [
        ...parseResult.error.issues.map((i) => ({ field: i.path.join('.'), issue: i.message })),
      ]);
    }

    const input = parseResult.data;
    const ids = deps.ids || deps.idGenerator!;
    const now = new Date().toISOString();

    const createdVersion = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const def = await repository.getDefinitionById(tx, ctx.principal.tenantId, definitionId);
      if (def.isSystem) {
        throw AppError.of('FORBIDDEN', 'Cannot add versions to system automations.');
      }

      const existingVersions = await repository.listVersions(tx, ctx.principal.tenantId, definitionId);
      const nextVerNo = existingVersions.reduce((max, v) => Math.max(max, v.versionNo), 0) + 1;

      const contentHash = computeStepsHash(input.steps);
      const verId = ids.next('wfv') as AutomationVersion['id'];

      const newVer: AutomationVersion = {
        id: verId,
        tenantId: ctx.principal.tenantId,
        definitionId: def.id,
        versionNo: nextVerNo,
        status: 'DRAFT',
        triggerConfig: input.triggerConfig,
        steps: input.steps,
        contentHash,
        authorId: ctx.principal.id,
        submittedBy: input.changeReason ? ctx.principal.id : null,
        submittedAt: input.changeReason ? now : null,
        approvedBy: null,
        approvedAt: null,
        rejectionReason: null,
        lockVersion: 0,
        createdAt: now,
      };

      const created = await repository.insertVersion(tx, newVer);

      const audit = deps.auditPort || deps.audit;
      if (audit) {
        await audit.record(tx, ctx, {
          action: 'automation.version_created',
          entityType: 'AUTOMATION_VERSION',
          entityId: created.id,
          after: { definitionId: def.id, versionNo: created.versionNo },
          reason: input.changeReason,
        });
      }

      return created;
    });

    res.status(201).json(createdVersion);
  });

  /**
   * GET /automations/:id/versions/:versionId — Retrieve specific version
   */
  router.get('/automations/:id/versions/:versionId', async (req: Request, res: Response) => {
    const ctx = getContext(req);
    requirePermission(ctx, 'automation.read');

    const versionId = paramStr(req.params.versionId);
    const version = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return repository.getVersionById(tx, ctx.principal.tenantId, versionId);
    });

    res.json(version);
  });

  /**
   * POST /automations/:id/versions/:versionId/review — Maker-Checker approval or rejection
   */
  router.post('/automations/:id/versions/:versionId/review', async (req: Request, res: Response) => {
    const ctx = getContext(req);
    requirePermission(ctx, 'automation.approve');

    const definitionId = paramStr(req.params.id);
    const versionId = paramStr(req.params.versionId);

    const parseResult = ReviewVersionActionSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw AppError.of('VALIDATION_ERROR', 'Invalid review version input.', [
        ...parseResult.error.issues.map((i) => ({ field: i.path.join('.'), issue: i.message })),
      ]);
    }

    const { action, reason } = parseResult.data;
    const now = new Date().toISOString();

    const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const def = await repository.getDefinitionById(tx, ctx.principal.tenantId, definitionId);
      const ver = await repository.getVersionById(tx, ctx.principal.tenantId, versionId);

      if (ver.status !== 'DRAFT' && ver.status !== 'PENDING_APPROVAL') {
        throw AppError.of(
          'INVALID_STATE',
          `Automation version '${versionId}' cannot be reviewed because it is in '${ver.status}' status.`,
        );
      }

      // Maker-Checker enforcement: author cannot approve their own automation version
      if (action === 'APPROVE' && ver.authorId === ctx.principal.id) {
        throw AppError.of(
          'SOD_VIOLATION',
          'Maker-checker violation: automation version author cannot approve their own automation.',
        );
      }

      let updatedVer: AutomationVersion;
      let updatedDef: AutomationDefinition = def;

      if (action === 'APPROVE') {
        // Supersede current pinned version if active
        if (def.pinnedVersionId && def.pinnedVersionId !== ver.id) {
          try {
            await repository.updateVersion(tx, ctx.principal.tenantId, def.pinnedVersionId, {
              status: 'SUPERSEDED',
            });
          } catch {
            // Ignore if already superseded
          }
        }

        updatedVer = await repository.updateVersion(tx, ctx.principal.tenantId, ver.id, {
          status: 'ACTIVE',
          approvedBy: ctx.principal.id,
          approvedAt: now,
        });

        updatedDef = await repository.updateDefinition(tx, ctx.principal.tenantId, def.id, {
          status: 'ACTIVE',
          pinnedVersionId: ver.id,
          updatedBy: ctx.principal.id,
        });
      } else {
        // REJECT
        updatedVer = await repository.updateVersion(tx, ctx.principal.tenantId, ver.id, {
          status: 'REJECTED',
          rejectionReason: reason || 'Rejected by reviewer',
        });
      }

      const audit = deps.auditPort || deps.audit;
      if (audit) {
        await audit.record(tx, ctx, {
          action: action === 'APPROVE' ? 'automation.version_approved' : 'automation.version_rejected',
          entityType: 'AUTOMATION_VERSION',
          entityId: ver.id,
          reason,
          after: { status: updatedVer.status, pinned: action === 'APPROVE' },
        });
      }

      return { version: updatedVer, definition: updatedDef };
    });

    res.json(result);
  });

  /**
   * POST /automations/:id/execute — Manual trigger or dry-run simulation
   */
  router.post('/automations/:id/execute', async (req: Request, res: Response) => {
    const ctx = getContext(req);
    requirePermission(ctx, 'automation.execute');

    const definitionId = paramStr(req.params.id);
    const parseResult = ExecuteAutomationSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw AppError.of('VALIDATION_ERROR', 'Invalid execution parameters.', [
        ...parseResult.error.issues.map((i) => ({ field: i.path.join('.'), issue: i.message })),
      ]);
    }

    const input = parseResult.data;
    const idempotencyKey = extractIdempotencyKey(req);

    // 1. Dry run simulation mode: runs without database writes or notifications
    if (input.dryRun) {
      const { definition, version } = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return repository.getDefinitionAndVersion(tx, ctx.principal.tenantId, definitionId);
      });

      const simulatedExec: AutomationExecution = {
        id: `wfe_sim_${Date.now()}` as AutomationExecution['id'],
        tenantId: ctx.principal.tenantId,
        definitionId: definition.id,
        versionId: version.id,
        triggerType: 'MANUAL',
        triggerEventId: null,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        status: 'SUCCEEDED',
        currentStepIndex: version.steps.length,
        context: {
          ...input.triggerPayload,
          simulation: true,
          stepsCount: version.steps.length,
        },
        dryRun: true,
        workerId: 'simulation_runner',
        leaseExpiresAt: null,
        errorCode: null,
        errorMessage: null,
        idempotencyKey: null,
        correlationId: ctx.correlationId,
        causationId: null,
        chainDepth: 0,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return res.json({
        executionId: simulatedExec.id,
        status: simulatedExec.status,
        execution: simulatedExec,
        simulation: true,
        replayed: false,
      });
    }

    // 2. Normal execution mode
    const { execution, replayed } = await engine.createExecution(ctx, {
      tenantId: ctx.principal.tenantId,
      definitionId,
      versionId: '', // Resolved by pinned version
      triggerType: 'MANUAL',
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      context: input.triggerPayload,
      correlationId: ctx.correlationId,
      idempotencyKey: idempotencyKey || null,
      dryRun: false,
    });

    if (replayed) {
      res.setHeader('Idempotent-Replayed', 'true');
      return res.json({ executionId: execution.id, status: execution.status, execution, replayed: true });
    }

    // Claim and execute steps immediately
    const executed = await engine.claimAndRun(ctx, execution.id);

    const result = executed || execution;
    res.status(200).json({ executionId: result.id, status: result.status, execution: result, replayed: false });
  });

  return router;
}
