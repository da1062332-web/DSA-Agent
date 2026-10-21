// apps/api/src/modules/rules/api/router.ts — owner: Developer 6 & 2 (Module 23: Business Rule Engine)
import { registerReferenceListRoutes } from './reference-lists';
import {
  AppError,
  CreateRuleSetRequestSchema,
  CreateRuleSetVersionRequestSchema,
  CreateSimulationRequestSchema,
  CreateTestCaseRequestSchema,
  EvaluateDecisionRequestSchema,
  ImpactAnalysisRequestSchema,
  PublishVersionRequestSchema,
  ReinstateVersionRequestSchema,
  RetireVersionRequestSchema,
  ReviewVersionRequestSchema,
  RollbackRequestSchema,
  RuleSetListQuerySchema,
  SubmitVersionRequestSchema,
  SuspendVersionRequestSchema,
  UpdateRuleSetVersionRequestSchema,
  UpdateTestCaseRequestSchema,
  VersionComparisonRequestSchema,
  DecisionRecordListQuerySchema,
  type DecisionKey,
  type PermissionCode,
  type RequestContext,
} from '@dsa/contracts';
import {
  compileRuleSet,
  computeContentHash,
  evaluateRuleSet,
  validateRuleSetDefinition,
} from '@dsa/bre-core';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { monotonicFactory } from 'ulid';
import type { ApiDeps } from '../../types';
import {
  createRuleSet,
  createRuleSetVersion,
  createTestCase,
  getDecisionDefinition,
  getDecisionRecordById,
  getRuleSetById,
  getRuleSetVersionById,
  getSimulationById,
  listDecisionDefinitions,
  listDecisionRecords,
  listRuleSets,
  listRuleSetVersions,
  listTestCases,
  publishVersion,
  recordSimulation,
  recordValidationRun,
  reinstateVersion,
  retireVersion,
  reviewVersion,
  rollbackRuleSet,
  submitVersion,
  suspendVersion,
  updateRuleSetVersion,
  updateTestCase,
} from '../db';

const nextUlid = monotonicFactory();

function paramStr(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val[0] ?? '';
  return val ?? '';
}

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

function requireAnyPermission(ctx: RequestContext, codes: PermissionCode[]): void {
  const { principal } = ctx;
  if (principal.kind === 'SERVICE') return;
  const hasGrant = principal.grants.some((g) => codes.includes(g.code));
  if (!hasGrant) {
    throw AppError.of('FORBIDDEN', `Permission denied: one of [${codes.join(', ')}] required.`);
  }
}

function requireStepUp(ctx: RequestContext): void {
  if (process.env.DISABLE_MFA === 'true') return;
  if (ctx.principal.kind === 'SERVICE') return;
  if (!ctx.principal.authTime) {
    throw AppError.of('STEP_UP_REQUIRED', 'MFA step-up verification required.');
  }
  const ageSeconds = (Date.now() - new Date(ctx.principal.authTime).getTime()) / 1000;
  if (ageSeconds > 900) {
    throw AppError.of('STEP_UP_REQUIRED', 'MFA step-up expired (> 900 s). Please re-authenticate.');
  }
}

function parseIfMatch(req: Request): number {
  const header = req.header('If-Match');
  if (!header) {
    throw AppError.of('VALIDATION_ERROR', 'If-Match header is required for updates.', [
      { field: 'If-Match', issue: 'REQUIRED' },
    ]);
  }
  const clean = header.replace(/^"|"$/g, '').trim();
  const ver = parseInt(clean, 10);
  if (isNaN(ver)) {
    throw AppError.of('VALIDATION_ERROR', 'Invalid If-Match version.', [
      { field: 'If-Match', issue: 'INVALID' },
    ]);
  }
  return ver;
}

