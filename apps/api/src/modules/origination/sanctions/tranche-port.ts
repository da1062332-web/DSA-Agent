// SanctionTranchePort, real implementation (owner: Devyani, P1-07 / TASK-140). The import module records a tranche from
// a bank's status sheet through this port, inside the import batch's own transaction, so the tranche, the case's status
// roll-up and the outbox event commit or roll back with the batch that caused them.
//
// The permission check is not bypassed: recordTrancheInTx checks disbursement.record itself, so a person who may move
// statuses but not record disbursements gets an exception row on their import rather than a tranche they were not
// authorised to create.
import {
  AppError,
  type RecordTrancheFromImport,
  type RequestContext,
  type SanctionTranchePort,
  type Tx,
} from '@dsa/contracts';
import { sql } from 'kysely';
import type { SanctionService } from './service';

interface ActiveSanctionRow {
  id: string;
}

export function createSanctionTranchePort(service: SanctionService): SanctionTranchePort {
  return {
    async findActiveSanctionForCase(tx: Tx, lenderCaseId: string) {
      // The newest ACTIVE sanction: a case can carry superseded versions, and a tranche belongs to the live one.
      // Row-level security keeps this inside the caller's tenant.
      const result = await sql<ActiveSanctionRow>`
        SELECT id
        FROM sanction
        WHERE lender_case_id = ${lenderCaseId} AND status = 'ACTIVE'
        ORDER BY version DESC
        LIMIT 1
      `.execute(tx);

      const row = result.rows[0];
      return row ? { sanctionId: row.id } : null;
    },

    async recordTranche(tx: Tx, ctx: RequestContext, sanctionId: string, input: RecordTrancheFromImport) {
      // A sheet can carry an amount larger than the sanction, a cancelled sanction, or an expired one. Each of those
      // throws from recordTrancheInTx and the importer records it as an exception, so one bad row never fails 2,000.
      const { tranche } = await service.recordTrancheInTx(tx, ctx, sanctionId, {
        amount: input.amount,
        currency: input.currency,
        disbursedOn: input.disbursedOn,
      });
      if (!tranche?.id) {
        throw AppError.of('INTERNAL_ERROR', 'Tranche was recorded without an id.');
      }
      return { trancheId: tranche.id };
    },
  };
}
