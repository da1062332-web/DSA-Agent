// packages/contracts/src/ports/application-port.ts — owner: Dev 3 — frozen at Gate 1 (Contracts §4.3)
// Consumers: Dev 5 (lead conversion), Dev 4 (lender cases).
// Fake: fakes/fake-application.ts — TODO(Dev 3, Gate 1) per Contracts §4.5.
import type { Money } from '../money';
import type { RequestContext, Tx } from '../kernel';
import type { ApplicantType, ProductCategory } from './decision-keys';

export type PurposeCode =
  | 'PERSONAL_NEEDS'
  | 'MEDICAL'
  | 'EDUCATION'
  | 'HOME_PURCHASE'
  | 'HOME_IMPROVEMENT'
  | 'VEHICLE'
  | 'WORKING_CAPITAL'
  | 'BUSINESS_EXPANSION'
  | 'DEBT_CONSOLIDATION'
  | 'OTHER';

export interface CreateDraftFromConversionCommand {
  leadId: string;
  customerId: string;
  branchId: string;
  partyType: 'INDIVIDUAL' | 'ENTITY';
  productCategory: ProductCategory;
  requestedAmount: Money;
  tenureMonths?: number;
  purposeCode?: PurposeCode;
  applicantType: ApplicantType;
  salesOwnerUserId: string;
}

export interface ApplicationPort {
  /** Inside caller tx (FR-LEAD-015 atomic conversion). Creates loan_application DRAFT + PRIMARY application_party
   *  + status history + application.created event + audit. Throws VALIDATION_ERROR on invalid input. */
  createDraftFromConversion(
    tx: Tx,
    ctx: RequestContext,
    cmd: CreateDraftFromConversionCommand,
  ): Promise<{ applicationId: string; status: 'DRAFT' }>;
}
