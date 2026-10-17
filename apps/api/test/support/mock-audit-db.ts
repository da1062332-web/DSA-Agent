// apps/api/test/support/mock-audit-db.ts — Module 37: Audit (MOD-AUD)
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
import type { AuditEventRow, EvidencePackRow } from '../../src/modules/audit/types';

export function createMockAuditStore() {
  const auditEvents: AuditEventRow[] = [];
  const evidencePacks: EvidencePackRow[] = [];
  const decisionRecords: Record<string, unknown>[] = [];
  let seqCounter = 1;

  let activeTenantId = 'ten_01JTESTTENANT00000000000000';

  const mockConnection: DatabaseConnection = {
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

      // pg_advisory_xact_lock
      if (sqlLower.includes('pg_advisory_xact_lock')) {
        return { rows: [] };
      }

      // SELECT * FROM app.audit_event
      if (sqlLower.includes('from app.audit_event')) {
        let filtered = auditEvents.filter((e) => e.tenant_id === activeTenantId);

        // id filter
        if (sqlLower.includes('id =')) {
          const idParam = params.find((p) => typeof p === 'string' && p.startsWith('aud_'));
          if (idParam) filtered = filtered.filter((e) => e.id === idParam);
        }

        // hash IS NOT NULL / hash IS NULL filter
        if (sqlLower.includes('hash is not null')) {
          filtered = filtered.filter((e) => e.hash !== null);
        } else if (sqlLower.includes('hash is null')) {
          filtered = filtered.filter((e) => e.hash === null);
        }

        // actor_type
        if (sqlLower.includes('actor_type =')) {
          const typeParam = params.find((p) => p === 'USER' || p === 'SERVICE');
          if (typeParam) filtered = filtered.filter((e) => e.actor_type === typeParam);
        }

        // actor_id
        if (sqlLower.includes('actor_id =')) {
          const actorParam = params.find(
            (p) => typeof p === 'string' && (p.startsWith('usr_') || p.startsWith('srv_')),
          );
          if (actorParam) filtered = filtered.filter((e) => e.actor_id === actorParam);
        }

        // action =
        if (sqlLower.includes('action =')) {
          const actionParam = params.find((p) => typeof p === 'string' && p.includes('.'));
          if (actionParam) filtered = filtered.filter((e) => e.action === actionParam);
        }

        // entity_type =
        if (sqlLower.includes('entity_type =')) {
          const entityTypeParam = params.find(
            (p) =>
              typeof p === 'string' &&
              ['lead', 'customer', 'application', 'task', 'evidence_pack'].includes(p),
          );
          if (entityTypeParam) filtered = filtered.filter((e) => e.entity_type === entityTypeParam);
        }

        // correlation_id =
        if (sqlLower.includes('correlation_id =')) {
          const corrParam = params.find((p) => typeof p === 'string' && p.startsWith('req_'));
          if (corrParam) filtered = filtered.filter((e) => e.correlation_id === corrParam);
        }

        // decision_record_id =
        if (sqlLower.includes('decision_record_id =')) {
          const drParam = params.find((p) => typeof p === 'string' && p.startsWith('dr_'));
          if (drParam) filtered = filtered.filter((e) => e.decision_record_id === drParam);
        }

        // Ordering
        if (sqlLower.includes('order by seq asc')) {
          filtered.sort((a, b) => Number(a.seq) - Number(b.seq));
        } else if (sqlLower.includes('order by seq desc')) {
          filtered.sort((a, b) => Number(b.seq) - Number(a.seq));
        } else {
          filtered.sort((a, b) => {
            const timeDiff = new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime();
            if (timeDiff !== 0) return timeDiff;
            return b.id.localeCompare(a.id);
          });
        }

        return { rows: filtered as unknown as R[] };
      }

      // INSERT INTO app.audit_event or audit_event
      if (sqlLower.includes('insert into audit_event') || sqlLower.includes('insert into app.audit_event')) {
        const id = params[0] as string;
        const tenantId = (params[1] as string) || activeTenantId;
        const actorType = params[2] as 'USER' | 'SERVICE';
        const actorId = params[3] as string;
        const action = params[4] as string;
        const entityType = params[5] as string;
        const entityId = (params[6] as string) ?? null;
        const permissionUsed = (params[7] as string) ?? null;
        const approvalRef = (params[8] as string) ?? null;
        const reason = (params[9] as string) ?? null;
        const decisionRecordId = (params[10] as string) ?? null;
        let before: unknown = null;
        let after: unknown = null;
        try {
          if (params[11]) before = JSON.parse(params[11] as string);
          if (params[12]) after = JSON.parse(params[12] as string);
        } catch {
          // pass
        }
        const externalSideEffect = Boolean(params[13]);
        const correlationId = (params[14] as string) ?? 'cor_default';
        const ip = (params[15] as string) ?? null;
        const userAgent = (params[16] as string) ?? null;

        const newEvent: AuditEventRow = {
          id,
          tenant_id: tenantId,
          seq: seqCounter++,
          occurred_at: new Date(),
          actor_type: actorType,
          actor_id: actorId,
          action,
          entity_type: entityType,
          entity_id: entityId,
          permission_used: permissionUsed,
          approval_ref: approvalRef,
          reason,
          decision_record_id: decisionRecordId,
          before,
          after,
          external_side_effect: externalSideEffect,
          correlation_id: correlationId,
          ip,
          user_agent: userAgent,
          prev_hash: null,
          hash: null,
        };

        auditEvents.push(newEvent);
        return { rows: [newEvent] as unknown as R[] };
      }

      // UPDATE app.audit_event (Sealing prev_hash & hash)
      if (sqlLower.includes('update app.audit_event')) {
        const prevHash = params[0] as string;
        const hash = params[1] as string;
        const id = params[2] as string;
        const event = auditEvents.find((e) => e.id === id);
        if (event) {
          event.prev_hash = prevHash;
          event.hash = hash;
        }
        return { rows: [] };
      }

      // INSERT INTO app.evidence_pack
      if (sqlLower.includes('insert into app.evidence_pack')) {
        const id = params[0] as string;
        const tenantId = (params[1] as string) || activeTenantId;
        const requestedBy = params[2] as string;
        const filters = JSON.parse(params[3] as string);

        const newPack: EvidencePackRow = {
          id,
          tenant_id: tenantId,
          requested_by: requestedBy,
          status: 'PENDING',
          filters,
          record_count: null,
          checksum: null,
          file_path: null,
          error_message: null,
          created_at: new Date(),
          completed_at: null,
          expires_at: null,
        };

        evidencePacks.push(newPack);
        return { rows: [newPack] as unknown as R[] };
      }

      // SELECT * FROM app.evidence_pack
      if (sqlLower.includes('from app.evidence_pack')) {
        const idParam = params.find((p) => typeof p === 'string' && p.startsWith('evp_'));
        if (idParam) {
          const pack = evidencePacks.find((p) => p.id === idParam && p.tenant_id === activeTenantId);
          return { rows: (pack ? [pack] : []) as unknown as R[] };
        }
        const filtered = evidencePacks.filter((p) => p.tenant_id === activeTenantId);
        return { rows: filtered as unknown as R[] };
      }

      // UPDATE app.evidence_pack
      if (sqlLower.includes('update app.evidence_pack')) {
        const status = params[0] as EvidencePackRow['status'];
        const id = params[params.length - 2] as string;
        const pack = evidencePacks.find((p) => p.id === id);
        if (pack) {
          pack.status = status;
          if (params[1]) pack.record_count = Number(params[1]);
          if (params[2]) pack.checksum = String(params[2]);
          if (params[3]) pack.file_path = String(params[3]);
        }
        return { rows: [] };
      }

      // SELECT * FROM app.decision_record
      if (sqlLower.includes('from app.decision_record')) {
        const drId = params.find((p) => typeof p === 'string' && p.startsWith('dr_'));
        const found = decisionRecords.find((dr) => dr.id === drId && dr.tenant_id === activeTenantId);
        return { rows: (found ? [found] : []) as unknown as R[] };
      }

      return { rows: [] };
    },
    async *streamQuery() {},
  };

  const mockDriver: Driver = {
    async init() {},
    async acquireConnection() {
      return mockConnection;
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
      createDriver: () => mockDriver,
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

  const runner: TxRunner = {
    async withTenantTx<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
      activeTenantId = ctx.principal.tenantId;
      return fn(db as unknown as Tx);
    },
  };

  return {
    auditEvents,
    evidencePacks,
    decisionRecords,
    runner,
    db,
  };
}
