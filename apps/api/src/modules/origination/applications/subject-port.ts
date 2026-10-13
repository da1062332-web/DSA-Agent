// ComplaintSubjectPort, APPLICATION provider (owner: Dev 3). Lead subjects are handled by Dev 5's provider; until it exists
// a lead complaint is refused with SUBJECT_UNSUPPORTED rather than guessed at. Row-level security limits the lookup to
// the caller's tenant, so another tenant's application reads as absent.
import { AppError, type ComplaintSubjectPort, type Tx } from '@dsa/contracts';
import { sql } from 'kysely';

export function createApplicationSubjectPort(): ComplaintSubjectPort {
  return {
    async exists(tx: Tx, type, id) {
      if (type === 'LEAD') {
        throw AppError.of('VALIDATION_ERROR', 'Complaints about a lead are not supported yet.', [
          { field: 'complainantType', issue: 'SUBJECT_UNSUPPORTED' },
        ]);
      }
      const r = await sql<{ id: string }>`select id from loan_application where id = ${id}`.execute(tx);
      return r.rows.length > 0;
    },
  };
}
