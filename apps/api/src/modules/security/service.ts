// apps/api/src/modules/security/service.ts — Module 39: Security (MOD-SEC)
import {
  AppError,
  type CreateIncidentRequest,
  type CreateSecurityEventRequest,
  type IncidentListQuery,
  type IncidentListResponse,
  type IncidentRecord,
  type RequestContext,
  type SecurityEvent,
  type SecurityEventListQuery,
  type SecurityEventListResponse,
  type UpdateIncidentRequest,
} from '@dsa/contracts';
import { redactSensitivePayload, withIdempotency } from '@dsa/kernel';
import { sql } from 'kysely';
import { decodeCursor, encodeCursor } from '../../http/request';
import { type SiemPort, toSiemEvent } from './siem';
import type { ApiDeps } from '../types';
import type { IncidentRecordRow, SecurityEventRow } from './types';

export interface SecurityServiceOptions {
  siemPort?: SiemPort;
  onSecurityAlert?: (event: SecurityEvent) => void | Promise<void>;
}

function parseJsonField<T>(field: unknown, defaultValue: T): T {
  if (field === null || field === undefined) return defaultValue;
  if (typeof field === 'string') {
    try {
      return JSON.parse(field) as T;
    } catch {
      return defaultValue;
    }
  }
  return field as T;
}

