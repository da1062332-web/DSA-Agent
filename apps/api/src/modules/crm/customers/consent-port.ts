// apps/api/src/modules/crm/customers/consent-port.ts — owner: Dev 5 (MOD-CUST; Contracts §4.4)
// The real ConsentPort and PartyPort, both served by CustomerService over the SQL repository. A consent counts when it is ACTIVE
// and not past expires_at, held by the customer or by a lead that converted into the customer; for SHARE_WITH_LENDER the
// purpose target (the lender) must match when the caller names one. Runs in the caller's transaction (row-level security).
import type { ConsentPort, PartyPort } from '@dsa/contracts';
import { CustomerService } from './customer-service';
import { SqlCustomerRepository } from './repository';

export function createConsentPort(): ConsentPort {
  return new CustomerService({ repository: new SqlCustomerRepository() });
}

export function createPartyPort(): PartyPort {
  return new CustomerService({ repository: new SqlCustomerRepository() });
}
