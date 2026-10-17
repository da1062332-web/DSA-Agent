// apps/api/src/modules/automation/scheduler.ts — owner: Dev 1 / Dev 6 (MOD-WFA Phase 6)
import { AppError, type RequestContext, type TxRunner } from '@dsa/contracts';
import type { AutomationEngine } from './engine';
import { AutomationRepository, type ScheduledTrigger } from './repository';

export interface SchedulerServiceDependencies {
  txRunner: TxRunner;
  engine: AutomationEngine;
  repository?: AutomationRepository;
  defaultTimezone?: string; // default: 'Asia/Kolkata'
}

/**
 * Checks if a specific value matches a single cron field pattern.
 * Supports: '*' (any), 'X' (exact), 'X,Y' (list), 'X-Y' (range), '* /N' (step).
 */
export function matchesCronField(
  fieldPattern: string,
  value: number,
  minValue: number,
  maxValue: number,
): boolean {
  if (fieldPattern === '*') return true;

  // Step expression: */N or X/N
  if (fieldPattern.includes('/')) {
    const [rangePart, stepStr] = fieldPattern.split('/');
    const step = parseInt(stepStr!, 10);
    if (isNaN(step) || step <= 0) return false;

    let start = minValue;
    if (rangePart && rangePart !== '*') {
      start = parseInt(rangePart, 10);
      if (isNaN(start)) return false;
    }

    if (value < start || value > maxValue) return false;
    return (value - start) % step === 0;
  }

  // Range expression: X-Y
  if (fieldPattern.includes('-')) {
    const [startStr, endStr] = fieldPattern.split('-');
    const start = parseInt(startStr!, 10);
    const end = parseInt(endStr!, 10);
    if (isNaN(start) || isNaN(end)) return false;
    return value >= start && value <= end;
  }

  // List expression: X,Y,Z
  if (fieldPattern.includes(',')) {
    const list = fieldPattern.split(',').map((p) => parseInt(p.trim(), 10));
    return list.includes(value);
  }

  // Exact number
  const target = parseInt(fieldPattern, 10);
  return !isNaN(target) && target === value;
}

/**
 * Extracts date parts in a specific timezone using standard Intl API.
 */
function getZonedParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    minute: 'numeric',
    hour: 'numeric',
    day: 'numeric',
    month: 'numeric',
    weekday: 'short',
    hour12: false,
  });

  const parts = dtf.formatToParts(date);
  let minute = 0;
  let hour = 0;
  let day = 1;
  let month = 1;
  let weekday = 0; // 0 = Sun, 6 = Sat

  for (const part of parts) {
    if (part.type === 'minute') minute = parseInt(part.value, 10);
    else if (part.type === 'hour') hour = parseInt(part.value, 10) % 24;
    else if (part.type === 'day') day = parseInt(part.value, 10);
    else if (part.type === 'month') month = parseInt(part.value, 10);
    else if (part.type === 'weekday') {
      // en-US weekday formatToParts gives string or number
      const dayMap: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
        '1': 0,
        '2': 1,
        '3': 2,
        '4': 3,
        '5': 4,
        '6': 5,
        '7': 6,
      };
      weekday = dayMap[part.value] ?? date.getUTCDay();
    }
  }

  return { minute, hour, day, month, weekday };
}

/**
 * Computes the next run time for a standard 5-part cron expression.
 * Form: [min hour dom month dow]
 */
export function computeNextCronRun(
  cronExpression: string,
  fromDate: Date = new Date(),
  timeZone: string = 'Asia/Kolkata',
): Date {
  const fields = cronExpression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw AppError.of('VALIDATION_ERROR', `Invalid cron expression '${cronExpression}'. Must have 5 fields.`);
  }

  const [minPat, hourPat, domPat, monthPat, dowPat] = fields as [string, string, string, string, string];

  // Advance by 1 minute to ensure strictly future timestamp
  let candidate = new Date(fromDate.getTime() + 60_000);
  candidate.setUTCSeconds(0, 0);

  // Maximum scan limit: 366 days
  const maxIterations = 60 * 24 * 366;
  let iterations = 0;

  while (iterations < maxIterations) {
    const { minute, hour, day, month, weekday } = getZonedParts(candidate, timeZone);

    const monthMatch = matchesCronField(monthPat, month, 1, 12);
    const domMatch = matchesCronField(domPat, day, 1, 31);
    const dowMatch = matchesCronField(dowPat, weekday, 0, 6);
    const hourMatch = matchesCronField(hourPat, hour, 0, 23);
    const minMatch = matchesCronField(minPat, minute, 0, 59);

    if (monthMatch && domMatch && dowMatch && hourMatch && minMatch) {
      return candidate;
    }

    // Step by 1 minute
    candidate = new Date(candidate.getTime() + 60_000);
    iterations++;
  }

  throw AppError.of(
    'VALIDATION_ERROR',
    `Could not find next matching cron run within 1 year for '${cronExpression}'.`,
  );
}

export class AutomationSchedulerService {
  private readonly repository: AutomationRepository;
  private readonly defaultTimezone: string;

