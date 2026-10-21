// MOD-WFA operations at the paths the module page names (owner: Dev 6; DSA Notion MODULE 24). They share the logic of the
// /automations/... routes in router.ts:
//   API-WFA-004 POST /v1/automation-versions/{id}/dry-runs        automation.manage; no side effects
//   API-WFA-005 POST /v1/automation-versions/{id}/approval        automation.approve; independent approver (SOD)
//   API-WFA-006 POST /v1/automation-versions/{id}/enable          automation.manage; enable or disable, with a reason
//   API-WFA-007 GET  /v1/automation-executions                    automation.read; newest first
//   API-WFA-008 POST /v1/automation-executions/{id}/interventions automation.operate; Idempotency-Key; RETRY, SKIP or CANCEL
// The older permission codes (automation.author, automation.operator) are accepted alongside the spec codes.
import {
  AppError,
  ReviewVersionActionSchema,
  type PermissionCode,
  type RequestContext,
} from '@dsa/contracts';
import type { Router } from 'express';
import { z } from 'zod';
import { idempotencyKey, requireCtx } from '../../http/request';
import type { ApiDeps } from '../types';
import type { AutomationEngine } from './engine';
import type { AutomationRepository } from './repository';
import { reviewAutomationVersion } from './router';

const NO_S3 = [/[A-Z]{5}[0-9]{4}[A-Z]/i, /\b\d{4}\s?\d{4}\s?\d{4}\b/, /\b\d{9,18}\b/];
const Reason = z
  .string()
  .trim()
  .min(3)
  .max(500)
  .refine((s) => !NO_S3.some((p) => p.test(s)), 'must not contain identity or account numbers');

export const AutomationEnable = z.object({ enabled: z.boolean(), reason: Reason }).strict();
export const AutomationDryRun = z
  .object({
    subjectType: z.string().min(2).max(40),
    subjectId: z.string().min(3).max(64),
    triggerPayload: z.record(z.unknown()).default({}),
  })
  .strict();
export const AutomationIntervention = z
  .object({
    action: z.enum(['RETRY', 'SKIP', 'CANCEL']),
    reason: Reason,
    /** For SKIP: the step to skip; default the current step. */
    stepIndex: z.number().int().min(0).optional(),
  })
  .strict();