function mapSecurityEventRow(row: SecurityEventRow): SecurityEvent {
  return {
    id: row.id as SecurityEvent['id'],
    tenantId: row.tenant_id as SecurityEvent['tenantId'],
    type: row.type as SecurityEvent['type'],
    principal: row.principal,
    ip: row.ip,
    severity: row.severity as SecurityEvent['severity'],
    details: parseJsonField<Record<string, unknown>>(row.details, {}),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapIncidentRow(row: IncidentRecordRow): IncidentRecord {
  return {
    id: row.id as IncidentRecord['id'],
    tenantId: row.tenant_id as IncidentRecord['tenantId'],
    type: row.type as IncidentRecord['type'],
    severity: row.severity as IncidentRecord['severity'],
    detectedAt: new Date(row.detected_at).toISOString(),
    personalDataInvolved: Boolean(row.personal_data_involved),
    affectedTenants: parseJsonField<string[]>(row.affected_tenants, []),
    notifications: parseJsonField(row.notifications, {}),
    status: row.status as IncidentRecord['status'],
    postMortemRef: row.post_mortem_ref ?? null,
    lockVersion: Number(row.lock_version),
    createdAt: new Date(row.created_at).toISOString(),
    createdBy: row.created_by,
    updatedAt: new Date(row.updated_at).toISOString(),
    updatedBy: row.updated_by,
  };
}

export class SecurityService {
  constructor(
    private readonly deps: ApiDeps,
    private readonly options?: SecurityServiceOptions,
  ) {}

  /**
   * ENT-096: Record a security event with automatic credential/secret redaction.
   */
  async recordSecurityEvent(ctx: RequestContext, input: CreateSecurityEventRequest): Promise<SecurityEvent> {
    const id = this.deps.ids.next('sec');
    const tenantId = ctx.principal.tenantId;

    // Strict sanitization: ensure passwords, tokens, API keys, credentials are never written
    const sanitizedDetails = redactSensitivePayload(input.details) as Record<string, unknown>;

    const event = await this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const result = await sql<SecurityEventRow>`
        INSERT INTO app.security_event (
          id, tenant_id, type, principal, ip, severity, details, created_at
        ) VALUES (
          ${id},
          ${tenantId},
          ${input.type},
          ${input.principal},
          ${input.ip},
          ${input.severity},
          ${JSON.stringify(sanitizedDetails)}::jsonb,
          now()
        )
        RETURNING id, tenant_id, type, principal, ip, severity, details, created_at
      `.execute(tx);

      const row = result.rows[0];
      if (!row) {
        throw AppError.of('INTERNAL_ERROR', 'Failed to insert security event.');
      }
      return mapSecurityEventRow(row);
    });

    // High/Critical severity alerting trigger
    if (event.severity === 'CRITICAL' || event.severity === 'HIGH') {
      try {
        await this.options?.onSecurityAlert?.(event);
      } catch {
        // Safe logging without failing caller request
      }
    }

    // SIEM Delivery Integration Boundary (TASK-431)
    if (this.options?.siemPort) {
      try {
        await this.options.siemPort.forwardEvent(toSiemEvent(event));
      } catch {
        // Safe error handling; event is durably retained in primary database
      }
    }

    return event;
  }

  /**
   * List security events in the acting tenant (InfoSec / Compliance authorized).
   */
  async listSecurityEvents(
    ctx: RequestContext,
    query: SecurityEventListQuery,
  ): Promise<SecurityEventListResponse> {
    const tenantId = ctx.principal.tenantId;
    const limit = query.limit ?? 50;
    const cursor = decodeCursor(query.cursor);

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      let querySql = sql<SecurityEventRow>`
        SELECT id, tenant_id, type, principal, ip, severity, details, created_at
        FROM app.security_event
        WHERE tenant_id = ${tenantId}
      `;

      if (query.type) {
        querySql = sql<SecurityEventRow>`${querySql} AND type = ${query.type}`;
      }
      if (query.severity) {
        querySql = sql<SecurityEventRow>`${querySql} AND severity = ${query.severity}`;
      }
      if (query.principal) {
        querySql = sql<SecurityEventRow>`${querySql} AND principal = ${query.principal}`;
      }
      if (query.dateFrom) {
        querySql = sql<SecurityEventRow>`${querySql} AND created_at >= ${query.dateFrom}::timestamptz`;
      }
      if (query.dateTo) {
        querySql = sql<SecurityEventRow>`${querySql} AND created_at <= ${query.dateTo}::timestamptz`;
      }
      if (cursor) {
        querySql = sql<SecurityEventRow>`
          ${querySql} AND (created_at, id) < (${cursor.k}::timestamptz, ${cursor.id})
        `;
      }

      querySql = sql<SecurityEventRow>`
        ${querySql}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit + 1}
      `;

      const result = await querySql.execute(tx);
      const rows = result.rows;
      const hasMore = rows.length > limit;
      const dataRows = hasMore ? rows.slice(0, limit) : rows;

      const data = dataRows.map(mapSecurityEventRow);
      const last = data[data.length - 1];
      const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

      return {
        data,
        meta: {
          nextCursor,
          limit,
        },
      };
    });
  }

  /**
   * API-SEC-001: Record a security incident (Idempotent & Audited).
   */
  async createIncident(
    ctx: RequestContext,
    input: CreateIncidentRequest,
    idemKey: string,
  ): Promise<{ status: number; body: IncidentRecord; replayed?: boolean }> {
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      return withIdempotency<IncidentRecord>(
        tx,
        ctx,
        {
          key: idemKey,
          method: 'POST',
          path: '/v1/incidents',
          body: input,
        },
        async () => {
          const id = this.deps.ids.next('inc');
          const tenantId = ctx.principal.tenantId;
          const actorId = ctx.principal.id;

          const result = await sql<IncidentRecordRow>`
            INSERT INTO app.incident_record (
              id, tenant_id, type, severity, detected_at, personal_data_involved,
              affected_tenants, notifications, status, post_mortem_ref,
              lock_version, created_at, created_by, updated_at, updated_by
            ) VALUES (
              ${id},
              ${tenantId},
              ${input.type},
              ${input.severity},
              ${input.detectedAt}::timestamptz,
              ${input.personalDataInvolved},
              ${JSON.stringify(input.affectedTenants)}::jsonb,
              ${JSON.stringify(input.notifications)}::jsonb,
              ${input.status},
              ${input.postMortemRef ?? null},
              0,
              now(),
              ${actorId},
              now(),
              ${actorId}
            )
            RETURNING id, tenant_id, type, severity, detected_at, personal_data_involved,
                      affected_tenants, notifications, status, post_mortem_ref,
                      lock_version, created_at, created_by, updated_at, updated_by
          `.execute(tx);

          const row = result.rows[0];
          if (!row) {
            throw AppError.of('INTERNAL_ERROR', 'Failed to create incident record.');
          }
          const incident = mapIncidentRow(row);

          // Emit transactional audit event
          if (this.deps.audit) {
            await this.deps.audit.record(tx, ctx, {
              entityType: 'incident_record',
              entityId: incident.id,
              action: 'incident.created', // audit_event.action must look like 'entity.verb' (lower case)
              after: incident as unknown as Record<string, unknown>,
            });
          }

          return {
            status: 201,
            body: incident,
          };
        },
      );
    });
  }

  /**
   * Get single incident record by ID within tenant boundary.
   */
  async getIncident(ctx: RequestContext, id: string): Promise<IncidentRecord> {
    const tenantId = ctx.principal.tenantId;

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const result = await sql<IncidentRecordRow>`
        SELECT id, tenant_id, type, severity, detected_at, personal_data_involved,
               affected_tenants, notifications, status, post_mortem_ref,
               lock_version, created_at, created_by, updated_at, updated_by
        FROM app.incident_record
        WHERE id = ${id} AND tenant_id = ${tenantId}
      `.execute(tx);

      const row = result.rows[0];
      if (!row) {
        throw AppError.of('NOT_FOUND', `Incident ${id} not found.`);
      }

      return mapIncidentRow(row);
    });
  }

  /**
   * API-SEC-002: Update incident assessment, status, and notification evidence.
   */
  async updateIncident(
    ctx: RequestContext,
    id: string,
    input: UpdateIncidentRequest,
    expectedVersion: number,
  ): Promise<IncidentRecord> {
    const tenantId = ctx.principal.tenantId;
    const actorId = ctx.principal.id;

    // Validate notification evidence consistency
    if (input.notifications) {
      for (const [channel, evidence] of Object.entries(input.notifications)) {
        if (evidence && evidence.notified && !evidence.notifiedAt) {
          throw AppError.of(
            'VALIDATION_ERROR',
            `Notification channel ${channel} marked notified=true requires notifiedAt timestamp.`,
            [{ field: `notifications.${channel}.notifiedAt`, issue: 'REQUIRED' }],
          );
        }
      }
    }

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      // 1. Fetch current record
      const currentRes = await sql<IncidentRecordRow>`
        SELECT id, tenant_id, type, severity, detected_at, personal_data_involved,
               affected_tenants, notifications, status, post_mortem_ref,
               lock_version, created_at, created_by, updated_at, updated_by
        FROM app.incident_record
        WHERE id = ${id} AND tenant_id = ${tenantId}
      `.execute(tx);

      const current = currentRes.rows[0];
      if (!current) {
        throw AppError.of('NOT_FOUND', `Incident ${id} not found.`);
      }

      // 2. Concurrency check: If-Match verification
      if (Number(current.lock_version) !== expectedVersion) {
        throw AppError.of(
          'VERSION_CONFLICT',
          `Incident was modified concurrently (current version: ${current.lock_version}, expected: ${expectedVersion}).`,
        );
      }

      // 3. Status transition validation
      if (input.status && input.status !== current.status) {
        if (current.status === 'CLOSED') {
          throw AppError.of(
            'INVALID_TRANSITION',
            'Cannot modify or reopen an incident in CLOSED status without authorized governance review.',
          );
        }
      }

      // 4. Merge fields
      const newSeverity = input.severity ?? current.severity;
      const newPersonalData =
        input.personalDataInvolved !== undefined
          ? input.personalDataInvolved
          : current.personal_data_involved;
      const newAffectedTenants = input.affectedTenants ?? parseJsonField(current.affected_tenants, []);
      const newNotifications = input.notifications
        ? { ...parseJsonField(current.notifications, {}), ...input.notifications }
        : parseJsonField(current.notifications, {});
      const newStatus = input.status ?? current.status;
      const newPostMortem = input.postMortemRef !== undefined ? input.postMortemRef : current.post_mortem_ref;
      const newVersion = expectedVersion + 1;

      // 5. Update
      const updateRes = await sql<IncidentRecordRow>`
        UPDATE app.incident_record
        SET severity = ${newSeverity},
            personal_data_involved = ${newPersonalData},
            affected_tenants = ${JSON.stringify(newAffectedTenants)}::jsonb,
            notifications = ${JSON.stringify(newNotifications)}::jsonb,
            status = ${newStatus},
            post_mortem_ref = ${newPostMortem},
            lock_version = ${newVersion},
            updated_at = now(),
            updated_by = ${actorId}
        WHERE id = ${id} AND tenant_id = ${tenantId} AND lock_version = ${expectedVersion}
        RETURNING id, tenant_id, type, severity, detected_at, personal_data_involved,
                  affected_tenants, notifications, status, post_mortem_ref,
                  lock_version, created_at, created_by, updated_at, updated_by
      `.execute(tx);

      const updatedRow = updateRes.rows[0];
      if (!updatedRow) {
        throw AppError.of('VERSION_CONFLICT', 'Stale incident update during execution.');
      }

      const updated = mapIncidentRow(updatedRow);

      // Emit transactional audit event
      if (this.deps.audit) {
        await this.deps.audit.record(tx, ctx, {
          entityType: 'incident_record',
          entityId: updated.id,
          action: 'incident.updated',
          before: mapIncidentRow(current) as unknown as Record<string, unknown>,
          after: updated as unknown as Record<string, unknown>,
        });
      }

      return updated;
    });
  }

  /**
   * List incidents in the acting tenant with filtering and cursor pagination.
   */
  async listIncidents(ctx: RequestContext, query: IncidentListQuery): Promise<IncidentListResponse> {
    const tenantId = ctx.principal.tenantId;
    const limit = query.limit ?? 50;
    const cursor = decodeCursor(query.cursor);

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      let querySql = sql<IncidentRecordRow>`
        SELECT id, tenant_id, type, severity, detected_at, personal_data_involved,
               affected_tenants, notifications, status, post_mortem_ref,
               lock_version, created_at, created_by, updated_at, updated_by
        FROM app.incident_record
        WHERE tenant_id = ${tenantId}
      `;

      if (query.status) {
        querySql = sql<IncidentRecordRow>`${querySql} AND status = ${query.status}`;
      }
      if (query.severity) {
        querySql = sql<IncidentRecordRow>`${querySql} AND severity = ${query.severity}`;
      }
      if (query.type) {
        querySql = sql<IncidentRecordRow>`${querySql} AND type = ${query.type}`;
      }
      if (cursor) {
        querySql = sql<IncidentRecordRow>`
          ${querySql} AND (detected_at, id) < (${cursor.k}::timestamptz, ${cursor.id})
        `;
      }

      querySql = sql<IncidentRecordRow>`
        ${querySql}
        ORDER BY detected_at DESC, id DESC
        LIMIT ${limit + 1}
      `;

      const result = await querySql.execute(tx);
      const rows = result.rows;
      const hasMore = rows.length > limit;
      const dataRows = hasMore ? rows.slice(0, limit) : rows;

      const data = dataRows.map(mapIncidentRow);
      const last = data[data.length - 1];
      const nextCursor = hasMore && last ? encodeCursor(last.detectedAt, last.id) : null;

      return {
        data,
        meta: {
          nextCursor,
          limit,
        },
      };
    });
  }
}
