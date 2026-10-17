// apps/api/test/support/mock-security-db.ts — Module 39: Security (MOD-SEC)
import type { Database, RequestContext, Tx, TxRunner } from '@dsa/contracts';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely';
import type { IncidentRecordRow, SecurityEventRow } from '../../src/modules/security/types';

interface IdempotencyKeyRow {
  tenant_id: string;
  principal_id: string;
  key: string;
  method: string;
  path: string;
  request_hash: string;
  status: string;
  response_status: number;
  response_body: unknown;
}

export function createMockSecurityStore() {
  const securityEvents: SecurityEventRow[] = [];
  const incidents: IncidentRecordRow[] = [];
  const idempotencyKeys: IdempotencyKeyRow[] = [];
  const auditEvents: Record<string, unknown>[] = [];

  let activeTenantId = 'ten_01J00000000000000000000000';

  const mockConnection: DatabaseConnection = {
    async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {},
    async executeQuery<R>(compiledQuery: {
      sql: string;
      parameters: readonly unknown[];
    }): Promise<QueryResult<R>> {
      const sqlLower = compiledQuery.sql.toLowerCase();
      const params = compiledQuery.parameters as unknown[];

      // set_config('app.tenant_id', ...)
      if (sqlLower.includes('set_config') && sqlLower.includes('app.tenant_id')) {
        const val = params[0];
        if (typeof val === 'string') activeTenantId = val;
        return { rows: [] };
      }

      // ======================================================================
      // Idempotency Key handling
      // ======================================================================
      if (sqlLower.includes('insert into idempotency_key')) {
        const tenantId = (params[0] as string) || activeTenantId;
        const principalId = params[1] as string;
        const key = params[2] as string;
        const method = params[3] as string;
        const path = params[4] as string;
        const requestHash = params[5] as string;
        const status = params[6] as string;

        const existing = idempotencyKeys.find(
          (k) => k.tenant_id === tenantId && k.principal_id === principalId && k.key === key,
        );
        if (existing) {
          // ON CONFLICT DO NOTHING -> return empty
          return { rows: [] };
        }

        idempotencyKeys.push({
          tenant_id: tenantId,
          principal_id: principalId,
          key,
          method,
          path,
          request_hash: requestHash,
          status,
          response_status: 0,
          response_body: null,
        });
        return { rows: [{ key }] as unknown as R[] };
      }

      if (
        sqlLower.includes('select request_hash, status, response_status, response_body from idempotency_key')
      ) {
        const tenantId = params[0] as string;
        const principalId = params[1] as string;
        const key = params[2] as string;

        const found = idempotencyKeys.find(
          (k) => k.tenant_id === tenantId && k.principal_id === principalId && k.key === key,
        );
        return { rows: found ? ([found] as unknown as R[]) : [] };
      }

      if (sqlLower.includes('update idempotency_key')) {
        const respStatus = params[0] as number;
        const respBody = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
        // params[2] is resource_ref
        const tenantId = params[3] as string;
        const principalId = params[4] as string;
        const key = params[5] as string;

        const found = idempotencyKeys.find(
          (k) => k.tenant_id === tenantId && k.principal_id === principalId && k.key === key,
        );
        if (found) {
          found.status = 'COMPLETED';
          found.response_status = respStatus;
          found.response_body = respBody;
        }
        return { rows: [] };
      }

      // ======================================================================
      // Audit Event persistence
      // ======================================================================
      if (sqlLower.includes('insert into audit_event') || sqlLower.includes('insert into app.audit_event')) {
        auditEvents.push({ id: params[0], tenant_id: activeTenantId, action: params[4] });
        return { rows: [] };
      }

      // ======================================================================
      // Security Events (ENT-096)
      // ======================================================================
      if (sqlLower.includes('insert into app.security_event')) {
        const id = params[0] as string;
        const tenantId = (params[1] as string) || activeTenantId;
        const type = params[2] as string;
        const principal = params[3] as string;
        const ip = params[4] as string;
        const severity = params[5] as string;
        const details = typeof params[6] === 'string' ? JSON.parse(params[6]) : params[6];
        const createdAt = new Date().toISOString();

        const row: SecurityEventRow = {
          id,
          tenant_id: tenantId,
          type,
          principal,
          ip,
          severity,
          details,
          created_at: createdAt,
        };
        securityEvents.push(row);
        return { rows: [row] as unknown as R[] };
      }

      if (sqlLower.includes('from app.security_event')) {
        let filtered = securityEvents.filter((e) => e.tenant_id === activeTenantId);

        if (sqlLower.includes('type =')) {
          const typeParam = params.find((p) =>
            [
              'AUTH_FAILURE',
              'PERMISSION_DENIED',
              'RATE_LIMIT_EXCEEDED',
              'SUSPICIOUS_ACCESS',
              'DATA_EXPORT',
              'CONFIGURATION_CHANGE',
              'INTEGRITY_VIOLATION',
            ].includes(p as string),
          );
          if (typeParam) filtered = filtered.filter((e) => e.type === typeParam);
        }

        if (sqlLower.includes('severity =')) {
          const sevParam = params.find((p) => ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(p as string));
          if (sevParam) filtered = filtered.filter((e) => e.severity === sevParam);
        }

        if (sqlLower.includes('principal =')) {
          const prinParam = params.find((p) => typeof p === 'string' && p.startsWith('usr_'));
          if (prinParam) filtered = filtered.filter((e) => e.principal === prinParam);
        }

        filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        return { rows: filtered as unknown as R[] };
      }

      // ======================================================================
      // Incident Records (ENT-102)
      // ======================================================================
      if (sqlLower.includes('insert into app.incident_record')) {
        const id = params[0] as string;
        const tenantId = (params[1] as string) || activeTenantId;
        const type = params[2] as string;
        const severity = params[3] as string;
        const detectedAt = new Date(params[4] as string).toISOString();
        const personalDataInvolved = Boolean(params[5]);
        const affectedTenants = typeof params[6] === 'string' ? JSON.parse(params[6]) : params[6];
        const notifications = typeof params[7] === 'string' ? JSON.parse(params[7]) : params[7];
        const status = params[8] as string;
        const postMortemRef = (params[9] as string) ?? null;
        const lockVersion = 0;
        const now = new Date().toISOString();
        const createdBy = params[10] as string;
        const updatedBy = params[11] as string;

        const row: IncidentRecordRow = {
          id,
          tenant_id: tenantId,
          type,
          severity,
          detected_at: detectedAt,
          personal_data_involved: personalDataInvolved,
          affected_tenants: affectedTenants,
          notifications,
          status,
          post_mortem_ref: postMortemRef,
          lock_version: lockVersion,
          created_at: now,
          created_by: createdBy,
          updated_at: now,
          updated_by: updatedBy,
        };
        incidents.push(row);
        return { rows: [row] as unknown as R[] };
      }

      if (sqlLower.includes('from app.incident_record') && !sqlLower.trimStart().startsWith('update')) {
        let filtered = incidents.filter((i) => i.tenant_id === activeTenantId);

        // id filter
        if (sqlLower.includes('where id =') || sqlLower.includes('where id=')) {
          const idParam = params.find((p) => typeof p === 'string' && p.startsWith('inc_'));
          if (idParam) filtered = filtered.filter((i) => i.id === idParam);
        }

        // status filter
        if (sqlLower.includes('status =')) {
          const statusParam = params.find((p) =>
            ['OPEN', 'INVESTIGATING', 'CONTAINED', 'RESOLVED', 'CLOSED'].includes(p as string),
          );
          if (statusParam) filtered = filtered.filter((i) => i.status === statusParam);
        }

        // severity filter
        if (sqlLower.includes('severity =')) {
          const sevParam = params.find((p) => ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(p as string));
          if (sevParam) filtered = filtered.filter((e) => e.severity === sevParam);
        }

        filtered.sort((a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime());
        return { rows: filtered as unknown as R[] };
      }

      if (sqlLower.trimStart().startsWith('update app.incident_record')) {
        const severity = params[0] as string;
        const personalDataInvolved = Boolean(params[1]);
        const affectedTenants = typeof params[2] === 'string' ? JSON.parse(params[2]) : params[2];
        const notifications = typeof params[3] === 'string' ? JSON.parse(params[3]) : params[3];
        const status = params[4] as string;
        const postMortemRef = (params[5] as string) ?? null;
        const lockVersion = params[6] as number;
        const actorId = params[7] as string;
        const id = params[8] as string;
        const tenantId = (params[9] as string) || activeTenantId;
        const expectedVersion = params[10] as number;

        const row = incidents.find(
          (i) => i.id === id && i.tenant_id === tenantId && i.lock_version === expectedVersion,
        );
        if (!row) {
          return { rows: [] };
        }

        row.severity = severity;
        row.personal_data_involved = personalDataInvolved;
        row.affected_tenants = affectedTenants;
        row.notifications = notifications;
        row.status = status;
        row.post_mortem_ref = postMortemRef;
        row.lock_version = lockVersion;
        row.updated_at = new Date().toISOString();
        row.updated_by = actorId;

        return { rows: [row] as unknown as R[] };
      }

      return { rows: [] };
    },
  };

  class MockDriver implements Driver {
    async init(): Promise<void> {}
    async acquireConnection(): Promise<DatabaseConnection> {
      return mockConnection;
    }
    async beginTransaction(): Promise<void> {}
    async commitTransaction(): Promise<void> {}
    async rollbackTransaction(): Promise<void> {}
    async releaseConnection(): Promise<void> {}
    async destroy(): Promise<void> {}
  }

  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new MockDriver(),
      createIntrospector: (dbInstance) => new PostgresIntrospector(dbInstance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

  const txRunner: TxRunner = {
    async withTenantTx<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
      activeTenantId = ctx.principal.tenantId;
      return fn(db as unknown as Tx);
    },
  };

  return {
    db,
    txRunner,
    securityEvents,
    incidents,
    idempotencyKeys,
    auditEvents,
  };
}
