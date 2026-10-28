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

export type ChecklistItemStatus =
  | 'PENDING'
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'WAIVED'
  | 'NOT_APPLICABLE'
  | 'EXPIRED';

/** One checklist row as a lender submission package sees it (MOD-DOC SUB-DOC.02, ENT-048). */
export interface SubmissionDocument {
  checklistItemId: string;
  partyId: string;
  documentTypeCode: string;
  mandatory: boolean;
  status: ChecklistItemStatus;
  documentId: string | null;
  /** sha256 of the stored document file; null when nothing is uploaded for the item. */
  sha256: string | null;
}

export interface SubmissionDocuments {
  /** Every mandatory item is ACCEPTED, WAIVED or NOT_APPLICABLE, and the checklist is not empty. */
  complete: boolean;
  documents: SubmissionDocument[];
}

export interface ApplicationPort {
  /** Inside caller tx (FR-LEAD-015 atomic conversion). Creates loan_application DRAFT + PRIMARY application_party
   *  + status history + application.created event + audit. Throws VALIDATION_ERROR on invalid input. */
  createDraftFromConversion(
    tx: Tx,
    ctx: RequestContext,
    cmd: CreateDraftFromConversionCommand,
  ): Promise<{ applicationId: string; status: 'DRAFT' }>;

  /** Inside caller tx. The application's checklist and stored document hashes, for lender packages (MOD-LCS).
   *  Added 2026-10-19 (additive, Contracts §15). NOT_FOUND when the application is not visible in the tenant. */
  getSubmissionDocuments(tx: Tx, ctx: RequestContext, applicationId: string): Promise<SubmissionDocuments>;

  /** Inside caller tx. Call after a checklist item's status changed (a document accepted, a waiver, an attestation). When that leaves
   *  every mandatory item ACCEPTED, WAIVED or NOT_APPLICABLE on an application that is DOCUMENTS_PENDING and not on hold, the
   *  application moves to UNDER_REVIEW as T-APP-02, with status history, outbox event and audit event; otherwise nothing happens.
   *  Added 2026-10-28 (additive, Contracts §15). */
  onChecklistItemChanged(tx: Tx, ctx: RequestContext, checklistItemId: string): Promise<{ advanced: boolean }>;
}
