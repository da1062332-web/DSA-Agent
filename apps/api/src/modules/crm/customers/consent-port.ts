// apps/api/src/modules/crm/customers/consent-port.ts — owner: Dev 5 (MOD-CUST / MOD-PRV consent; Contracts §4.4)
// The real ConsentPort. A consent counts when it is ACTIVE and not past expires_at, and is held either by the customer or by
// a lead that converted into that customer (consents captured before conversion stay valid). For SHARE_WITH_LENDER and
// VERIFICATION_CHECK the purpose target (the lender, or the check) must match when the caller names one.
// Runs in the caller's transaction, so row-level security limits it to the caller's tenant.
import type { ConsentPort, Tx } from '@dsa/contracts';
import { sql } from 'kysely';

export function createConsentPort(): ConsentPort {
  return {
    async findActive(tx: Tx, q) {
      const r = await sql<{ id: string }>`
        select c.id from consent_record c
         where c.purpose = ${q.purpose}
           and c.status = 'ACTIVE'
           and (c.expires_at is null or c.expires_at > now())
           and (${q.purposeTarget ?? null}::text is null or c.purpose_target = ${q.purposeTarget ?? null})
           and (
             (c.subject_type = 'CUSTOMER' and c.subject_id = ${q.customerId})
             or (c.subject_type = 'LEAD' and c.subject_id in (select l.id from lead l where l.customer_id = ${q.customerId}))
           )
         order by c.captured_at desc, c.id desc
         limit 1`.execute(tx);
      const row = r.rows[0];
      return row ? { consentId: row.id } : null;
    },
  };
}
