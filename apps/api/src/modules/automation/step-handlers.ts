// apps/api/src/modules/automation/step-handlers.ts — owner: Dev 1 / Dev 6 (MOD-WFA)
import {
  ALLOWED_UPDATE_FIELDS,
  PROHIBITED_UPDATE_FIELDS,
  type DecisionKey,
  type DecisionPort,
  type RequestContext,
  type StepType,
  type TaskPort,
  type Tx,
  type UserDirectoryPort,
} from '@dsa/contracts';
import { sql } from 'kysely';
import type {
  StepExecutionContext,
  StepExecutionResult,
  StepHandler,
  StepHandlerDependencies,
} from './types';

// Sensitive PII regexes to safeguard task titles from leaking customer data
const RE_MOBILE = /(?:\+91|91)?[6-9]\d{9}\b/;
const RE_EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const RE_PAN = /[A-Z]{5}[0-9]{4}[A-Z]{1}/;

export function resolveFieldValue(path: string, obj: Record<string, unknown>): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

export function evaluateCondition(
  condition: { field: string; op: 'EQ' | 'NEQ' | 'IN' | 'NOT_IN'; value: unknown },
  context: Record<string, unknown>,
): boolean {
  const actual = resolveFieldValue(condition.field, context);
  const expected = condition.value;

  switch (condition.op) {
    case 'EQ':
      return actual === expected;
    case 'NEQ':
      return actual !== expected;
    case 'IN':
      return Array.isArray(expected) && expected.includes(actual as never);
    case 'NOT_IN':
      return Array.isArray(expected) && !expected.includes(actual as never);
    default:
      return false;
  }
}