  constructor(private readonly deps: SchedulerServiceDependencies) {
    this.repository = deps.repository || new AutomationRepository();
    this.defaultTimezone = deps.defaultTimezone || 'Asia/Kolkata';
  }

  /**
   * Registers a scheduled trigger for an automation definition.
   */
  async registerSchedule(
    ctx: RequestContext,
    params: {
      definitionId: string;
      cronExpression: string;
      payload?: Record<string, unknown>;
      timezone?: string;
    },
  ): Promise<ScheduledTrigger> {
    const tenantId = ctx.principal.tenantId;
    const tz = params.timezone || this.defaultTimezone;
    const now = ctx.now || new Date();

    const nextRunAt = computeNextCronRun(params.cronExpression, now, tz).toISOString();

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const { definition, version } = await this.repository.getDefinitionAndVersion(
        tx,
        tenantId,
        params.definitionId,
      );

      const trigger: ScheduledTrigger = {
        id: `wft_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        tenantId,
        definitionId: definition.id,
        versionId: version.id,
        cronExpression: params.cronExpression,
        nextRunAt,
        lastRunAt: null,
        status: 'ACTIVE',
        payload: params.payload ?? {},
        createdAt: now.toISOString(),
      };

      return this.repository.insertScheduledTrigger(tx, trigger);
    });
  }

  /**
   * Polls due scheduled triggers, calculates next occurrence, and dispatches executions.
   */
  async pollDueSchedules(
    ctx: RequestContext,
    nowIsoOverride?: string,
  ): Promise<Array<{ triggerId: string; executionId: string; nextRunAt: string }>> {
    const nowIso = nowIsoOverride || (ctx.now ? ctx.now.toISOString() : new Date().toISOString());
    const nowDate = new Date(nowIso);

    // 1. Fetch due scheduled triggers
    const dueTriggers = await this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      return this.repository.findDueScheduledTriggers(tx, nowIso, 20);
    });

    const results: Array<{ triggerId: string; executionId: string; nextRunAt: string }> = [];

    for (const trigger of dueTriggers) {
      if (!trigger.cronExpression) continue;

      // 2. Compute next run time
      const nextRunDate = computeNextCronRun(trigger.cronExpression, nowDate, this.defaultTimezone);
      const nextRunAt = nextRunDate.toISOString();

      // 3. Atomically update schedule timestamp to prevent double-firing
      await this.deps.txRunner.withTenantTx(ctx, async (tx) => {
        return this.repository.updateScheduledTrigger(tx, trigger.id, {
          lastRunAt: nowIso,
          nextRunAt,
        });
      });

      // 4. Create and dispatch execution
      const idempotencyKey = `sched:${trigger.id}:${nowIso.substring(0, 16)}`;
      const { execution } = await this.deps.engine.createExecution(ctx, {
        tenantId: trigger.tenantId,
        definitionId: trigger.definitionId,
        versionId: trigger.versionId,
        triggerType: 'SCHEDULE',
        subjectType: 'SYSTEM',
        subjectId: trigger.id,
        context: {
          ...trigger.payload,
          scheduledTriggerId: trigger.id,
          cronExpression: trigger.cronExpression,
          scheduledRunAt: nowIso,
        },
        idempotencyKey,
        correlationId: ctx.correlationId,
      });

      await this.deps.engine.claimAndRun(ctx, execution.id);

      results.push({
        triggerId: trigger.id,
        executionId: execution.id,
        nextRunAt,
      });
    }

    return results;
  }

  /**
   * Polls executions in WAITING status that have expired timers and resumes them.
   */
  async pollDueTimers(
    ctx: RequestContext,
    nowIsoOverride?: string,
  ): Promise<Array<{ executionId: string; status: string }>> {
    const nowIso = nowIsoOverride || (ctx.now ? ctx.now.toISOString() : new Date().toISOString());

    const dueWaiting = await this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      return this.repository.findWaitingExecutionsDue(tx, nowIso, 20);
    });

    const results: Array<{ executionId: string; status: string }> = [];

    for (const exec of dueWaiting) {
      const resumed = await this.deps.engine.resumeExecution(ctx, exec.id, {
        timerCompleted: true,
        resumedAt: nowIso,
      });

      if (resumed) {
        const finished = await this.deps.engine.claimAndRun(ctx, exec.id);
        results.push({
          executionId: exec.id,
          status: finished ? finished.status : resumed.status,
        });
      }
    }

    return results;
  }

  /**
   * Reaps executions whose worker lease expired without a heartbeat (stale worker recovery).
   */
  async reapStaleWorkers(ctx: RequestContext, nowIsoOverride?: string): Promise<{ reapedCount: number }> {
    const nowIso = nowIsoOverride || (ctx.now ? ctx.now.toISOString() : new Date().toISOString());

    const staleExecutions = await this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      return this.repository.findStaleRunningExecutions(tx, nowIso, 50);
    });

    for (const exec of staleExecutions) {
      await this.deps.txRunner.withTenantTx(ctx, async (tx) => {
        await this.repository.resetExecutionWorkerLease(tx, exec.tenantId, exec.id);
      });
    }

    return { reapedCount: staleExecutions.length };
  }
}
