// packages/contracts/src/ports/complaint-subject-port.ts — owner: Dev 3 (MOD-GRV, Module 13). Approved 2026-10-13.
// Lets the grievances module confirm that a complaint's subject exists in the caller's tenant without querying another
// module's tables. Providers: APPLICATION (Dev 3, origination/applications); LEAD (Dev 5, crm/leads, not yet provided).
// Fake: fakes/fake-complaint-subject.ts.
import type { Tx } from '../kernel';

export type ComplaintSubjectType = 'LEAD' | 'APPLICATION';

export interface ComplaintSubjectPort {
  /** True when the subject exists in the caller's tenant (row-level security applies). Returns false, never throws, when absent. */
  exists(tx: Tx, type: ComplaintSubjectType, id: string): Promise<boolean>;
}