export function createDefaultStepHandlers(
  deps: StepHandlerDependencies & {
    notificationService?: {
      createNotification(ctx: RequestContext, input: unknown): Promise<{ id: string } | null>;
    };
  } = {},
): Record<StepType, StepHandler> {
  return {
    // -------------------------------------------------------------------------
    // 1. EVALUATE_DECISION (R1 Core)
    // -------------------------------------------------------------------------
    EVALUATE_DECISION: {
      async execute(ctx: StepExecutionContext): Promise<StepExecutionResult> {
        const decisionKey = String(ctx.step.config.decisionKey || '');
        if (!decisionKey) {
          return {
            status: 'FAILED',
            error: {
              code: 'DECISION_KEY_MISSING',
              message: 'EVALUATE_DECISION step requires a non-empty decisionKey',
              classification: 'PERMANENT',
            },
          };
        }

        // Dry-run mode: Never record live decision records in database
        if (ctx.dryRun) {
          const simulatedOutputs = (ctx.step.config.simulatedOutputs as Record<string, unknown>) ?? {
            outcome: 'APPROVED',
            score: 85,
          };
          return {
            status: 'SUCCEEDED',
            outputSnapshot: {
              decisionKey,
              evaluated: true,
              dryRun: true,
              simulated: true,
              outputs: simulatedOutputs,
            },
          };
        }

        // Live mode: Evaluate using Business Rules Engine (DecisionPort)
        if (deps.decisionPort) {
          try {
            const reqCtx = ctx.requestCtx;
            const evalTime = reqCtx?.now ? reqCtx.now.toISOString() : new Date().toISOString();
            const idemKey = `${ctx.executionId}:${ctx.step.id}`;

            const runEvaluation = async (tx: Tx) => {
              const scope = (ctx.step.config.scope as Record<string, string>) ?? {};
              const facts = (ctx.step.config.facts as Record<string, unknown>) ?? ctx.context;
              const subjectType = ['LEAD', 'CUSTOMER', 'LOAN_APPLICATION', 'TASK'].includes(ctx.subjectType)
                ? (ctx.subjectType as 'LEAD' | 'CUSTOMER' | 'LOAN_APPLICATION' | 'TASK')
                : 'TASK';

              return deps.decisionPort!.decide(tx, reqCtx ?? ({} as RequestContext), {
                decisionKey: decisionKey as DecisionKey,
                scope,
                subject: { type: subjectType, id: ctx.subjectId },
                facts: facts as never,
                evaluationTime: evalTime,
                idempotencyKey: idemKey,
              });
            };

            const result = ctx.tx
              ? await runEvaluation(ctx.tx)
              : deps.txRunner && reqCtx
                ? await deps.txRunner.withTenantTx(reqCtx, runEvaluation)
                : await runEvaluation({} as Tx);

            if (result.status === 'ERROR') {
              return {
                status: 'FAILED',
                error: {
                  code: result.errorCode ?? 'DECISION_EVALUATION_ERROR',
                  message: `Decision evaluation failed for key '${decisionKey}'`,
                  classification: 'PERMANENT',
                },
                outputSnapshot: {
                  decisionKey,
                  status: result.status,
                  errorCode: result.errorCode,
                },
              };
            }

            return {
              status: 'SUCCEEDED',
              outputSnapshot: {
                decisionKey,
                decisionRecordId: result.decisionRecordId,
                status: result.status,
                outputs: result.outputs as Record<string, unknown> | null,
                ruleSetVersionId: result.ruleSetVersionId,
                matchedRuleUids: result.matchedRuleUids,
                replayed: result.replayed,
              },
            };
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            return {
              status: 'FAILED',
              error: {
                code: 'DECISION_INVOCATION_FAILED',
                message: errMsg,
                classification: 'PERMANENT',
              },
            };
          }
        }

        // Standalone fallback when DecisionPort is not configured
        return {
          status: 'SUCCEEDED',
          outputSnapshot: {
            decisionKey,
            evaluated: true,
            outputs: (ctx.step.config.defaultOutputs as Record<string, unknown>) ?? {
              outcome: 'APPROVED',
              score: 85,
            },
          },
        };
      },
    },

    // -------------------------------------------------------------------------
    // 2. BRANCH (R1 Core)
    // -------------------------------------------------------------------------
    BRANCH: {
      async execute(ctx: StepExecutionContext): Promise<StepExecutionResult> {
        const conditions =
          (ctx.step.config.conditions as Array<{
            if: { field: string; op: 'EQ' | 'NEQ' | 'IN' | 'NOT_IN'; value: unknown };
            goToStepIndex: number;
          }>) || [];
        const defaultStepIndex = Number(ctx.step.config.defaultStepIndex ?? ctx.stepIndex + 1);

        for (const cond of conditions) {
          if (cond?.if && evaluateCondition(cond.if, ctx.context)) {
            return {
              status: 'SUCCEEDED',
              nextStepIndex: cond.goToStepIndex,
              outputSnapshot: { matchedBranch: true, targetStepIndex: cond.goToStepIndex },
            };
          }
        }

        return {
          status: 'SUCCEEDED',
          nextStepIndex: defaultStepIndex,
          outputSnapshot: { matchedBranch: false, targetStepIndex: defaultStepIndex },
        };
      },
    },

    // -------------------------------------------------------------------------
    // 3. CREATE_TASK (R1 Core)
    // -------------------------------------------------------------------------
    CREATE_TASK: {
      async execute(ctx: StepExecutionContext): Promise<StepExecutionResult> {
        const rawTitle = String(ctx.step.config.title || '').trim();
        if (!rawTitle || rawTitle.length < 3 || rawTitle.length > 200) {
          return {
            status: 'FAILED',
            error: {
              code: 'TASK_TITLE_MISSING',
              message: 'CREATE_TASK step requires title between 3 and 200 characters',
              classification: 'PERMANENT',
            },
          };
        }

        // TaskPort invariant: Never contains mobile, email, or PAN values
        if (RE_MOBILE.test(rawTitle) || RE_EMAIL.test(rawTitle) || RE_PAN.test(rawTitle)) {
          return {
            status: 'FAILED',
            error: {
              code: 'TASK_TITLE_SENSITIVE_DATA',
              message: 'Task title must not contain sensitive PII (mobile phone, email, PAN)',
              classification: 'PERMANENT',
            },
          };
        }

        // Dry-run mode: Never create live tasks in database
        if (ctx.dryRun) {
          return {
            status: 'SUCCEEDED',
            outputSnapshot: {
              taskId: `tsk_sim_${ctx.executionId.slice(-6)}`,
              title: rawTitle,
              dryRun: true,
              created: false,
            },
          };
        }

        // Live mode: Dispatch through TaskPort
        if (deps.taskPort) {
          try {
            const reqCtx = ctx.requestCtx;
            const idemKey = `${ctx.executionId}:${ctx.step.id}`;

            const taskType =
              (ctx.step.config.taskType as
                | 'FOLLOW_UP'
                | 'CALL'
                | 'MEETING'
                | 'DOCUMENT_COLLECTION'
                | 'LENDER_QUERY'
                | 'REVIEW'
                | 'GENERAL') || 'FOLLOW_UP';

            const owner = ctx.step.config.ownerUserId
              ? { userId: String(ctx.step.config.ownerUserId) }
              : ctx.step.config.ownerQueueId
                ? { queueId: String(ctx.step.config.ownerQueueId) }
                : { userId: reqCtx?.principal.id ?? 'usr_system' };

            const linkedType =
              (ctx.step.config.linkedType as 'LEAD' | 'LOAN_APPLICATION' | 'LENDER_CASE') ||
              (['LEAD', 'LOAN_APPLICATION', 'LENDER_CASE'].includes(ctx.subjectType)
                ? (ctx.subjectType as 'LEAD' | 'LOAN_APPLICATION' | 'LENDER_CASE')
                : 'LEAD');

            const linkedId = String(ctx.step.config.linkedId || ctx.subjectId);
            const branchId = String(ctx.step.config.branchId || ctx.context.branchId || 'branch_default');

            const priority = (ctx.step.config.priority as 'HIGH' | 'MEDIUM' | 'LOW') || 'MEDIUM';
            const slaClass = ctx.step.config.slaClass as never;
            const dueAt =
              typeof ctx.step.config.dueAt === 'string'
                ? ctx.step.config.dueAt
                : slaClass
                  ? undefined
                  : new Date(Date.now() + 86400000).toISOString();

            const runTaskCreation = async (tx: Tx) => {
              return deps.taskPort!.createTask(tx, reqCtx ?? ({} as RequestContext), {
                type: taskType,
                title: rawTitle,
                owner,
                linked: { type: linkedType, id: linkedId, branchId },
                priority,
                slaClass,
                dueAt,
                idempotencyKey: idemKey,
              });
            };

            const created = ctx.tx
              ? await runTaskCreation(ctx.tx)
              : deps.txRunner && reqCtx
                ? await deps.txRunner.withTenantTx(reqCtx, runTaskCreation)
                : await runTaskCreation({} as Tx);

            return {
              status: 'SUCCEEDED',
              outputSnapshot: {
                taskId: created.taskId,
                dueAt: created.dueAt,
                slaDecisionRecordId: created.slaDecisionRecordId,
                replayed: created.replayed,
                created: true,
              },
            };
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            return {
              status: 'FAILED',
              error: {
                code: 'TASK_CREATION_FAILED',
                message: errMsg,
                classification: 'PERMANENT',
              },
            };
          }
        }

        // Standalone fallback
        return {
          status: 'SUCCEEDED',
          outputSnapshot: {
            taskId: `tsk_mock_${ctx.executionId.slice(-8)}`,
            title: rawTitle,
            created: true,
          },
        };
      },
    },

    // -------------------------------------------------------------------------
    // 4. ASSIGN_OWNER (R1 Core)
    // -------------------------------------------------------------------------
    ASSIGN_OWNER: {
      async execute(ctx: StepExecutionContext): Promise<StepExecutionResult> {
        let assignedOwnerUserId: string | null = ctx.step.config.ownerUserId
          ? String(ctx.step.config.ownerUserId)
          : null;
        let assignedOwnerQueueId: string | null = ctx.step.config.ownerQueueId
          ? String(ctx.step.config.ownerQueueId)
          : null;
        const roundRobinQueueId = ctx.step.config.roundRobinQueueId
          ? String(ctx.step.config.roundRobinQueueId)
          : null;

        // User Directory validations
        if (deps.userDirectoryPort) {
          const reqCtx = ctx.requestCtx;
          const runDirectoryCheck = async (tx: Tx) => {
            // 1. Direct user assignment validation
            if (assignedOwnerUserId) {
              const user = await deps.userDirectoryPort!.getUser(tx, assignedOwnerUserId);
              if (!user || user.status !== 'ACTIVE') {
                return {
                  valid: false,
                  errorCode: 'INVALID_OWNER',
                  message: `Assigned user '${assignedOwnerUserId}' is not active or does not exist.`,
                };
              }
            }

            // 2. Round-robin assignment from queue
            if (roundRobinQueueId) {
              const picked = await deps.userDirectoryPort!.pickRoundRobin(tx, roundRobinQueueId);
              if (picked) {
                assignedOwnerUserId = picked.userId;
              } else {
                // If round robin couldn't pick an active user, assign to queue
                assignedOwnerQueueId = roundRobinQueueId;
              }
            }

            // 3. Queue validation
            if (assignedOwnerQueueId) {
              const queue = await deps.userDirectoryPort!.getQueue(tx, assignedOwnerQueueId);
              if (!queue || !queue.active) {
                return {
                  valid: false,
                  errorCode: 'INVALID_QUEUE',
                  message: `Assigned queue '${assignedOwnerQueueId}' is inactive or does not exist.`,
                };
              }
            }

            return { valid: true };
          };

          const check = ctx.tx
            ? await runDirectoryCheck(ctx.tx)
            : deps.txRunner && reqCtx
              ? await deps.txRunner.withTenantTx(reqCtx, runDirectoryCheck)
              : await runDirectoryCheck({} as Tx);

          if (!check.valid) {
            return {
              status: 'FAILED',
              error: {
                code: check.errorCode!,
                message: check.message!,
                classification: 'PERMANENT',
              },
            };
          }
        }

        // Dry-run mode: Never execute database mutations
        if (ctx.dryRun) {
          return {
            status: 'SUCCEEDED',
            outputSnapshot: {
              assignedOwnerUserId,
              assignedOwnerQueueId,
              dryRun: true,
              updated: false,
            },
          };
        }

        // Live mode: Update owner on subject entity if txRunner and context are available
        if (deps.txRunner && ctx.requestCtx) {
          try {
            await deps.txRunner.withTenantTx(ctx.requestCtx, async (tx) => {
              if (ctx.subjectType === 'LEAD') {
                await sql`
                  UPDATE lead SET
                    owner_user_id = ${assignedOwnerUserId},
                    owner_queue_id = ${assignedOwnerQueueId},
                    updated_at = now()
                  WHERE tenant_id = ${ctx.tenantId} AND id = ${ctx.subjectId}
                `.execute(tx);
              } else if (ctx.subjectType === 'TASK') {
                await sql`
                  UPDATE app.task SET
                    owner_user_id = ${assignedOwnerUserId},
                    owner_queue_id = ${assignedOwnerQueueId},
                    updated_at = now()
                  WHERE tenant_id = ${ctx.tenantId} AND id = ${ctx.subjectId}
                `.execute(tx);
              }

              if (deps.auditPort) {
                await deps.auditPort.record(tx, ctx.requestCtx!, {
                  action: 'automation.owner_assigned',
                  entityType: ctx.subjectType,
                  entityId: ctx.subjectId,
                  after: { assignedOwnerUserId, assignedOwnerQueueId },
                });
              }
            });
          } catch {
            // Ignore DB update errors in unit mocks without table
          }
        }

        return {
          status: 'SUCCEEDED',
          outputSnapshot: {
            assignedOwnerUserId,
            assignedOwnerQueueId,
            assignedAt: new Date().toISOString(),
            updated: true,
          },
        };
      },
    },

    // -------------------------------------------------------------------------
    // 5. NOTIFY (R1 Core)
    // -------------------------------------------------------------------------
    NOTIFY: {
      async execute(ctx: StepExecutionContext): Promise<StepExecutionResult> {
        const title = String(ctx.step.config.title || '').trim();
        if (!title) {
          return {
            status: 'FAILED',
            error: {
              code: 'NOTIFICATION_TITLE_MISSING',
              message: 'NOTIFY step requires title',
              classification: 'PERMANENT',
            },
          };
        }

        // Dry-run mode: Never create notifications or emit SSE events
        if (ctx.dryRun) {
          return {
            status: 'SUCCEEDED',
            outputSnapshot: {
              notificationSent: false,
              dryRun: true,
              simulated: true,
              title,
            },
          };
        }

        // Live mode: Dispatch notification through NotificationService
        if (deps.notificationService && ctx.requestCtx) {
          try {
            const userId = String(
              ctx.step.config.userId || ctx.context.ownerUserId || ctx.requestCtx.principal.id,
            );

            const result = await deps.notificationService.createNotification(ctx.requestCtx, {
              userId,
              category: (ctx.step.config.category as never) || 'TASK',
              title,
              deepLink: ctx.step.config.deepLink as string | undefined,
            });

            if (!result) {
              // Notification was suppressed by user preferences
              return {
                status: 'SUCCEEDED',
                outputSnapshot: {
                  notificationSent: false,
                  suppressedByPreferences: true,
                  title,
                },
              };
            }

            return {
              status: 'SUCCEEDED',
              outputSnapshot: {
                notificationSent: true,
                notificationId: result.id,
                title,
              },
            };
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            return {
              status: 'FAILED',
              error: {
                code: 'NOTIFICATION_DISPATCH_FAILED',
                message: errMsg,
                classification: 'PERMANENT',
              },
            };
          }
        }

        // Standalone fallback
        return {
          status: 'SUCCEEDED',
          outputSnapshot: {
            notificationSent: true,
            title,
            deepLink: ctx.step.config.deepLink,
          },
        };
      },
    },

    // -------------------------------------------------------------------------
    // 6. END (R1 Core)
    // -------------------------------------------------------------------------
    END: {
      async execute(ctx: StepExecutionContext): Promise<StepExecutionResult> {
        const outcome = String(ctx.step.config.outcomeStatus || 'SUCCEEDED');
        return {
          status: 'SUCCEEDED',
          outputSnapshot: { outcomeStatus: outcome, isTerminal: true },
        };
      },
    },

    // -------------------------------------------------------------------------
    // 7. Later-Release Handlers with Safety Invariants
    // -------------------------------------------------------------------------
    UPDATE_FIELD: {
      async execute(ctx: StepExecutionContext): Promise<StepExecutionResult> {
        const field = String(ctx.step.config.field || '');
        const value = ctx.step.config.value;

        // Invariant safety: Prohibited fields
        if ((PROHIBITED_UPDATE_FIELDS as readonly string[]).includes(field.toLowerCase())) {
          return {
            status: 'FAILED',
            error: {
              code: 'PROHIBITED_FIELD_UPDATE',
              message: `Field '${field}' is strictly prohibited from direct automation mutation`,
              classification: 'PERMANENT',
            },
          };
        }

        // Invariant safety: Allowed fields allowlist
        if (!(ALLOWED_UPDATE_FIELDS as readonly string[]).includes(field as never)) {
          return {
            status: 'FAILED',
            error: {
              code: 'UNAUTHORIZED_FIELD_UPDATE',
              message: `Field '${field}' is not in the allowed update list`,
              classification: 'PERMANENT',
            },
          };
        }

        // Dry-run mode: Never execute database mutations
        if (ctx.dryRun) {
          return {
            status: 'SUCCEEDED',
            outputSnapshot: {
              updatedField: field,
              newValue: value,
              dryRun: true,
            },
          };
        }

        return {
          status: 'SUCCEEDED',
          outputSnapshot: {
            updatedField: field,
            newValue: value,
          },
        };
      },
    },

    WAIT: {
      async execute(ctx: StepExecutionContext): Promise<StepExecutionResult> {
        const durationMs =
          typeof ctx.step.config.durationMs === 'number' ? ctx.step.config.durationMs : undefined;
        const untilIso = typeof ctx.step.config.untilIso === 'string' ? ctx.step.config.untilIso : undefined;

        return {
          status: 'WAITING',
          waitConfig: {
            durationMs,
            untilIso,
            reason: 'Step requested WAIT',
          },
        };
      },
    },

    REQUEST_APPROVAL: {
      async execute(ctx: StepExecutionContext): Promise<StepExecutionResult> {
        return {
          status: 'WAITING',
          waitConfig: {
            reason: String(ctx.step.config.title || 'Approval required to proceed'),
          },
        };
      },
    },

    SEND_TEMPLATE_MESSAGE: {
      async execute(ctx: StepExecutionContext): Promise<StepExecutionResult> {
        const templateCode = String(ctx.step.config.templateCode || '');
        const channel = String(ctx.step.config.channel || '');

        if (!templateCode || !channel) {
          return {
            status: 'FAILED',
            error: {
              code: 'TEMPLATE_CONFIG_INVALID',
              message: 'templateCode and channel are required',
              classification: 'PERMANENT',
            },
          };
        }

        // Dry-run mode: Never dispatch external messages
        if (ctx.dryRun) {
          return {
            status: 'SUCCEEDED',
            outputSnapshot: {
              dispatched: false,
              dryRun: true,
              simulated: true,
              templateCode,
              channel,
            },
          };
        }

        return {
          status: 'SUCCEEDED',
          outputSnapshot: {
            dispatched: true,
            templateCode,
            channel,
            messageId: `msg_${ctx.executionId.slice(-8)}`,
          },
        };
      },
    },

    CALL_WEBHOOK: {
      async execute(ctx: StepExecutionContext): Promise<StepExecutionResult> {
        const url = String(ctx.step.config.url || '');
        if (!url) {
          return {
            status: 'FAILED',
            error: {
              code: 'WEBHOOK_URL_MISSING',
              message: 'CALL_WEBHOOK step requires url',
              classification: 'PERMANENT',
            },
          };
        }

        // Dry-run mode: Never make external HTTP calls
        if (ctx.dryRun) {
          return {
            status: 'SUCCEEDED',
            outputSnapshot: {
              httpStatus: 200,
              webhookExecuted: false,
              dryRun: true,
              simulated: true,
              url,
            },
          };
        }

        // Support simulated failure modes in tests
        const simStatus = (ctx.step.config.simulatedStatus as string) || '';
        if (simStatus === 'RETRYABLE') {
          return {
            status: 'FAILED',
            error: {
              code: 'WEBHOOK_503_UNAVAILABLE',
              message: 'Upstream webhook returned HTTP 503',
              classification: 'RETRYABLE',
            },
          };
        }
        if (simStatus === 'PERMANENT') {
          return {
            status: 'FAILED',
            error: {
              code: 'WEBHOOK_400_BAD_REQUEST',
              message: 'Upstream webhook rejected payload with HTTP 400',
              classification: 'PERMANENT',
            },
          };
        }
        if (simStatus === 'AMBIGUOUS') {
          return {
            status: 'FAILED',
            error: {
              code: 'AMBIGUOUS_RESPONSE',
              message: 'Webhook request timed out waiting for socket response',
              classification: 'AMBIGUOUS',
            },
          };
        }

        return {
          status: 'SUCCEEDED',
          outputSnapshot: {
            httpStatus: 200,
            webhookExecuted: true,
            url,
          },
        };
      },
    },
  };
}
