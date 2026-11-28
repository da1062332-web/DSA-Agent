// LenderCaseStatusPort, real implementation (owner: Devyani, P1-07 / TASK-140). The import module moves cases through
// this port, never by writing lender_case itself, so a status set by a bank's spreadsheet takes exactly the path a
// status set by a person's click takes: the same permission check, the same legal-transition rules, the same audit and
// outbox events, written in the caller's transaction.
import {
  type LenderCaseByReference,
  type LenderCaseStatusPort,
  type LenderCaseStatus,
  type RequestContext,
  type StatusSource,
  type Tx,
} from '@dsa/contracts';
import { sql } from 'kysely';
import { LenderCaseService, type LenderCaseServiceDeps } from './service';
import { ensureStalenessJobScheduled } from './staleness-job';
import type { ApiDeps } from '../../types';

interface ReferenceRow {
  id: string;
  lender_id: string;
  status: LenderCaseStatus;
  lock_version: number;
}

/** Needs enqueueJob as well as the service's own deps: booking the staleness sweep goes through the job queue. */
export type LenderCaseStatusPortDeps = LenderCaseServiceDeps & Pick<ApiDeps, 'enqueueJob'>;

export function createLenderCaseStatusPort(deps: LenderCaseStatusPortDeps): LenderCaseStatusPort {
  const service = new LenderCaseService(deps);

  return {
    async findByReference(tx: Tx, lenderId: string, lenderReference: string) {
      // Scoped to the lender as well as the reference: two banks issue reference numbers in their own sequences, and
      // a collision across lenders would move a case belonging to a different bank. Row-level security keeps this
      // inside the caller's tenant.
      const result = await sql<ReferenceRow>`
        SELECT id, lender_id, status, lock_version
        FROM lender_case
        WHERE lender_id = ${lenderId} AND lender_reference = ${lenderReference}
        ORDER BY attempt_no DESC
        LIMIT 1
      `.execute(tx);

      const row = result.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        lenderId: row.lender_id,
        status: row.status,
        lockVersion: row.lock_version,
      } satisfies LenderCaseByReference;
    },

    async applyStatus(
      tx: Tx,
      ctx: RequestContext,
      caseId: string,
      input: {
        toStatus: LenderCaseStatus;
        statusSource: StatusSource;
        reasonText?: string;
        lenderReference?: string;
      },
      ifMatch: number,
    ) {
      const resource = await service.updateStatus(
        tx,
        ctx,
        caseId,
        {
          toStatus: input.toStatus,
          statusSource: input.statusSource,
          ...(input.reasonText ? { reasonText: input.reasonText } : {}),
          ...(input.lenderReference ? { lenderReference: input.lenderReference } : {}),
        },
        ifMatch,
      );
      return { status: resource.status, lockVersion: resource.lockVersion };
    },

    async ensureStalenessSweepScheduled(tx: Tx, tenantId: string) {
      return ensureStalenessJobScheduled(tx, tenantId, deps);
    },
  };
}