export const AutomationExecutionQuery = z.object({
  definitionId: z.string().optional(),
  status: z.string().optional(),
  subjectId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

function requireAny(ctx: RequestContext, codes: PermissionCode[]): void {
  if (!ctx.principal.grants.some((g) => codes.includes(g.code))) {
    throw AppError.of('FORBIDDEN', `Permission denied: ${codes.join(' or ')} required.`);
  }
}

export function registerAutomationSpecRoutes(
  router: Router,
  deps: ApiDeps,
  repository: AutomationRepository,
  engine: AutomationEngine,
): void {
  // API-WFA-005
  router.post('/automation-versions/:id/approval', async (req, res) => {
    const ctx = requireCtx(req);
    requireAny(ctx, ['automation.approve']);
    const input = ReviewVersionActionSchema.parse(req.body);
    const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const ver = await repository.getVersionById(tx, ctx.principal.tenantId, req.params.id);
      return reviewAutomationVersion(
        deps,
        repository,
        tx,
        ctx,
        ver.definitionId,
        ver.id,
        input.action,
        input.reason,
      );
    });
    res.json(result);
  });

  // API-WFA-006
  router.post('/automation-versions/:id/enable', async (req, res) => {
    const ctx = requireCtx(req);
    requireAny(ctx, ['automation.manage', 'automation.author']);
    const input = AutomationEnable.parse(req.body);
    const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const ver = await repository.getVersionById(tx, ctx.principal.tenantId, req.params.id);
      const def = await repository.getDefinitionById(tx, ctx.principal.tenantId, ver.definitionId);
      if (def.isSystem) throw AppError.of('FORBIDDEN', 'System automations cannot be enabled or disabled.');
      if (ver.status !== 'ACTIVE' || def.pinnedVersionId !== ver.id) {
        throw AppError.of(
          'INVALID_STATE',
          'Only the approved, pinned version of an automation can be enabled or disabled.',
        );
      }
      const status = input.enabled ? 'ACTIVE' : 'INACTIVE';
      const updated =
        def.status === status
          ? def
          : await repository.updateDefinition(tx, ctx.principal.tenantId, def.id, {
              status,
              updatedBy: ctx.principal.id,
            });
      await deps.audit.record(tx, ctx, {
        action: input.enabled ? 'automation.enabled' : 'automation.disabled',
        entityType: 'AUTOMATION_DEFINITION',
        entityId: def.id,
        before: { status: def.status },
        after: { status, versionId: ver.id },
        reason: input.reason,
        permissionUsed: 'automation.manage',
      });
      return updated;
    });
    res.setHeader('ETag', `"${result.lockVersion}"`);
    res.json(result);
  });

  // API-WFA-004
  router.post('/automation-versions/:id/dry-runs', async (req, res) => {
    const ctx = requireCtx(req);
    requireAny(ctx, ['automation.manage', 'automation.author', 'automation.execute']);
    const input = AutomationDryRun.parse(req.body);
    // Reads only: the version's steps are listed in the order they would run; nothing is executed or written.
    const ver = await deps.txRunner.withTenantTx(ctx, (tx) =>
      repository.getVersionById(tx, ctx.principal.tenantId, req.params.id),
    );
    res.json({
      simulation: true,
      versionId: ver.id,
      definitionId: ver.definitionId,
      subject: { type: input.subjectType, id: input.subjectId },
      steps: ver.steps.map((s, index) => ({
        index,
        type: (s as { type?: string }).type ?? 'UNKNOWN',
        wouldRun: true,
      })),
      sideEffects: [],
    });
  });

  // API-WFA-007
  router.get('/automation-executions', async (req, res) => {
    const ctx = requireCtx(req);
    requireAny(ctx, ['automation.read']);
    const q = AutomationExecutionQuery.parse(req.query);
    const data = await deps.txRunner.withTenantTx(ctx, (tx) =>
      repository.listExecutions(tx, ctx.principal.tenantId, q),
    );
    res.json({ data, meta: { nextCursor: null, limit: q.limit } });
  });

  // API-WFA-008
  router.post('/automation-executions/:id/interventions', async (req, res) => {
    const ctx = requireCtx(req);
    requireAny(ctx, ['automation.operate', 'automation.operator']);
    idempotencyKey(req);
    const input = AutomationIntervention.parse(req.body);
    const id = req.params.id;
    if (input.action === 'CANCEL') {
      res.json(await engine.cancelExecution(ctx, id, input.reason));
      return;
    }
    if (input.action === 'RETRY') {
      res.json(await engine.resumeExecution(ctx, id, { retryReason: input.reason }));
      return;
    }
    const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const exec = await repository.getExecutionById(tx, ctx.principal.tenantId, id);
      const stepIndex = input.stepIndex ?? exec.currentStepIndex;
      const step = await repository.getStepExecution(tx, ctx.principal.tenantId, id, stepIndex);
      if (!step) throw AppError.of('NOT_FOUND', `Step execution at index ${stepIndex} not found.`);
      const stepExecution = await repository.updateStepExecution(tx, ctx.principal.tenantId, step.id, {
        status: 'SKIPPED',
        skipReason: input.reason,
        skippedBy: ctx.principal.id,
        completedAt: ctx.now.toISOString(),
      });
      const execution = await repository.updateExecutionByOperator(tx, ctx.principal.tenantId, exec.id, {
        status: exec.status === 'DEAD_LETTERED' ? 'RUNNING' : exec.status,
        currentStepIndex: Math.max(exec.currentStepIndex, stepIndex + 1),
      });
      await deps.audit.record(tx, ctx, {
        action: 'automation.step_skipped',
        entityType: 'AUTOMATION_STEP_EXECUTION',
        entityId: step.id,
        reason: input.reason,
        after: { executionId: id, stepIndex, status: 'SKIPPED' },
        permissionUsed: 'automation.operate',
      });
      return { stepExecution, execution };
    });
    res.json(result);
  });
}
