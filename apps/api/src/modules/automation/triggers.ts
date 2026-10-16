// apps/api/src/modules/automation/triggers.ts — owner: Dev 1 / Dev 6 (MOD-WFA Phase 6)
import {
  AppError,
  type DomainEventEnvelope,
  type RequestContext,
  type TriggerFilter,
  type TxRunner,
} from '@dsa/contracts';
import type { AutomationEngine } from './engine';
import { AutomationRepository } from './repository';
import { evaluateCondition } from './step-handlers';

export interface TriggerServiceDependencies {
  txRunner: TxRunner;
  engine: AutomationEngine;
  repository?: AutomationRepository;
  maxConcurrentExecutionsPerTenant?: number; // default: 10
}

export interface DispatchedTriggerResult {
  executionId: string;
  definitionId: string;
  definitionCode: string;
  status: string;
  replayed: boolean;
  immediate: boolean;
}

export class AutomationTriggerService {
  private readonly repository: AutomationRepository;
  private readonly maxConcurrentPerTenant: number;

  constructor(private readonly deps: TriggerServiceDependencies) {
    this.repository = deps.repository || new AutomationRepository();
    this.maxConcurrentPerTenant = deps.maxConcurrentExecutionsPerTenant ?? 10;
  }

  /**
   * Evaluates all trigger filters against an event payload.
   */
  evaluateFilters(filters: TriggerFilter[] | undefined, data: Record<string, unknown>): boolean {
    if (!filters || filters.length === 0) return true;
    for (const filter of filters) {
      if (!evaluateCondition(filter, data)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Main entry point for ingesting domain events from the outbox or event bus.
   * Matches active EVENT automations, checks filters, enforces loop prevention, and triggers execution.
   */
  async handleDomainEvent(
    ctx: RequestContext,
    event: DomainEventEnvelope,
  ): Promise<DispatchedTriggerResult[]> {
    // 1. Loop prevention check
    if (event.chainDepth > 3) {
      throw AppError.of(
        'VALIDATION_ERROR',
        `Loop prevention: event chainDepth '${event.chainDepth}' exceeds maximum threshold of 3`,
      );
    }

    const tenantId = event.tenantId;

    // 2. Query matching active automation definitions in caller transaction
    const matched = await this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      return this.repository.findActiveDefinitionsByEventType(tx, tenantId, event.type);
    });

    const results: DispatchedTriggerResult[] = [];

    for (const { definition, version } of matched) {
      // 3. Filter check against event data
      const filters = version.triggerConfig.filters as TriggerFilter[] | undefined;
      const eventData = (event.data || {}) as Record<string, unknown>;
      const matchesFilter = this.evaluateFilters(filters, eventData);

      if (!matchesFilter) {
        continue;
      }

      // 4. Deterministic idempotency key: prevents duplicate delivery on redelivery
      const idempotencyKey = `evt:${event.id}:def:${definition.id}`;

      // 5. Tenant concurrency check
      const activeExecCount = await this.deps.txRunner.withTenantTx(ctx, async (tx) => {
        return this.repository.countActiveExecutionsForTenant(tx, tenantId);
      });

      const canRunImmediately = activeExecCount < this.maxConcurrentPerTenant;

      // 6. Create execution via engine
      const { execution, replayed } = await this.deps.engine.createExecution(ctx, {
        tenantId,
        definitionId: definition.id,
        versionId: version.id,
        triggerType: 'EVENT',
        triggerEventId: event.id,
        subjectType: definition.entityType,
        subjectId: event.subject.id,
        context: {
          ...eventData,
          eventType: event.type,
          eventId: event.id,
          occurredAt: event.occurredAt,
          subjectId: event.subject.id,
          subjectType: event.subject.type,
        },
        idempotencyKey,
        correlationId: event.correlationId || ctx.correlationId,
        causationId: event.id,
        chainDepth: event.chainDepth,
        dryRun: false,
      });

      let finalStatus = execution.status;

      // 7. Execute immediately if capacity permits and not already completed/replayed
      if (!replayed && canRunImmediately) {
        const executed = await this.deps.engine.claimAndRun(ctx, execution.id);
        if (executed) {
          finalStatus = executed.status;
        }
      }

      results.push({
        executionId: execution.id,
        definitionId: definition.id,
        definitionCode: definition.code,
        status: finalStatus,
        replayed,
        immediate: canRunImmediately,
      });
    }

    return results;
  }
}
