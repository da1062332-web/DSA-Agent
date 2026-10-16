// apps/api/src/modules/crm/leads/subject-port.ts — owner: Dev 5 (MOD-04 Leads, Module 4).
// ComplaintSubjectPort, LEAD provider.
// Lets the grievances module (MOD-GRV, Module 13) confirm that a complaint's lead subject exists
// in the caller's tenant without querying crm/leads tables directly.
// Row-level security limits the lookup to the caller's tenant, so another tenant's lead reads as absent.
import { AppError, type ComplaintSubjectPort, type ComplaintSubjectType, type Tx } from '@dsa/contracts';
import { sql } from 'kysely';

/**
 * Creates a ComplaintSubjectPort provider specifically for LEAD subjects.
 * Returns true if the lead exists in the caller's tenant, false otherwise.
 * Throws SUBJECT_UNSUPPORTED if called with non-LEAD subject types.
 */
export function createLeadSubjectPort(): ComplaintSubjectPort {
  return {
    async exists(tx: Tx, type: ComplaintSubjectType, id: string): Promise<boolean> {
      if (type !== 'LEAD') {
        throw AppError.of('VALIDATION_ERROR', `Complaints about ${type} are not supported by the lead provider.`, [
          { field: 'complainantType', issue: 'SUBJECT_UNSUPPORTED' },
        ]);
      }
      const r = await sql<{ id: string }>`select id from lead where id = ${id}`.execute(tx);
      return r.rows.length > 0;
    },
  };
}

/**
 * Creates a composite ComplaintSubjectPort that delegates to both LEAD and APPLICATION providers.
 * The APPLICATION provider belongs to another module (origination), so the caller passes it in (src/server.ts does);
 * this module may not import it (module boundary, NFR-MNT-001).
 */
export function createCompositeComplaintSubjectPort(providers: {
  application: ComplaintSubjectPort;
  lead?: ComplaintSubjectPort;
}): ComplaintSubjectPort {
  const applicationPort = providers.application;
  const leadPort = providers.lead ?? createLeadSubjectPort();

  return {
    async exists(tx: Tx, type: ComplaintSubjectType, id: string): Promise<boolean> {
      if (type === 'LEAD') {
        return leadPort.exists(tx, type, id);
      }
      if (type === 'APPLICATION') {
        return applicationPort.exists(tx, type, id);
      }
      throw AppError.of('VALIDATION_ERROR', `Unsupported complaint subject type: ${type}`, [
        { field: 'complainantType', issue: 'SUBJECT_UNSUPPORTED' },
      ]);
    },
  };
}
