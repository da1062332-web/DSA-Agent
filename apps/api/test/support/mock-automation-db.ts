// apps/api/test/support/mock-automation-db.ts — owner: Dev 1 / Dev 6 (MOD-WFA)
import type {
  AuditEventInput,
  Database,
  DomainEventInput,
  RequestContext,
  Tx,
  TxRunner,
} from '@dsa/contracts';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely';
import type {
  RawDeadLetterRow,
  RawDefinitionRow,
  RawExecutionRow,
  RawScheduledTriggerRow,
  RawStepExecutionRow,
  RawVersionRow,
} from '../../src/modules/automation/repository';

export interface MockAuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

export function createMockAutomationStore() {
  const definitions: RawDefinitionRow[] = [
    {
      id: 'wfd_01JTESTWFD0000000000000001',
      tenant_id: 'ten_01JTESTTENANT00000000000000',
      code: 'lead_routing_pipeline',
      name: 'Lead Routing Pipeline',
      description: 'Standard automated lead qualification and task creation',
      trigger_type: 'EVENT',
      entity_type: 'LEAD',
      status: 'ACTIVE',
      is_system: false,
      pinned_version_id: 'wfv_01JTESTWFV0000000000000001',
      lock_version: 1,
      created_by: 'usr_admin',
      created_at: new Date('2026-10-14T00:00:00Z'),
      updated_by: 'usr_admin',
      updated_at: new Date('2026-10-14T00:00:00Z'),
    },
    {
      id: 'wfd_01JTESTSYSTEM0000000000001',
      tenant_id: 'ten_system',
      code: 'system_global_audit',
      name: 'Global System Audit Flow',
      description: 'System workflow shared across all tenants',
      trigger_type: 'EVENT',
      entity_type: 'SYSTEM',
      status: 'ACTIVE',
      is_system: true,
      pinned_version_id: 'wfv_01JTESTSYSTEMV000000000001',
      lock_version: 1,
      created_by: 'usr_system',
      created_at: new Date('2026-10-14T00:00:00Z'),
      updated_by: 'usr_system',
      updated_at: new Date('2026-10-14T00:00:00Z'),
    },
    {
      id: 'wfd_01JTESTRETRY00000000000001',
      tenant_id: 'ten_01JTESTTENANT00000000000000',
      code: 'webhook_retry_flow',
      name: 'Webhook Retry Flow',
      description: 'Tests retry classification and backoff',
      trigger_type: 'MANUAL',
      entity_type: 'LEAD',
      status: 'ACTIVE',
      is_system: false,
      pinned_version_id: 'wfv_01JTESTRETRYV000000000001',
      lock_version: 1,
      created_by: 'usr_admin',
      created_at: new Date('2026-10-14T00:00:00Z'),
      updated_by: 'usr_admin',
      updated_at: new Date('2026-10-14T00:00:00Z'),
    },
    {
      id: 'wfd_01JTESTWAIT000000000000001',
      tenant_id: 'ten_01JTESTTENANT00000000000000',
      code: 'waiting_flow',
      name: 'Waiting Flow',
      description: 'Tests wait step and resumption',
      trigger_type: 'EVENT',
      entity_type: 'LEAD',
      status: 'ACTIVE',
      is_system: false,
      pinned_version_id: 'wfv_01JTESTWAITV0000000000001',
      lock_version: 1,
      created_by: 'usr_admin',
      created_at: new Date('2026-10-14T00:00:00Z'),
      updated_by: 'usr_admin',
      updated_at: new Date('2026-10-14T00:00:00Z'),
    },
  ];

  const versions: RawVersionRow[] = [
    {
      id: 'wfv_01JTESTWFV0000000000000001',
      tenant_id: 'ten_01JTESTTENANT00000000000000',
      definition_id: 'wfd_01JTESTWFD0000000000000001',
      version_no: 1,
      status: 'ACTIVE',
      trigger_config: { eventType: 'lead.created' },
      steps: [
        {
          id: 'step_eval_dup',
          name: 'Evaluate Duplicate Rule',
          type: 'EVALUATE_DECISION',
          isSkippable: false,
          config: { decisionKey: 'DK-lead.duplicate' },
        },
        {
          id: 'step_branch_route',
          name: 'Route by Score',
          type: 'BRANCH',
          isSkippable: false,
          config: {
            conditions: [{ if: { field: 'score', op: 'EQ', value: 100 }, goToStepIndex: 3 }],
            defaultStepIndex: 2,
          },
        },
        {
          id: 'step_create_followup',
          name: 'Create First Contact Task',
          type: 'CREATE_TASK',
          isSkippable: true,
          config: { title: 'First contact lead follow-up' },
        },
        {
          id: 'step_tag_lead',
          name: 'Tag Priority Lead',
          type: 'UPDATE_FIELD',
          isSkippable: false,
          config: { field: 'tags', value: ['HIGH_PRIORITY'] },
        },
        {
          id: 'step_finish',
          name: 'End Pipeline',
          type: 'END',
          isSkippable: false,
          config: { outcomeStatus: 'SUCCEEDED' },
        },
      ],
      content_hash: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      author_id: 'usr_admin',
      submitted_by: 'usr_admin',
      submitted_at: new Date('2026-10-14T00:00:00Z'),
      approved_by: 'usr_checker',
      approved_at: new Date('2026-10-14T00:00:00Z'),
      rejection_reason: null,
      lock_version: 1,
      created_at: new Date('2026-10-14T00:00:00Z'),
    },
    {
      id: 'wfv_01JTESTSYSTEMV000000000001',
      tenant_id: 'ten_system',
      definition_id: 'wfd_01JTESTSYSTEM0000000000001',
      version_no: 1,
      status: 'ACTIVE',
      trigger_config: { eventType: 'audit.logged' },
      steps: [
        {
          id: 'step_notify',
          name: 'Notify SysAdmin',
          type: 'NOTIFY',
          isSkippable: false,
          config: { title: 'System Event Logged' },
        },
      ],
      content_hash: 'sha256:1123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      author_id: 'usr_system',
      submitted_by: null,
      submitted_at: null,
      approved_by: null,
      approved_at: null,
      rejection_reason: null,
      lock_version: 1,
      created_at: new Date('2026-10-14T00:00:00Z'),
    },
    {
      id: 'wfv_01JTESTRETRYV000000000001',
      tenant_id: 'ten_01JTESTTENANT00000000000000',
      definition_id: 'wfd_01JTESTRETRY00000000000001',
      version_no: 1,
      status: 'ACTIVE',
      trigger_config: {},
      steps: [
        {
          id: 'step_external_hook',
          name: 'Invoke Webhook',
          type: 'CALL_WEBHOOK',
          isSkippable: false,
          config: { url: 'https://api.partner.example/lead', simulatedStatus: 'RETRYABLE' },
        },
      ],
      content_hash: 'sha256:2123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      author_id: 'usr_admin',
      submitted_by: null,
      submitted_at: null,
      approved_by: null,
      approved_at: null,
      rejection_reason: null,
      lock_version: 1,
      created_at: new Date('2026-10-14T00:00:00Z'),
    },
    {
      id: 'wfv_01JTESTWAITV0000000000001',
      tenant_id: 'ten_01JTESTTENANT00000000000000',
      definition_id: 'wfd_01JTESTWAIT000000000000001',
      version_no: 1,
      status: 'ACTIVE',
      trigger_config: {},
      steps: [
        {
          id: 'step_pause',
          name: 'Wait For Lead Action',
          type: 'WAIT',
          isSkippable: false,
          config: { durationMs: 3600000 },
        },
        {
          id: 'step_after_wait',
          name: 'Complete After Wait',
          type: 'END',
          isSkippable: false,
          config: { outcomeStatus: 'SUCCEEDED' },
        },
      ],
      content_hash: 'sha256:3123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      author_id: 'usr_admin',
      submitted_by: null,
      submitted_at: null,
      approved_by: null,
      approved_at: null,
      rejection_reason: null,
      lock_version: 1,
      created_at: new Date('2026-10-14T00:00:00Z'),
    },
  ];

  const executions: RawExecutionRow[] = [];
  const stepExecutions: RawStepExecutionRow[] = [];
  const deadLetters: RawDeadLetterRow[] = [];
  const scheduledTriggers: RawScheduledTriggerRow[] = [];
  const auditEntries: MockAuditEntry[] = [];

  let activeTenantId = 'ten_01JTESTTENANT00000000000000';

  const connection: DatabaseConnection = {
    async executeQuery<R>(compiledQuery: {
      sql: string;
      parameters: readonly unknown[];
    }): Promise<QueryResult<R>> {
      const sqlLower = compiledQuery.sql.toLowerCase();
      const params = compiledQuery.parameters;

      // 1. set_config tenant_id
      if (sqlLower.includes('set_config') && sqlLower.includes('app.tenant_id')) {
        activeTenantId = String(params[0]);
        return { rows: [] };
      }

      // 2a. SELECT app.automation_definition by id
      if (sqlLower.includes('from app.automation_definition') && sqlLower.includes('where id =')) {
        const id = String(params[0]);
        const found = definitions.find((d) => d.id === id && (d.tenant_id === activeTenantId || d.is_system));
        return { rows: (found ? [found] : []) as unknown as R[] };
      }

      // 2b. INSERT INTO app.automation_definition
      if (sqlLower.includes('insert into app.automation_definition')) {
        const [
          id,
          tenantId,
          code,
          name,
          desc,
          trigType,
          entType,
          status,
          isSys,
          pinVerId,
          lockVer,
          createdBy,
          createdAt,
          updatedBy,
          updatedAt,
        ] = params;
        const newDef = {
          id: String(id),
          tenant_id: String(tenantId),
          code: String(code),
          name: String(name),
          description: (desc as string) ?? null,
          trigger_type: String(trigType),
          entity_type: String(entType),
          status: String(status),
          is_system: Boolean(isSys),
          pinned_version_id: (pinVerId as string) ?? null,
          lock_version: Number(lockVer ?? 0),
          created_by: String(createdBy),
          created_at: new Date(createdAt as string | Date),
          updated_by: String(updatedBy),
          updated_at: new Date(updatedAt as string | Date),
        };
        definitions.push(newDef);
        return { rows: [newDef] as unknown as R[] };
      }

      // 2c. UPDATE app.automation_definition
      if (sqlLower.includes('update app.automation_definition')) {
        // Params: name, description, status, pinnedVersionId, updatedBy, id, tenantId, expectedLockVersion (twice).
        const defId = String(params[5]);
        const tenantId = String(params[6]);
        const expected = params[7] as number | null;
        const found = definitions.find((d) => d.id === defId && d.tenant_id === tenantId);
        if (!found) return { rows: [] };
        if (expected !== null && expected !== undefined && found.lock_version !== Number(expected)) return { rows: [] };
        if (params[0] !== null) found.name = String(params[0]);
        if (params[1] !== null) found.description = (params[1] as string) ?? null;
        if (params[2] !== null) found.status = String(params[2]);
        if (params[3] !== null) found.pinned_version_id = (params[3] as string) ?? null;
        found.updated_at = new Date();
        found.lock_version += 1;
        return { rows: [found] as unknown as R[] };
      }

      // 2d. SELECT app.automation_definition (list)
      if (sqlLower.includes('from app.automation_definition') && !sqlLower.includes('join')) {
        const matches = definitions.filter((d) => d.tenant_id === activeTenantId || d.is_system);
        return { rows: matches as unknown as R[] };
      }

      // 3a. SELECT app.automation_version by id
      if (sqlLower.includes('from app.automation_version') && sqlLower.includes('where id =')) {
        const id = String(params[0]);
        const found = versions.find((v) => v.id === id);
        return { rows: (found ? [found] : []) as unknown as R[] };
      }

      // 3b. SELECT app.automation_version by definition_id (list)
      if (sqlLower.includes('from app.automation_version') && sqlLower.includes('where definition_id =')) {
        const defId = String(params[0]);
        const matches = versions.filter(
          (v) =>
            v.definition_id === defId && (v.tenant_id === activeTenantId || v.tenant_id === 'ten_system'),
        );
        return { rows: matches as unknown as R[] };
      }

      // 3c. INSERT INTO app.automation_version
      if (sqlLower.includes('insert into app.automation_version')) {
        const [
          id,
          tenantId,
          defId,
          verNo,
          status,
          trigCfgJson,
          stepsJson,
          contentHash,
          authorId,
          subBy,
          subAt,
          appBy,
          appAt,
          rejReason,
          lockVer,
          createdAt,
        ] = params;
        const newVer = {
          id: String(id),
          tenant_id: String(tenantId),
          definition_id: String(defId),
          version_no: Number(verNo),
          status: String(status),
          trigger_config: typeof trigCfgJson === 'string' ? JSON.parse(trigCfgJson) : trigCfgJson,
          steps: typeof stepsJson === 'string' ? JSON.parse(stepsJson) : stepsJson,
          content_hash: String(contentHash),
          author_id: String(authorId),
          submitted_by: (subBy as string) ?? null,
          submitted_at: (subAt as Date) ?? null,
          approved_by: (appBy as string) ?? null,
          approved_at: (appAt as Date) ?? null,
          rejection_reason: (rejReason as string) ?? null,
          lock_version: Number(lockVer ?? 0),
          created_at: new Date(createdAt as string | Date),
        };
        versions.push(newVer);
        return { rows: [newVer] as unknown as R[] };
      }

      // 3d. UPDATE app.automation_version
      if (sqlLower.includes('update app.automation_version')) {
        const verId = String(params[params.length - 2]);
        const tenantId = String(params[params.length - 1]);
        const found = versions.find(
          (v) => v.id === verId && (v.tenant_id === tenantId || v.tenant_id === 'ten_system'),
        );
        if (!found) return { rows: [] };
        if (params[0] !== null) found.status = String(params[0]);
        if (params[1] !== null) found.submitted_by = (params[1] as string) ?? null;
        if (params[2] !== null) found.submitted_at = (params[2] as Date) ?? null;
        if (params[3] !== null) found.approved_by = (params[3] as string) ?? null;
        if (params[4] !== null) found.approved_at = (params[4] as Date) ?? null;
        found.rejection_reason = (params[5] as string) ?? null;
        found.lock_version += 1;
        return { rows: [found] as unknown as R[] };
      }

      // 4. SELECT app.automation_execution by idempotency_key
      if (sqlLower.includes('from app.automation_execution') && sqlLower.includes('idempotency_key =')) {
        const tenantIdParam = String(params[0]);
        const keyParam = String(params[1]);
        const found = executions.find((e) => e.tenant_id === tenantIdParam && e.idempotency_key === keyParam);
        return { rows: (found ? [found] : []) as unknown as R[] };
      }

      // 5. SELECT app.automation_execution by id
      if (sqlLower.includes('from app.automation_execution') && sqlLower.includes('where id =')) {
        const id = String(params[0]);
        const tenantIdParam = String(params[1]);
        const found = executions.find((e) => e.id === id && e.tenant_id === tenantIdParam);
        return { rows: (found ? [found] : []) as unknown as R[] };
      }

      // 5b. SELECT app.automation_execution (list)
      if (
        sqlLower.includes('from app.automation_execution') &&
        !sqlLower.includes('idempotency_key =') &&
        !sqlLower.includes('count(') &&
        !sqlLower.includes("status = 'waiting'") &&
        !sqlLower.includes("status in ('running', 'retrying')") &&
        !sqlLower.includes("status in ('running', 'waiting')")
      ) {
        const matches = executions.filter((e) => e.tenant_id === activeTenantId);
        return { rows: matches as unknown as R[] };
      }

      // 6. INSERT INTO app.automation_execution
      if (sqlLower.includes('insert into app.automation_execution')) {
        const [
          id,
          tenantId,
          defId,
          verId,
          trigType,
          trigEventId,
          subType,
          subId,
          status,
          stepIndex,
          ctxJson,
          dryRun,
          workerId,
          leaseExpiresAt,
          errorCode,
          errorMessage,
          idempotencyKey,
          correlationId,
          causationId,
          chainDepth,
          startedAt,
          completedAt,
          createdAt,
          updatedAt,
        ] = params;

        // Check unique constraint on (tenant_id, idempotency_key)
        if (idempotencyKey) {
          const duplicate = executions.find(
            (e) => e.tenant_id === tenantId && e.idempotency_key === idempotencyKey,
          );
          if (duplicate) {
            const err = new Error(
              `duplicate key value violates unique constraint "automation_execution_idempotency_uq"`,
            );
            (err as unknown as Record<string, unknown>).code = '23505';
            throw err;
          }
        }

        const newRow: RawExecutionRow = {
          id: String(id),
          tenant_id: String(tenantId),
          definition_id: String(defId),
          version_id: String(verId),
          trigger_type: String(trigType),
          trigger_event_id: (trigEventId as string) ?? null,
          subject_type: String(subType),
          subject_id: String(subId),
          status: String(status),
          current_step_index: Number(stepIndex),
          context: typeof ctxJson === 'string' ? JSON.parse(ctxJson) : ctxJson,
          dry_run: Boolean(dryRun),
          worker_id: (workerId as string) ?? null,
          lease_expires_at: (leaseExpiresAt as Date) ?? null,
          error_code: (errorCode as string) ?? null,
          error_message: (errorMessage as string) ?? null,
          idempotency_key: (idempotencyKey as string) ?? null,
          correlation_id: String(correlationId),
          causation_id: (causationId as string) ?? null,
          chain_depth: Number(chainDepth),
          started_at: (startedAt as Date) ?? null,
          completed_at: (completedAt as Date) ?? null,
          created_at: new Date(createdAt as string | Date),
          updated_at: new Date(updatedAt as string | Date),
        };

        executions.push(newRow);
        return { rows: [newRow] as unknown as R[] };
      }

      // 7. Worker Lease Claim: UPDATE app.automation_execution ... SET status = 'RUNNING'
      if (
        sqlLower.includes('update app.automation_execution') &&
        sqlLower.includes("set status = 'running'") &&
        sqlLower.includes('worker_id =') &&
        sqlLower.includes('lease_expires_at =')
      ) {
        const workerId = String(params[0]);
        const leaseExpiresAt = params[1] as Date;
        const execId = String(params[2]);
        const tenantId = String(params[3]);

        const idx = executions.findIndex((e) => e.id === execId && e.tenant_id === tenantId);
        if (idx === -1) return { rows: [] };

        const current = executions[idx]!;
        const now = new Date();
        const leaseExpired = current.lease_expires_at ? new Date(current.lease_expires_at) < now : true;
        const canClaim =
          current.status === 'PENDING' ||
          current.status === 'RETRYING' ||
          current.status === 'WAITING' ||
          (current.status === 'RUNNING' && (current.worker_id === workerId || leaseExpired));

        if (!canClaim) return { rows: [] };

        current.status = 'RUNNING';
        current.worker_id = workerId;
        current.lease_expires_at = leaseExpiresAt;
        current.started_at = current.started_at || now;
        current.updated_at = now;

        return { rows: [current] as unknown as R[] };
      }

      // 8. Lease Heartbeat / Extension
      if (
        sqlLower.includes('update app.automation_execution') &&
        sqlLower.includes('set lease_expires_at =') &&
        sqlLower.includes('worker_id =') &&
        !sqlLower.includes('current_step_index =')
      ) {
        const newLeaseExpires = params[0] as Date;
        const execId = String(params[1]);
        const tenantId = String(params[2]);
        const workerId = String(params[3]);

        const current = executions.find(
          (e) =>
            e.id === execId &&
            e.tenant_id === tenantId &&
            e.worker_id === workerId &&
            e.lease_expires_at &&
            new Date(e.lease_expires_at) >= new Date(),
        );

        if (!current) return { rows: [] };
        current.lease_expires_at = newLeaseExpires;
        current.updated_at = new Date();
        return { rows: [{ id: current.id }] as unknown as R[] };
      }

      // 8b. Operator Cancel Execution: UPDATE app.automation_execution SET status = 'CANCELLED'
      if (
        sqlLower.includes('update app.automation_execution') &&
        sqlLower.includes("set status = 'cancelled'") &&
        !sqlLower.includes('worker_id =')
      ) {
        const reason = (params[0] as string) || 'Cancelled by operator';
        const execId = String(params[1]);
        const tenantId = String(params[2]);

        const current = executions.find(
          (e) =>
            e.id === execId &&
            e.tenant_id === tenantId &&
            !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(e.status),
        );
        if (!current) return { rows: [] };

        current.status = 'CANCELLED';
        current.error_message = reason;
        current.completed_at = new Date();
        current.updated_at = new Date();
        return { rows: [current] as unknown as R[] };
      }

      // 8c. Operator Update Execution / Reset Worker Lease
      if (sqlLower.includes('update app.automation_execution') && sqlLower.includes('worker_id = null')) {
        if (sqlLower.includes("status = 'pending'")) {
          const execId = String(params[0]);
          const tenantId = String(params[1]);
          const current = executions.find((e) => e.id === execId && e.tenant_id === tenantId);
          if (current) {
            current.worker_id = null;
            current.lease_expires_at = null;
            current.status = 'PENDING';
            current.updated_at = new Date();
          }
          return { rows: [] };
        }

        const newStatus = String(params[0]);
        const newStepIdx = params[1] !== null ? Number(params[1]) : undefined;
        const errorMessage = params[2] as string | null;
        const execId = String(params[3]);
        const tenantId = String(params[4]);

        const current = executions.find((e) => e.id === execId && e.tenant_id === tenantId);
        if (!current) return { rows: [] };

        current.status = newStatus;
        if (newStepIdx !== undefined) current.current_step_index = newStepIdx;
        current.error_message = errorMessage;
        current.worker_id = null;
        current.lease_expires_at = null;
        current.updated_at = new Date();

        return { rows: [current] as unknown as R[] };
      }

      // 9. Update Execution Progress & Status
      if (
        sqlLower.includes('update app.automation_execution') &&
        sqlLower.includes('set status =') &&
        (sqlLower.includes('current_step_index =') || sqlLower.includes('error_code ='))
      ) {
        const newStatus = String(params[0]);
        const newStepIdx = params[1] !== null ? Number(params[1]) : undefined;
        const ctxJson = params[2] as string | null;
        const errorCode = params[3] as string | null;
        const errorMessage = params[4] as string | null;
        const completedAt = params[5] as Date | null;
        const execId = String(params[6]);
        const tenantId = String(params[7]);
        const workerId = String(params[8]);

        const current = executions.find(
          (e) => e.id === execId && e.tenant_id === tenantId && e.worker_id === workerId,
        );

        if (!current) return { rows: [] };

        // Verify lease has not expired (unless transitioning to terminal state)
        const isTerminal = ['SUCCEEDED', 'FAILED', 'DEAD_LETTERED', 'CANCELLED'].includes(newStatus);
        const now = new Date();
        if (!isTerminal && current.lease_expires_at && new Date(current.lease_expires_at) < now) {
          // Stale worker!
          return { rows: [] };
        }

        current.status = newStatus;
        if (newStepIdx !== undefined) current.current_step_index = newStepIdx;
        if (ctxJson) current.context = typeof ctxJson === 'string' ? JSON.parse(ctxJson) : ctxJson;
        if (errorCode !== undefined) current.error_code = errorCode;
        if (errorMessage !== undefined) current.error_message = errorMessage;
        if (completedAt) current.completed_at = completedAt;
        current.updated_at = now;

        return { rows: [current] as unknown as R[] };
      }

      // 10. SELECT app.automation_step_execution by step_index
      if (sqlLower.includes('from app.automation_step_execution') && sqlLower.includes('step_index =')) {
        const tenantId = String(params[0]);
        const execId = String(params[1]);
        const stepIdx = Number(params[2]);

        const found = stepExecutions.find(
          (s) => s.tenant_id === tenantId && s.execution_id === execId && s.step_index === stepIdx,
        );
        return { rows: (found ? [found] : []) as unknown as R[] };
      }

      // 10b. SELECT app.automation_step_execution (list by execution_id)
      if (sqlLower.includes('from app.automation_step_execution')) {
        const tenantId = String(params[0]);
        const execId = String(params[1]);
        const matches = stepExecutions.filter((s) => s.tenant_id === tenantId && s.execution_id === execId);
        return { rows: matches as unknown as R[] };
      }

      // 11. INSERT INTO app.automation_step_execution
      if (sqlLower.includes('insert into app.automation_step_execution')) {
        const [
          id,
          tenantId,
          execId,
          stepIdx,
          stepId,
          stepType,
          status,
          inSnapJson,
          outSnapJson,
          errCode,
          errMsg,
          errClass,
          attempts,
          idempotencyKey,
          skipReason,
          skippedBy,
          startedAt,
          completedAt,
          createdAt,
        ] = params;

        const newStep: RawStepExecutionRow = {
          id: String(id),
          tenant_id: String(tenantId),
          execution_id: String(execId),
          step_index: Number(stepIdx),
          step_id: String(stepId),
          step_type: String(stepType),
          status: String(status),
          input_snapshot: typeof inSnapJson === 'string' ? JSON.parse(inSnapJson) : inSnapJson,
          output_snapshot: typeof outSnapJson === 'string' ? JSON.parse(outSnapJson) : outSnapJson,
          error_code: (errCode as string) ?? null,
          error_message: (errMsg as string) ?? null,
          error_classification: (errClass as string) ?? null,
          attempts: Number(attempts),
          idempotency_key: String(idempotencyKey),
          skip_reason: (skipReason as string) ?? null,
          skipped_by: (skippedBy as string) ?? null,
          started_at: (startedAt as Date) ?? null,
          completed_at: (completedAt as Date) ?? null,
          created_at: new Date(createdAt as string | Date),
        };

        stepExecutions.push(newStep);
        return { rows: [newStep] as unknown as R[] };
      }

      // 12. UPDATE app.automation_step_execution
      if (sqlLower.includes('update app.automation_step_execution')) {
        const newStatus = params[0] as string | null;
        const outSnapJson = params[1] as string | null;
        const errCode = params[2] as string | null;
        const errMsg = params[3] as string | null;
        const errClass = params[4] as string | null;
        const attempts = params[5] as number | null;
        const skipReason = params[6] as string | null;
        const skippedBy = params[7] as string | null;
        const startedAt = params[8] as Date | null;
        const completedAt = params[9] as Date | null;
        const id = String(params[10]);
        const tenantId = String(params[11]);

        const current = stepExecutions.find((s) => s.id === id && s.tenant_id === tenantId);
        if (!current) return { rows: [] };

        if (newStatus !== null) current.status = newStatus;
        if (outSnapJson !== null) {
          current.output_snapshot = typeof outSnapJson === 'string' ? JSON.parse(outSnapJson) : outSnapJson;
        }
        if (errCode !== null) current.error_code = errCode;
        if (errMsg !== null) current.error_message = errMsg;
        if (errClass !== null) current.error_classification = errClass;
        if (attempts !== null) current.attempts = Number(attempts);
        if (skipReason !== null) current.skip_reason = skipReason;
        if (skippedBy !== null) current.skipped_by = skippedBy;
        if (startedAt !== null) current.started_at = startedAt;
        if (completedAt !== null) current.completed_at = completedAt;

        return { rows: [current] as unknown as R[] };
      }

      // 13. INSERT INTO app.wfa_dead_letter
      if (sqlLower.includes('insert into app.wfa_dead_letter')) {
        const [
          id,
          tenantId,
          execId,
          stepExecId,
          reason,
          errDetailsJson,
          resStatus,
          resBy,
          resAt,
          resAction,
          createdAt,
        ] = params;

        const newDl: RawDeadLetterRow = {
          id: String(id),
          tenant_id: String(tenantId),
          execution_id: String(execId),
          step_execution_id: String(stepExecId),
          reason: String(reason),
          error_details: typeof errDetailsJson === 'string' ? JSON.parse(errDetailsJson) : errDetailsJson,
          resolution_status: String(resStatus),
          resolved_by: (resBy as string) ?? null,
          resolved_at: (resAt as Date) ?? null,
          resolution_action: (resAction as string) ?? null,
          created_at: new Date(createdAt as string | Date),
        };

        deadLetters.push(newDl);
        return { rows: [newDl] as unknown as R[] };
      }

      // 14. SELECT app.wfa_dead_letter
      if (sqlLower.includes('from app.wfa_dead_letter') && sqlLower.includes('where id =')) {
        const id = String(params[0]);
        const tenantId = String(params[1]);
        const found = deadLetters.find((d) => d.id === id && d.tenant_id === tenantId);
        return { rows: (found ? [found] : []) as unknown as R[] };
      }

      // 14b. SELECT app.wfa_dead_letter (list)
      if (sqlLower.includes('from app.wfa_dead_letter')) {
        const tenantId = String(params[0]);
        const matches = deadLetters.filter((d) => d.tenant_id === tenantId);
        return { rows: matches as unknown as R[] };
      }

      // 15. UPDATE app.wfa_dead_letter (resolve)
      if (sqlLower.includes('update app.wfa_dead_letter')) {
        const action = String(params[0]);
        const resolvedBy = String(params[1]);
        const id = String(params[2]);
        const tenantId = String(params[3]);

        const current = deadLetters.find(
          (d) => d.id === id && d.tenant_id === tenantId && d.resolution_status === 'OPEN',
        );
        if (!current) return { rows: [] };

        current.resolution_status = 'RESOLVED';
        current.resolution_action = action;
        current.resolved_by = resolvedBy;
        current.resolved_at = new Date();

        return { rows: [current] as unknown as R[] };
      }

      // 18. INSERT INTO app.scheduled_trigger
      if (sqlLower.includes('insert into app.scheduled_trigger')) {
        const [id, tenantId, defId, verId, cronExpr, nextRunAt, lastRunAt, status, payload, createdAt] =
          params;
        const newTrigger: RawScheduledTriggerRow = {
          id: String(id),
          tenant_id: String(tenantId),
          definition_id: String(defId),
          version_id: String(verId),
          cron_expression: (cronExpr as string) ?? null,
          next_run_at: new Date(nextRunAt as string | Date),
          last_run_at: lastRunAt ? new Date(lastRunAt as string | Date) : null,
          status: String(status),
          payload: typeof payload === 'string' ? JSON.parse(payload) : payload,
          created_at: new Date(createdAt as string | Date),
        };
        scheduledTriggers.push(newTrigger);
        return { rows: [newTrigger] as unknown as R[] };
      }

      // 19. SELECT app.scheduled_trigger WHERE status = 'ACTIVE' AND next_run_at <=
      if (sqlLower.includes('from app.scheduled_trigger') && sqlLower.includes("status = 'active'")) {
        const nowIso = params[0] ? new Date(params[0] as string | Date) : new Date();
        const due = scheduledTriggers.filter(
          (t) => t.status === 'ACTIVE' && new Date(t.next_run_at) <= nowIso,
        );
        return { rows: due as unknown as R[] };
      }

      // 20. UPDATE app.scheduled_trigger
      if (sqlLower.includes('update app.scheduled_trigger')) {
        const nextRunAt = params[0] as string | Date | undefined;
        const lastRunAt = params[1] as string | Date | undefined;
        const status = params[2] as string | undefined;
        const id = String(params[3]);

        const current = scheduledTriggers.find((t) => t.id === id);
        if (!current) return { rows: [] };

        if (nextRunAt !== undefined) current.next_run_at = new Date(nextRunAt);
        if (lastRunAt !== undefined) current.last_run_at = new Date(lastRunAt);
        if (status !== undefined) current.status = status;

        return { rows: [current] as unknown as R[] };
      }

      // 21. findActiveDefinitionsByEventType: SELECT ... FROM app.automation_definition d JOIN app.automation_version v
      if (
        sqlLower.includes('from app.automation_definition d') &&
        sqlLower.includes('join app.automation_version v')
      ) {
        const tenantId = String(params[0]);
        const eventType = String(params[1]);

        const matches: unknown[] = [];
        for (const def of definitions) {
          if (
            (def.tenant_id === tenantId || def.is_system) &&
            def.status === 'ACTIVE' &&
            def.trigger_type === 'EVENT'
          ) {
            const ver = versions.find((v) => v.id === def.pinned_version_id);
            if (ver && ver.status === 'ACTIVE') {
              const cfg = (
                typeof ver.trigger_config === 'object' && ver.trigger_config !== null
                  ? ver.trigger_config
                  : {}
              ) as Record<string, unknown>;
              if (!cfg.eventType || cfg.eventType === eventType) {
                matches.push({
                  def_id: def.id,
                  def_tenant_id: def.tenant_id,
                  def_code: def.code,
                  def_name: def.name,
                  def_description: def.description,
                  def_trigger_type: def.trigger_type,
                  def_entity_type: def.entity_type,
                  def_status: def.status,
                  def_is_system: def.is_system,
                  def_pinned_version_id: def.pinned_version_id,
                  def_lock_version: def.lock_version,
                  def_created_by: def.created_by,
                  def_created_at: def.created_at,
                  def_updated_by: def.updated_by,
                  def_updated_at: def.updated_at,
                  ver_id: ver.id,
                  ver_tenant_id: ver.tenant_id,
                  ver_definition_id: ver.definition_id,
                  ver_version_no: ver.version_no,
                  ver_status: ver.status,
                  ver_trigger_config: ver.trigger_config,
                  ver_steps: ver.steps,
                  ver_content_hash: ver.content_hash,
                  ver_author_id: ver.author_id,
                  ver_submitted_by: ver.submitted_by,
                  ver_submitted_at: ver.submitted_at,
                  ver_approved_by: ver.approved_by,
                  ver_approved_at: ver.approved_at,
                  ver_rejection_reason: ver.rejection_reason,
                  ver_lock_version: ver.lock_version,
                  ver_created_at: ver.created_at,
                });
              }
            }
          }
        }
        return { rows: matches as unknown as R[] };
      }

      // 22. findWaitingExecutionsDue: SELECT * FROM app.automation_execution WHERE status = 'WAITING'
      if (sqlLower.includes('from app.automation_execution') && sqlLower.includes("status = 'waiting'")) {
        const nowIso = String(params[0] ?? new Date().toISOString());
        const waiting = executions.filter((e) => {
          if (e.status !== 'WAITING') return false;
          const ctxObj = (typeof e.context === 'object' && e.context !== null ? e.context : {}) as Record<
            string,
            unknown
          >;
          const waitCfg = (ctxObj.waitConfig || {}) as Record<string, unknown>;
          const untilIso = waitCfg.untilIso as string | undefined;
          return untilIso && untilIso <= nowIso;
        });
        return { rows: waiting as unknown as R[] };
      }

      // 23. findStaleRunningExecutions: SELECT * FROM app.automation_execution WHERE status IN ('RUNNING', 'RETRYING')
      if (
        sqlLower.includes('from app.automation_execution') &&
        sqlLower.includes("status in ('running', 'retrying')") &&
        sqlLower.includes('lease_expires_at <')
      ) {
        const now = new Date(params[0] as string | Date);
        const stale = executions.filter(
          (e) =>
            (e.status === 'RUNNING' || e.status === 'RETRYING') &&
            e.lease_expires_at &&
            new Date(e.lease_expires_at) < now,
        );
        return { rows: stale as unknown as R[] };
      }

      // 24. countActiveExecutionsForTenant
      if (
        sqlLower.includes('select count(*) as count') &&
        sqlLower.includes('from app.automation_execution') &&
        sqlLower.includes("status in ('running', 'waiting')")
      ) {
        const tenantId = String(params[0]);
        const count = executions.filter(
          (e) => e.tenant_id === tenantId && (e.status === 'RUNNING' || e.status === 'WAITING'),
        ).length;
        return { rows: [{ count }] as unknown as R[] };
      }

      // 25. resetExecutionWorkerLease
      if (
        sqlLower.includes('update app.automation_execution') &&
        sqlLower.includes('set worker_id = null') &&
        sqlLower.includes("status = 'pending'")
      ) {
        const execId = String(params[0]);
        const tenantId = String(params[1]);
        const current = executions.find((e) => e.id === execId && e.tenant_id === tenantId);
        if (current) {
          current.worker_id = null;
          current.lease_expires_at = null;
          current.status = 'PENDING';
          current.updated_at = new Date();
        }
        return { rows: [] };
      }

      return { rows: [] };
    },
    async *streamQuery() {
      yield { rows: [] };
    },
  };

  const driver: Driver = {
    async init() {},
    async acquireConnection() {
      return connection;
    },
    async releaseConnection() {},
    async destroy() {},
    async beginTransaction() {},
    async commitTransaction() {},
    async rollbackTransaction() {},
  };

  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (d) => new PostgresIntrospector(d),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

  const runner: TxRunner = {
    async withTenantTx<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
      activeTenantId = ctx.principal.tenantId;
      return fn(db as unknown as Tx);
    },
  };

  const mockAuditPort = {
    async record(_tx: Tx, _ctx: RequestContext, e: AuditEventInput): Promise<string> {
      auditEntries.push({
        id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        before: e.before,
        after: e.after,
        reason: e.reason,
      });
      return 'aud_mock';
    },
  };

  const outboxEntries: Array<{
    id: string;
    type: string;
    subject: { type: string; id: string };
    data: Record<string, unknown>;
  }> = [];

  const mockOutboxPort = {
    async emit(_tx: Tx, _ctx: RequestContext, e: DomainEventInput): Promise<string> {
      outboxEntries.push({
        id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        type: e.type,
        subject: e.subject,
        data: e.data,
      });
      return 'evt_mock';
    },
  };

  return {
    db,
    runner,
    definitions,
    versions,
    executions,
    stepExecutions,
    deadLetters,
    scheduledTriggers,
    auditEntries,
    mockAuditPort,
    outboxEntries,
    mockOutboxPort,
  };
}