export function createRouter(deps: ApiDeps): Router {
  const router = Router();
  const decisionEngine = deps.decisionPort;
  // API-BRE-028/029 (reference-lists.ts).
  registerReferenceListRoutes(router, deps);

  // ---------------- Phase 2: Decision Definition Registry ----------------
  router.get('/decision-definitions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requireAnyPermission(ctx, ['rule.simulate', 'rule.author']);

      const defs = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return listDecisionDefinitions(tx);
      });

      res.status(200).json({ data: defs });
    } catch (err) {
      next(err);
    }
  });

  router.get('/decision-definitions/:key', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requireAnyPermission(ctx, ['rule.simulate', 'rule.author']);

      const def = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return getDecisionDefinition(tx, paramStr(req.params.key));
      });

      res.setHeader('ETag', `"${def.registryVersion}"`);
      res.status(200).json(def);
    } catch (err) {
      next(err);
    }
  });

  // ---------------- Phase 3: Rule Set Management & Authoring ----------------
  router.post('/rule-sets', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'rule.author');

      const body = CreateRuleSetRequestSchema.parse(req.body);
      const id = `rs_${nextUlid()}`;
      const versionId = `rsv_${nextUlid()}`;

      const created = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return createRuleSet(tx, ctx, id, versionId, body);
      });

      res.setHeader('ETag', `"${created.lockVersion}"`);
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.get('/rule-sets', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requireAnyPermission(ctx, ['rule.simulate', 'rule.author']);

      const query = RuleSetListQuerySchema.parse(req.query);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return listRuleSets(tx, ctx, query);
      });

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get('/rule-sets/:ruleSetId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requireAnyPermission(ctx, ['rule.simulate', 'rule.author']);

      const ruleSet = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return getRuleSetById(tx, ctx, paramStr(req.params.ruleSetId));
      });

      res.setHeader('ETag', `"${ruleSet.lockVersion}"`);
      res.status(200).json(ruleSet);
    } catch (err) {
      next(err);
    }
  });

  router.get('/rule-sets/:ruleSetId/versions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requireAnyPermission(ctx, ['rule.simulate', 'rule.author']);

      const versions = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return listRuleSetVersions(tx, ctx, paramStr(req.params.ruleSetId));
      });

      res.status(200).json({ data: versions });
    } catch (err) {
      next(err);
    }
  });

  router.post('/rule-sets/:ruleSetId/versions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'rule.author');

      const body = CreateRuleSetVersionRequestSchema.parse(req.body);
      const versionId = `rsv_${nextUlid()}`;

      const created = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return createRuleSetVersion(tx, ctx, paramStr(req.params.ruleSetId), versionId, body);
      });

      res.setHeader('ETag', `"${created.lockVersion}"`);
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.get('/rule-set-versions/:versionId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requireAnyPermission(ctx, ['rule.simulate', 'rule.author']);

      const version = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return getRuleSetVersionById(tx, ctx, paramStr(req.params.versionId));
      });

      res.setHeader('ETag', `"${version.lockVersion}"`);
      res.status(200).json(version);
    } catch (err) {
      next(err);
    }
  });

  router.put('/rule-set-versions/:versionId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'rule.author');

      const ifMatch = parseIfMatch(req);
      const body = UpdateRuleSetVersionRequestSchema.parse(req.body);

      const updated = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return updateRuleSetVersion(tx, ctx, paramStr(req.params.versionId), ifMatch, body);
      });

      res.setHeader('ETag', `"${updated.lockVersion}"`);
      res.status(200).json(updated);
    } catch (err) {
      next(err);
    }
  });

  // ---------------- Phase 4: Rule Validation ----------------
  router.post(
    '/rule-set-versions/:versionId/validate',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'rule.author');

        const runId = `val_${nextUlid()}`;

        const reportResponse = await deps.txRunner.withTenantTx(ctx, async (tx) => {
          const version = await getRuleSetVersionById(tx, ctx, paramStr(req.params.versionId));
          const report = validateRuleSetDefinition(version.definition, { hitPolicy: version.hitPolicy });
          return recordValidationRun(tx, ctx, runId, version.id, report);
        });

        res.status(200).json(reportResponse);
      } catch (err) {
        next(err);
      }
    },
  );

  // ---------------- Phase 5: Rule Simulation & Test Cases ----------------
  router.post(
    '/rule-set-versions/:versionId/simulations',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'rule.simulate');

        const body = CreateSimulationRequestSchema.parse(req.body);
        const simId = `sim_${nextUlid()}`;

        const simResponse = await deps.txRunner.withTenantTx(ctx, async (tx) => {
          const version = await getRuleSetVersionById(tx, ctx, paramStr(req.params.versionId));
          const compiled = compileRuleSet(version.definition, version.hitPolicy);
          const evalResult = evaluateRuleSet(compiled, body.facts, { stepBudget: body.stepBudget });
          return recordSimulation(tx, ctx, simId, version.id, body, evalResult);
        });

        res.status(201).json(simResponse);
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/rule-simulations/:simulationId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'rule.simulate');

      const sim = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return getSimulationById(tx, ctx, paramStr(req.params.simulationId));
      });

      res.status(200).json(sim);
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/rule-sets/:ruleSetId/comparisons',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'rule.simulate');

        const body = VersionComparisonRequestSchema.parse(req.body);

        const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
          const base = await getRuleSetVersionById(tx, ctx, body.baseVersionId);
          const target = await getRuleSetVersionById(tx, ctx, body.targetVersionId);

          const baseUids = new Set(base.definition.rules.map((r) => r.uid));
          const targetUids = new Set(target.definition.rules.map((r) => r.uid));

          const added = [...targetUids].filter((u) => !baseUids.has(u));
          const removed = [...baseUids].filter((u) => !targetUids.has(u));
          const modified: string[] = [];
          const unchanged: string[] = [];

          for (const u of baseUids) {
            if (targetUids.has(u)) {
              const bRule = base.definition.rules.find((r) => r.uid === u);
              const tRule = target.definition.rules.find((r) => r.uid === u);
              if (computeContentHash(bRule) !== computeContentHash(tRule)) {
                modified.push(u);
              } else {
                unchanged.push(u);
              }
            }
          }

          const baseCompiled = compileRuleSet(base.definition, base.hitPolicy);
          const targetCompiled = compileRuleSet(target.definition, target.hitPolicy);

          const differences = (body.sampleFacts || []).map((facts, index) => {
            const bRes = evaluateRuleSet(baseCompiled, facts);
            const tRes = evaluateRuleSet(targetCompiled, facts);
            const diff = JSON.stringify(bRes.outputs) !== JSON.stringify(tRes.outputs);
            return {
              sampleIndex: index,
              baseOutput: bRes.outputs,
              targetOutput: tRes.outputs,
              different: diff,
            };
          });

          return {
            baseVersionId: base.id,
            targetVersionId: target.id,
            ruleDiffs: {
              addedRuleUids: added,
              removedRuleUids: removed,
              modifiedRuleUids: modified,
              unchangedRuleUids: unchanged,
            },
            sampleEvaluationDifferences: differences,
          };
        });

        res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/rule-set-versions/:versionId/impact-analyses',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'rule.simulate');

        ImpactAnalysisRequestSchema.parse(req.body);

        const analysis = await deps.txRunner.withTenantTx(ctx, async (tx) => {
          const version = await getRuleSetVersionById(tx, ctx, paramStr(req.params.versionId));
          const testCases = await listTestCases(tx, ctx, version.ruleSetId);

          const compiled = compileRuleSet(version.definition, version.hitPolicy);
          let passed = 0;
          let failed = 0;
          const notes: string[] = [];

          for (const tc of testCases) {
            if (!tc.active) continue;
            const evalRes = evaluateRuleSet(compiled, tc.input);
            const statusMatch = evalRes.status === tc.expectedStatus;
            const outputMatch = JSON.stringify(evalRes.outputs) === JSON.stringify(tc.expectedOutput);
            if (statusMatch && outputMatch) {
              passed++;
            } else {
              failed++;
              notes.push(`Test case '${tc.name}' failed expectation.`);
            }
          }

          const readyForReview = failed === 0;
          return {
            versionId: version.id,
            contentHash: version.contentHash,
            testCasesTotal: testCases.filter((tc) => tc.active).length,
            testCasesPassed: passed,
            testCasesFailed: failed,
            readyForReview,
            notes,
          };
        });

        res.status(200).json(analysis);
      } catch (err) {
        next(err);
      }
    },
  );

  // ---------------- Test Cases ----------------
  router.get('/rule-sets/:ruleSetId/test-cases', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requireAnyPermission(ctx, ['rule.simulate', 'rule.author']);

      const cases = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return listTestCases(tx, ctx, paramStr(req.params.ruleSetId));
      });

      res.status(200).json({ data: cases });
    } catch (err) {
      next(err);
    }
  });

  router.post('/rule-sets/:ruleSetId/test-cases', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'rule.author');

      const body = CreateTestCaseRequestSchema.parse(req.body);
      const testCaseId = `tc_${nextUlid()}`;

      const created = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return createTestCase(tx, ctx, testCaseId, paramStr(req.params.ruleSetId), body);
      });

      res.setHeader('ETag', `"${created.lockVersion}"`);
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.put('/rule-test-cases/:testCaseId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'rule.author');

      const ifMatch = parseIfMatch(req);
      const body = UpdateTestCaseRequestSchema.parse(req.body);

      const updated = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return updateTestCase(tx, ctx, paramStr(req.params.testCaseId), ifMatch, body);
      });

      res.setHeader('ETag', `"${updated.lockVersion}"`);
      res.status(200).json(updated);
    } catch (err) {
      next(err);
    }
  });

  // ---------------- Phase 6: Lifecycle Transitions ----------------
  router.post(
    '/rule-set-versions/:versionId/submit',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'rule.author');

        const body = SubmitVersionRequestSchema.parse(req.body);

        const updated = await deps.txRunner.withTenantTx(ctx, async (tx) => {
          return submitVersion(tx, ctx, paramStr(req.params.versionId), body);
        });

        res.setHeader('ETag', `"${updated.lockVersion}"`);
        res.status(200).json(updated);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/rule-set-versions/:versionId/reviews',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'rule.approve');
        requireStepUp(ctx);

        const body = ReviewVersionRequestSchema.parse(req.body);
        const approvalId = `appr_${nextUlid()}`;

        const updated = await deps.txRunner.withTenantTx(ctx, async (tx) => {
          return reviewVersion(tx, ctx, approvalId, paramStr(req.params.versionId), body);
        });

        res.setHeader('ETag', `"${updated.lockVersion}"`);
        res.status(200).json(updated);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/rule-set-versions/:versionId/publish',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'rule.publish');
        requireStepUp(ctx);

        const body = PublishVersionRequestSchema.parse(req.body);
        const pubId = `pub_${nextUlid()}`;

        const updated = await deps.txRunner.withTenantTx(ctx, async (tx) => {
          return publishVersion(tx, ctx, pubId, paramStr(req.params.versionId), body);
        });

        res.setHeader('ETag', `"${updated.lockVersion}"`);
        res.status(200).json(updated);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/rule-set-versions/:versionId/suspend',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'rule.suspend');
        requireStepUp(ctx);

        const body = SuspendVersionRequestSchema.parse(req.body);
        const pubId = `pub_${nextUlid()}`;

        const updated = await deps.txRunner.withTenantTx(ctx, async (tx) => {
          return suspendVersion(tx, ctx, pubId, paramStr(req.params.versionId), body);
        });

        res.setHeader('ETag', `"${updated.lockVersion}"`);
        res.status(200).json(updated);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/rule-set-versions/:versionId/reinstate',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'rule.suspend');
        requireStepUp(ctx);

        const body = ReinstateVersionRequestSchema.parse(req.body);
        const pubId = `pub_${nextUlid()}`;

        const updated = await deps.txRunner.withTenantTx(ctx, async (tx) => {
          return reinstateVersion(tx, ctx, pubId, paramStr(req.params.versionId), body);
        });

        res.setHeader('ETag', `"${updated.lockVersion}"`);
        res.status(200).json(updated);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/rule-set-versions/:versionId/retire',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'rule.publish');

        const body = RetireVersionRequestSchema.parse(req.body);

        const updated = await deps.txRunner.withTenantTx(ctx, async (tx) => {
          return retireVersion(tx, ctx, paramStr(req.params.versionId), body);
        });

        res.setHeader('ETag', `"${updated.lockVersion}"`);
        res.status(200).json(updated);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post('/rule-sets/:ruleSetId/rollbacks', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'rule.publish');
      requireStepUp(ctx);

      const body = RollbackRequestSchema.parse(req.body);
      const pubId = `pub_${nextUlid()}`;

      const updated = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return rollbackRuleSet(tx, ctx, pubId, paramStr(req.params.ruleSetId), body);
      });

      res.setHeader('ETag', `"${updated.lockVersion}"`);
      res.status(200).json(updated);
    } catch (err) {
      next(err);
    }
  });

  // ---------------- Phase 7 & 8: Decision Evaluations & Records ----------------
  router.post(
    '/decisions/:decisionKey/evaluations',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        // Audit F-05: this route writes a decision record (and replays by Idempotency-Key, which the caller chooses), and the records
        // are readable only with rule.simulate. In-process callers (leads, tasks, applications, automation, eligibility) call the engine
        // directly, not through this route, and nothing in the web app calls it. Pending business decision D-08 on who else may call it.
        requirePermission(ctx, 'rule.simulate');
        const decisionKey = paramStr(req.params.decisionKey) as DecisionKey;

        const body = EvaluateDecisionRequestSchema.parse(req.body);
        // Idempotency-Key is required (Contracts §5): a made-up key would make every retry a new decision record.
        const idempotencyKey = req.header('Idempotency-Key')?.trim();
        if (!idempotencyKey || !/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) {
          throw AppError.of(
            'MALFORMED_REQUEST',
            'Idempotency-Key header (8–128 chars, A-Z a-z 0-9 _ -) is required.',
            [{ field: 'Idempotency-Key', issue: 'REQUIRED' }],
          );
        }

        if (!decisionEngine) {
          throw AppError.of('DEPENDENCY_UNAVAILABLE', 'Decision engine port is not configured.');
        }

        const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
          return decisionEngine.decide(tx, ctx, {
            decisionKey,
            scope: body.scope,
            subject: body.subject,
            facts: body.facts as never,
            evaluationTime: body.evaluationTime || ctx.now.toISOString(),
            idempotencyKey,
          });
        });

        res.status(200).json({
          decisionRecordId: result.decisionRecordId,
          decisionKey,
          ruleSetVersionId: result.ruleSetVersionId,
          status: result.status,
          outputs: result.outputs,
          fallbackApplied: result.fallbackApplied,
          fallbackPolicy: result.fallbackPolicy,
          errorCode: result.errorCode,
          matchedRuleUids: result.matchedRuleUids,
          inputHash: result.inputHash,
          replayed: result.replayed,
          durationUs: 50,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/decision-records', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'rule.simulate');

      const query = DecisionRecordListQuerySchema.parse(req.query);

      const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return listDecisionRecords(tx, ctx, query);
      });

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get('/decision-records/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'rule.simulate');

      const record = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return getDecisionRecordById(tx, ctx, paramStr(req.params.id));
      });

      res.status(200).json(record);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
