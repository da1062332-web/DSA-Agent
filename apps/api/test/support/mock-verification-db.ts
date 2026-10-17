// apps/api/test/support/mock-verification-db.ts — owner: Developer 2
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
import type { RawVerificationRow } from '../../src/modules/verification/db';

export interface MockChecklistItem {
  id: string;
  tenant_id: string;
  application_id: string;
  status: string;
  attestation_note: string | null;
  reject_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  lock_version: number;
}

export function createMockVerificationStore() {
  const verifications: RawVerificationRow[] = [
    {
      id: 'vrf_01JTESTVRF0000000000000001',
      tenant_id: 'ten_01JTESTTENANT00000000000000',
      application_id: 'app_01JTESTAPP0000000000000001',
      party_id: 'pty_01',
      customer_id: 'cust_01',
      verification_type: 'DOCUMENT_REVIEW',
      status: 'INITIATED',
      outcome: null,
      assigned_to_user_id: 'usr_staff_01',
      assigned_to_queue_id: null,
      branch_id: 'br_mumbai',
      priority: 'HIGH',
      scheduled_at: null,
      completed_at: null,
      verified_by: null,
      findings_summary: 'Initial document checklist review',
      rejection_reason: null,
      checklist_item_ids: ['chk_pan_01', 'chk_salary_01'],
      lock_version: 0,
      created_at: new Date('2026-10-13T09:00:00Z'),
      created_by: 'usr_creator_01',
      updated_at: new Date('2026-10-13T09:00:00Z'),
      updated_by: 'usr_creator_01',
    },
    {
      id: 'vrf_01JTESTVRF0000000000000002',
      tenant_id: 'ten_01JTESTTENANT00000000000000',
      application_id: 'app_01JTESTAPP0000000000000002',
      party_id: 'pty_02',
      customer_id: 'cust_02',
      verification_type: 'RESIDENCE_FI',
      status: 'ASSIGNED',
      outcome: null,
      assigned_to_user_id: 'usr_verifier_02',
      assigned_to_queue_id: null,
      branch_id: 'br_pune',
      priority: 'MEDIUM',
      scheduled_at: new Date('2026-10-14T10:00:00Z'),
      completed_at: null,
      verified_by: null,
      findings_summary: 'Field visit scheduled for applicant residential address',
      rejection_reason: null,
      checklist_item_ids: [],
      lock_version: 1,
      created_at: new Date('2026-10-13T09:30:00Z'),
      created_by: 'usr_creator_01',
      updated_at: new Date('2026-10-13T09:30:00Z'),
      updated_by: 'usr_creator_01',
    },
    {
      id: 'vrf_01JOTHERTENANT0000000000000',
      tenant_id: 'ten_OTHER_000000000000000000',
      application_id: 'app_foreign_99',
      party_id: null,
      customer_id: null,
      verification_type: 'EMPLOYMENT',
      status: 'INITIATED',
      outcome: null,
      assigned_to_user_id: null,
      assigned_to_queue_id: null,
      branch_id: 'br_delhi',
      priority: 'LOW',
      scheduled_at: null,
      completed_at: null,
      verified_by: null,
      findings_summary: 'Foreign tenant verification',
      rejection_reason: null,
      checklist_item_ids: [],
      lock_version: 0,
      created_at: new Date(),
      created_by: 'usr_other_01',
      updated_at: new Date(),
      updated_by: 'usr_other_01',
    },
  ];

  const checklistItems: MockChecklistItem[] = [
    {
      id: 'chk_pan_01',
      tenant_id: 'ten_01JTESTTENANT00000000000000',
      application_id: 'app_01JTESTAPP0000000000000001',
      status: 'PENDING',
      attestation_note: null,
      reject_reason: null,
      reviewed_by: null,
      reviewed_at: null,
      lock_version: 0,
    },
  ];

  let activeTenantId = 'ten_01JTESTTENANT00000000000000';

  const connection: DatabaseConnection = {
    async executeQuery<R>(compiledQuery: {
      sql: string;
      parameters: readonly unknown[];
    }): Promise<QueryResult<R>> {
      const sqlLower = compiledQuery.sql.toLowerCase();
      const params = compiledQuery.parameters;

      // set_config tenant_id
      if (sqlLower.includes('set_config') && sqlLower.includes('app.tenant_id')) {
        activeTenantId = String(params[0]);
        return { rows: [] };
      }

      // SELECT app.verification_request WHERE id = ...
      if (sqlLower.includes('from app.verification_request') && sqlLower.includes('where id =')) {
        const id = String(params[0]);
        const found = verifications.find((v) => v.id === id && v.tenant_id === activeTenantId);
        return { rows: (found ? [found] : []) as unknown as R[] };
      }

      // SELECT * FROM app.verification_request (list)
      if (sqlLower.includes('from app.verification_request') && !sqlLower.includes('where id =')) {
        let filtered = verifications.filter((v) => v.tenant_id === activeTenantId);

        if (sqlLower.includes('status =')) {
          const statusParam = params.find((p) =>
            ['INITIATED', 'ASSIGNED', 'IN_PROGRESS', 'VERIFIED', 'REJECTED', 'WAIVED', 'CANCELLED'].includes(
              String(p),
            ),
          );
          if (statusParam) filtered = filtered.filter((v) => v.status === statusParam);
        }

        if (sqlLower.includes('branch_id =') || sqlLower.includes('branch_id in')) {
          const brParams = params.filter((p) => typeof p === 'string' && p.startsWith('br_'));
          if (brParams.length > 0) filtered = filtered.filter((v) => brParams.includes(v.branch_id));
        }

        if (sqlLower.includes('verification_type =')) {
          const typeParam = params.find((p) =>
            [
              'DOCUMENT_REVIEW',
              'IDENTITY_KYC',
              'RESIDENCE_FI',
              'OFFICE_FI',
              'EMPLOYMENT',
              'BANK_STATEMENT',
            ].includes(String(p)),
          );
          if (typeParam) filtered = filtered.filter((v) => v.verification_type === typeParam);
        }

        filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        return { rows: filtered as unknown as R[] };
      }

      // INSERT INTO app.verification_request
      if (sqlLower.includes('insert into app.verification_request')) {
        const [
          id,
          tenantId,
          appId,
          partyId,
          custId,
          verType,
          assignedUserId,
          assignedQueueId,
          branchId,
          priority,
          scheduledAt,
          findingsSummary,
          checklistIds,
          actor1,
          actor2,
        ] = params;

        const newRec: RawVerificationRow = {
          id: id as string,
          tenant_id: tenantId as string,
          application_id: appId as string,
          party_id: (partyId as string) ?? null,
          customer_id: (custId as string) ?? null,
          verification_type: verType as string,
          status: 'INITIATED',
          outcome: null,
          assigned_to_user_id: (assignedUserId as string) ?? null,
          assigned_to_queue_id: (assignedQueueId as string) ?? null,
          branch_id: branchId as string,
          priority: priority as string,
          scheduled_at: (scheduledAt as Date) ?? null,
          completed_at: null,
          verified_by: null,
          findings_summary: (findingsSummary as string) ?? null,
          rejection_reason: null,
          checklist_item_ids: Array.isArray(checklistIds) ? checklistIds : [],
          lock_version: 0,
          created_at: new Date(),
          created_by: actor1 as string,
          updated_at: new Date(),
          updated_by: actor2 as string,
        };

        verifications.push(newRec);
        return { rows: [newRec] as unknown as R[] };
      }

      // UPDATE app.verification_request
      if (sqlLower.includes('update app.verification_request')) {
        const id = String(params[params.length - 1]);
        const found = verifications.find((v) => v.id === id && v.tenant_id === activeTenantId);
        if (!found) return { rows: [] };

        if (sqlLower.includes('completed_at =')) {
          // completeVerification query
          const [markStatus, outcome, findings, rejectionReason, now, verifiedBy, updatedBy] = params;
          found.status = markStatus as string;
          found.outcome = outcome as string;
          found.findings_summary = findings as string;
          found.rejection_reason = (rejectionReason as string) ?? null;
          found.completed_at = now as Date;
          found.verified_by = verifiedBy as string;
          found.updated_by = updatedBy as string;
          found.updated_at = new Date();
          found.lock_version += 1;
        } else {
          // generic update
          if (sqlLower.includes('status =')) {
            const statusParam = params.find((p) =>
              [
                'INITIATED',
                'ASSIGNED',
                'IN_PROGRESS',
                'VERIFIED',
                'REJECTED',
                'WAIVED',
                'CANCELLED',
              ].includes(String(p)),
            );
            if (statusParam) found.status = String(statusParam);
          }
          if (sqlLower.includes('priority =')) {
            const prioParam = params.find((p) => ['HIGH', 'MEDIUM', 'LOW'].includes(String(p)));
            if (prioParam) found.priority = String(prioParam);
          }
          if (sqlLower.includes('findings_summary =')) {
            const fParam = params.find(
              (p) =>
                typeof p === 'string' &&
                p.length > 3 &&
                ![
                  'HIGH',
                  'MEDIUM',
                  'LOW',
                  'INITIATED',
                  'ASSIGNED',
                  'IN_PROGRESS',
                  'VERIFIED',
                  'REJECTED',
                  'WAIVED',
                  'CANCELLED',
                ].includes(p) &&
                !p.startsWith('vrf_') &&
                !p.startsWith('usr_'),
            );
            if (fParam) found.findings_summary = String(fParam);
          }
          found.lock_version += 1;
          found.updated_at = new Date();
        }

        return { rows: [found] as unknown as R[] };
      }

      // UPDATE app.checklist_item
      if (sqlLower.includes('update app.checklist_item')) {
        const [status, note, rejectReason, actor, now, _updatedBy, itemId] = params;
        const item = checklistItems.find((c) => c.id === itemId && c.tenant_id === activeTenantId);
        if (!item) return { rows: [] };

        item.status = status as string;
        item.attestation_note = (note as string) ?? null;
        item.reject_reason = (rejectReason as string) ?? null;
        item.reviewed_by = actor as string;
        item.reviewed_at = now as Date;
        item.lock_version += 1;

        return {
          rows: [
            {
              id: item.id,
              status: item.status,
              reviewed_by: item.reviewed_by,
              reviewed_at: item.reviewed_at,
            },
          ] as unknown as R[],
        };
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

  return { db, runner, verifications, checklistItems };
}
